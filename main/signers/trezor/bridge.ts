import log from 'electron-log'
import { EventEmitter } from 'events'
import type { ThpPairingMethod } from '@trezor/protocol'
import type { ConnectSettingsTransport } from '@trezor/connect/lib/types/settings'
import TrezorConnect, {
  CommonParams,
  Device,
  DeviceEvent,
  UiEvent,
  Response,
  DEVICE,
  DEVICE_EVENT,
  UI,
  UI_EVENT
} from '@trezor/connect'
import { closeFrameNodeUsbTransports, FrameNodeUsbTransport } from './nodeUsbTransport'
import { WREN_REPOSITORY_URL } from '../../../resources/constants'

export class DeviceError extends Error {
  readonly code

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
  lazyLoad: false,
  // Trezor's NodeUsb constructor currently conflicts with its own public
  // transport type when exactOptionalPropertyTypes is enabled.
  transports: [FrameNodeUsbTransport as unknown as ConnectSettingsTransport]
}

function deviceSelector(device: DeviceReference): NonNullable<CommonParams['device']> {
  return {
    path: device.path,
    ...(device.state !== undefined && { state: device.state })
  }
}

async function handleResponse<T>(p: Response<T>) {
  const response = await p

  if (response.success) return response.payload
  const responseError = new Error(response.payload.error) as NodeJS.ErrnoException
  responseError.code = response.payload.code
  throw responseError
}

class TrezorBridge extends EventEmitter {
  private lifecycleGeneration = 0

  async open() {
    const generation = ++this.lifecycleGeneration

    TrezorConnect.on(DEVICE_EVENT, this.handleDeviceEvent.bind(this))
    TrezorConnect.on(UI_EVENT, this.handleUiEvent.bind(this))

    try {
      await TrezorConnect.init(config)

      if (generation !== this.lifecycleGeneration) return

      log.info('Trezor Connect initialized')

      this.emit('connect')
    } catch (e) {
      if (generation === this.lifecycleGeneration) log.error('could not open TrezorConnect!', e)
    }
  }

  async close() {
    ++this.lifecycleGeneration
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
    return this.makeRequest(() => TrezorConnect.getPublicKey({ device: deviceSelector(device), path }))
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

  async signTypedData(device: DeviceReference, path: string, data: any) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumSignTypedData({
        device: deviceSelector(device),
        path,
        data,
        metamask_v4_compat: true
      })
    )

    return result.signature
  }

  async signTypedHash(
    device: DeviceReference,
    path: string,
    data: any,
    domainSeparatorHash: string,
    messageHash: string
  ) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumSignTypedData({
        device: deviceSelector(device),
        path,
        data,
        domain_separator_hash: domainSeparatorHash,
        message_hash: messageHash,
        metamask_v4_compat: true
      })
    )

    return result.signature
  }

  async signTransaction(device: DeviceReference, path: string, tx: any) {
    const result = await this.makeRequest(() =>
      TrezorConnect.ethereumSignTransaction({
        device: deviceSelector(device),
        path,
        transaction: tx
      })
    )

    const { v, r, s } = result
    return { v, r, s }
  }

  pinEntered(deviceId: string, pin: string) {
    log.debug('pin entered for device', deviceId)

    TrezorConnect.uiResponse({ type: UI.RECEIVE_PIN, payload: pin })

    this.emit('trezor:entered:pin', deviceId)
  }

  passphraseEntered(deviceId: string, phrase: string) {
    log.debug('passphrase entered for device', deviceId)

    TrezorConnect.uiResponse({ type: UI.RECEIVE_PASSPHRASE, payload: { save: true, value: phrase } })

    this.emit('trezor:entered:passphrase', deviceId)
  }

  enterPassphraseOnDevice(deviceId: string) {
    log.debug('requested to enter passphrase on device', deviceId)

    TrezorConnect.uiResponse({
      type: UI.RECEIVE_PASSPHRASE,
      payload: { value: '', passphraseOnDevice: true, save: true }
    })

    this.emit('trezor:enteringPhrase', deviceId)
  }

  pairingEntered(deviceId: string, payload: TrezorPairingResponse) {
    log.debug('pairing response entered for device', deviceId)

    TrezorConnect.uiResponse({ type: UI.RECEIVE_THP_PAIRING_TAG, payload })

    this.emit('trezor:entered:pairing', deviceId)
  }

  private async makeRequest<T>(fn: () => Response<T>, retries = 20) {
    try {
      const result = await handleResponse(fn())
      return result
    } catch (e: unknown) {
      if (retries === 0) {
        throw new Error('Trezor unreachable, please try again')
      }

      const err = e as DeviceError

      if (err.code === 'Device_CallInProgress') {
        return new Promise<T>((resolve) => {
          setTimeout(() => {
            log.warn('request conflict, trying again in 400ms', err)
            resolve(this.makeRequest(fn, retries - 1))
          }, 400)
        })
      } else {
        throw err
      }
    }
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
      this.emit('trezor:disconnect', e.payload)
    } else if (e.type === DEVICE.CHANGED) {
      // update the device to remember things like passphrases and other session info
      this.emit('trezor:update', e.payload)
    }
  }

  private handleUiEvent(e: UiEvent) {
    log.debug('received Trezor ui event', { e })

    if (e.type === UI.REQUEST_PIN) {
      this.emit('trezor:needPin', e.payload.device)
    } else if (e.type === UI.INVALID_PIN) {
      this.emit('trezor:invalidPin', e.payload.device)
    } else if (e.type === UI.INVALID_PIN_ATTEMPTS_DEPLETED) {
      this.emit('trezor:pinAttemptsDepleted', e.payload.device)
    } else if (e.type === UI.REQUEST_PASSPHRASE) {
      this.emit('trezor:needPhrase', e.payload.device)
    } else if (e.type === UI.REQUEST_THP_PAIRING) {
      this.emit('trezor:needPairing', e.payload)
    }
  }
}

export default new TrezorBridge()
