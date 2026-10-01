import log from 'electron-log'
import { EventEmitter } from 'events'
import type { ThpPairingMethod } from '@trezor/protocol'
import TrezorConnect, {
  CommonParams,
  Device,
  DeviceEvent,
  UiEventMessage,
  PopupEventMessage,
  UiRequestMessage,
  Response,
  DEVICE,
  DEVICE_EVENT,
  UI_EVENTS,
  UI_REQUEST,
  UI_REQUESTS,
  UI_RESPONSE,
  UI_EVENT
} from '@trezor/connect'
import { closeFrameNodeUsbTransports, FrameNodeUsbTransport } from './nodeUsbTransport'
import { trezorSignerId } from './deviceId'
import { WREN_REPOSITORY_URL } from '../../../resources/constants'

export class DeviceError extends Error {
  readonly code: string | undefined

  constructor(msg: string, code?: string) {
    super(msg)

    this.code = code
  }
}

type TrezorPairingResponse =
  { tag: string } | { selectedMethod: ThpPairingMethod | keyof typeof ThpPairingMethod }
type DeviceReference = {
  path: Device['path']
  state?: Device['state'] | undefined
}

const manifest = {
  email: 'jorphex@users.noreply.github.com',
  appName: 'Wren',
  appUrl: WREN_REPOSITORY_URL
}

const config = {
  manifest,
  popup: false,
  debug: false,
  lazyLoad: false
}

type TrezorTypedData = Parameters<typeof TrezorConnect.ethereumSignTypedData>[0]['data']
type TrezorTransaction = Parameters<typeof TrezorConnect.ethereumSignTransaction>[0]['transaction']

function deviceSelector(device: DeviceReference): NonNullable<CommonParams['device']> {
  return {
    path: device.path,
    ...(device.state !== undefined && { state: device.state })
  }
}

async function handleResponse<T>(p: Response<T>) {
  const response = await p

  if (response.success) return response.payload
  const responseError = new Error(response.error.message) as NodeJS.ErrnoException
  responseError.code = response.error.code
  throw responseError
}

class TrezorBridge extends EventEmitter {
  private pendingPrompts = new Map<string, { requestId: string; type: string; generation: number }>()
  private lifecycleGeneration = 0
  private requestQueue: Promise<void> = Promise.resolve()
  private retryDelays = new Set<{
    timer: ReturnType<typeof setTimeout>
    reject: (error: Error) => void
  }>()

  async open() {
    const generation = ++this.lifecycleGeneration

    TrezorConnect.on(DEVICE_EVENT, this.handleDeviceEvent.bind(this))
    TrezorConnect.on(UI_EVENT, this.handleUiEvent.bind(this))
    TrezorConnect.on(UI_REQUEST, this.handleUiRequest.bind(this))

    try {
      await TrezorConnect.init({
        ...config,
        // Connect 10 vendors a second private AbstractTransport identity in its declarations.
        // The packaged runtime probe verifies this real guarded transport instance.
        // @ts-expect-error Upstream vendored private class differs from @trezor/transport-common.
        transports: [new FrameNodeUsbTransport({ id: 'Wren' })]
      })

      if (generation !== this.lifecycleGeneration) return

      log.info('Trezor Connect initialized')

      this.emit('connect')
    } catch (e) {
      if (generation === this.lifecycleGeneration) log.error('could not open TrezorConnect!', e)
    }
  }

  async close() {
    ++this.lifecycleGeneration
    this.cancelRetryDelays()
    this.pendingPrompts.clear()
    this.requestQueue = Promise.resolve()
    this.removeAllListeners()

    TrezorConnect.removeAllListeners()

    try {
      await closeFrameNodeUsbTransports()
    } finally {
      await TrezorConnect.dispose()
    }
  }

  // methods to send requests from the application to a Trezor device
  async getFeatures(device: DeviceReference) {
    return this.makeRequest(() => TrezorConnect.getFeatures({ device: deviceSelector(device) }))
  }

  async getAccountInfo(device: DeviceReference, path: string) {
    return this.makeRequest(() =>
      TrezorConnect.getAccountInfo({ device: deviceSelector(device), path, coin: 'eth' })
    )
  }

  async getPublicKey(device: DeviceReference, path: string) {
    return this.makeRequest(() =>
      TrezorConnect.ethereumGetPublicKey({ device: deviceSelector(device), path })
    )
  }

  async getAddress(device: DeviceReference, path: string, display = false) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumGetAddress({
        device: deviceSelector(device),
        path,
        showOnTrezor: display
      })
    )

    return (result.address || '').toLowerCase()
  }

  async signMessage(device: DeviceReference, path: string, message: string) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumSignMessage({
        device: deviceSelector(device),
        path,
        message,
        hex: true
      })
    )

    return result.signature
  }

  async signTypedData(device: DeviceReference, path: string, data: unknown) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumSignTypedData({
        device: deviceSelector(device),
        path,
        data: data as TrezorTypedData,
        metamask_v4_compat: true
      })
    )

    return result.signature
  }

  async signTypedHash(
    device: DeviceReference,
    path: string,
    data: unknown,
    domainSeparatorHash: string,
    messageHash: string
  ) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumSignTypedData({
        device: deviceSelector(device),
        path,
        data: data as TrezorTypedData,
        domain_separator_hash: domainSeparatorHash,
        message_hash: messageHash,
        metamask_v4_compat: true
      })
    )

    return result.signature
  }

  async signTransaction(device: DeviceReference, path: string, tx: unknown, onDispatch?: () => void) {
    const result = await this.makeRequest(() => {
      onDispatch?.()
      return TrezorConnect.ethereumSignTransaction({
        device: deviceSelector(device),
        path,
        transaction: tx as TrezorTransaction
      })
    })

    const { v, r, s } = result
    return { v, r, s }
  }

  pinEntered(deviceId: string, pin: string, authenticationRequestId: string) {
    log.debug('pin entered for device', deviceId)

    const requestId = this.consumePrompt(deviceId, authenticationRequestId, UI_REQUESTS.REQUEST_PIN)
    if (!requestId) return
    TrezorConnect.uiResponse({ type: UI_RESPONSE.RECEIVE_PIN, payload: pin, requestId })

    this.emit('trezor:entered:pin', deviceId)
  }

  passphraseEntered(deviceId: string, phrase: string, authenticationRequestId: string) {
    log.debug('passphrase entered for device', deviceId)

    const requestId = this.consumePrompt(deviceId, authenticationRequestId, UI_REQUESTS.REQUEST_PASSPHRASE)
    if (!requestId) return
    TrezorConnect.uiResponse({
      type: UI_RESPONSE.RECEIVE_PASSPHRASE,
      payload: { save: true, value: phrase },
      requestId
    })

    this.emit('trezor:entered:passphrase', deviceId)
  }

  enterPassphraseOnDevice(deviceId: string, authenticationRequestId: string) {
    log.debug('requested to enter passphrase on device', deviceId)

    const requestId = this.consumePrompt(deviceId, authenticationRequestId, UI_REQUESTS.REQUEST_PASSPHRASE)
    if (!requestId) return
    TrezorConnect.uiResponse({
      requestId,
      type: UI_RESPONSE.RECEIVE_PASSPHRASE,
      payload: { value: '', passphraseOnDevice: true, save: true }
    })

    this.emit('trezor:enteringPhrase', deviceId)
  }

  pairingEntered(deviceId: string, payload: TrezorPairingResponse, authenticationRequestId: string) {
    log.debug('pairing response entered for device', deviceId)

    const requestId = this.consumePrompt(
      deviceId,
      authenticationRequestId,
      UI_REQUESTS.REQUEST_THP_PAIRING_TAG
    )
    if (!requestId) return
    TrezorConnect.uiResponse({ type: UI_RESPONSE.RECEIVE_THP_PAIRING_TAG, payload, requestId })

    this.emit('trezor:entered:pairing', deviceId)
  }

  cancelCurrentRequest() {
    this.pendingPrompts.clear()
    this.emit('trezor:authenticationCancelled')
    TrezorConnect.cancel('Transaction signing cancelled in Wren')
  }

  cancelAuthentication() {
    this.pendingPrompts.clear()
    this.emit('trezor:authenticationCancelled')
    TrezorConnect.cancel('Authentication dismissed in Wren')
  }

  private makeRequest<T>(fn: () => Response<T>, retries = 20) {
    const generation = this.lifecycleGeneration
    const request = this.requestQueue
      .catch(() => undefined)
      .then(() => this.runRequest(fn, retries, generation))
      .finally(() => {
        if (generation === this.lifecycleGeneration) this.pendingPrompts.clear()
      })

    this.requestQueue = request.then(
      () => undefined,
      () => undefined
    )

    return request
  }

  private async runRequest<T>(fn: () => Response<T>, retries: number, generation: number): Promise<T> {
    this.ensureCurrent(generation)

    try {
      const result = await handleResponse(fn())
      this.ensureCurrent(generation)
      return result
    } catch (e: unknown) {
      this.ensureCurrent(generation)

      if (retries === 0) {
        throw new Error('Trezor unreachable, please try again')
      }

      const err = e as DeviceError

      if (err.code === 'Device_CallInProgress') {
        await this.retryDelay(generation)
        log.warn('request conflict, trying again in 400ms', err)
        return this.runRequest(fn, retries - 1, generation)
      } else {
        throw err
      }
    }
  }

  private retryDelay(generation: number) {
    return new Promise<void>((resolve, reject) => {
      const pending = {
        timer: setTimeout(() => {
          this.retryDelays.delete(pending)

          try {
            this.ensureCurrent(generation)
            resolve()
          } catch (error) {
            reject(error)
          }
        }, 400),
        reject
      }

      this.retryDelays.add(pending)
    })
  }

  private cancelRetryDelays() {
    const error = new Error('Trezor bridge closed')

    this.retryDelays.forEach((pending) => {
      clearTimeout(pending.timer)
      pending.reject(error)
    })
    this.retryDelays.clear()
  }

  private ensureCurrent(generation: number) {
    if (generation !== this.lifecycleGeneration) throw new Error('Trezor bridge closed')
  }

  // listeners for events coming from a Trezor device
  private handleDeviceEvent(e: DeviceEvent) {
    log.debug('received Trezor device event', { e })

    if (
      (e.type === DEVICE.CHANGED || e.type === DEVICE.CONNECT_UNACQUIRED) &&
      e.payload.type === 'unacquired'
    ) {
      // device is detected but not connected, either because
      // another session is already active or that the connection
      // has just not been made yet
      this.emit('trezor:detected', e.payload.path)
    } else if (e.type === DEVICE.CONNECT && e.payload.type === 'acquired') {
      this.emit('trezor:connect', e.payload)
    } else if (e.type === DEVICE.DISCONNECT) {
      this.pendingPrompts.delete(trezorSignerId(e.payload.path))
      this.emit('trezor:disconnect', e.payload)
    } else if (e.type === DEVICE.CHANGED) {
      // update the device to remember things like passphrases and other session info
      this.emit('trezor:update', e.payload)
    }
  }

  private consumePrompt(deviceId: string, authenticationRequestId: string, type: string) {
    const prompt = this.pendingPrompts.get(deviceId)
    if (
      !authenticationRequestId ||
      !prompt ||
      prompt.requestId !== authenticationRequestId ||
      prompt.type !== type ||
      prompt.generation !== this.lifecycleGeneration
    )
      return
    this.pendingPrompts.delete(deviceId)
    return prompt.requestId
  }

  private handleUiRequest(e: UiRequestMessage) {
    if (
      e.type === UI_REQUESTS.REQUEST_PIN ||
      e.type === UI_REQUESTS.REQUEST_PASSPHRASE ||
      e.type === UI_REQUESTS.REQUEST_THP_PAIRING_TAG
    ) {
      this.pendingPrompts.set(trezorSignerId(e.payload.device.path), {
        requestId: e.requestId,
        type: e.type,
        generation: this.lifecycleGeneration
      })
      if (e.type === UI_REQUESTS.REQUEST_PIN) this.emit('trezor:needPin', e.payload.device, e.requestId)
      else if (e.type === UI_REQUESTS.REQUEST_PASSPHRASE)
        this.emit('trezor:needPhrase', e.payload.device, e.requestId)
      else this.emit('trezor:needPairing', { ...e.payload, requestId: e.requestId })
    } else {
      // Wren does not provide firmware/recovery or host confirmation UI.
      // Never silently approve a newly introduced SDK confirmation.
      this.pendingPrompts.clear()
      this.emit('trezor:authenticationCancelled')
      TrezorConnect.cancel('Unsupported Trezor authentication request in Wren')
    }
  }

  private handleUiEvent(e: UiEventMessage | PopupEventMessage) {
    if (e.type === UI_EVENTS.PIN_INVALID) {
      this.emit('trezor:invalidPin', e.payload.device)
    } else if (e.type === UI_EVENTS.PIN_INVALID_ATTEMPTS_DEPLETED) {
      this.pendingPrompts.delete(trezorSignerId(e.payload.device.path))
      this.emit('trezor:pinAttemptsDepleted', e.payload.device)
    }
  }
}

export default new TrezorBridge()
