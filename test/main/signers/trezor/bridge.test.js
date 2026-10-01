import TrezorConnect, {
  DEVICE_EVENT,
  DEVICE,
  UI_EVENT,
  UI_REQUEST,
  UI_REQUESTS,
  UI_EVENTS,
  UI_RESPONSE
} from '@trezor/connect'
import { EventEmitter } from 'stream'
import log from 'electron-log'

import TrezorBridge from '../../../../main/signers/trezor/bridge'
import { FrameNodeUsbTransport } from '../../../../main/signers/trezor/nodeUsbTransport'
import { trezorSignerId } from '../../../../main/signers/trezor/deviceId'

jest.mock('@trezor/connect')

const events = new EventEmitter()

beforeAll(() => {
  log.transports.console.level = false

  TrezorConnect.on = events.on.bind(events)
  TrezorConnect.once = events.once.bind(events)
  TrezorConnect.emit = events.emit.bind(events)
  TrezorConnect.removeAllListeners = events.removeAllListeners.bind(events)
  TrezorConnect.cancel = jest.fn()
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

beforeEach((done) => {
  TrezorBridge.once('connect', done)
  TrezorBridge.open()
})

afterEach(async () => {
  await TrezorBridge.close()
})

describe('connect events', () => {
  it('initializes Trezor Connect with a fresh guarded NodeUsb transport', async () => {
    expect(TrezorConnect.init).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: {
          appName: 'Wren',
          appUrl: 'https://github.com/jorphex/wren',
          email: 'jorphex@users.noreply.github.com'
        },
        transports: [expect.any(FrameNodeUsbTransport)]
      })
    )
    const initialTransport = TrezorConnect.init.mock.calls.at(-1)[0].transports[0]
    await TrezorBridge.close()
    await TrezorBridge.open()
    const reopenedTransport = TrezorConnect.init.mock.calls.at(-1)[0].transports[0]
    expect(reopenedTransport).toBeInstanceOf(FrameNodeUsbTransport)
    expect(reopenedTransport).not.toBe(initialTransport)
  })

  it('silences an initialization cancelled by shutdown', async () => {
    let rejectInitialization
    const initialization = new Promise((resolve, reject) => {
      rejectInitialization = reject
    })
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined)
    const connected = jest.fn()

    TrezorConnect.init.mockReturnValueOnce(initialization)
    TrezorBridge.once('connect', connected)

    const opening = TrezorBridge.open()
    await TrezorBridge.close()
    rejectInitialization(new Error('Disposed during initialization'))
    await opening

    expect(connected).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
    logError.mockRestore()
  })

  it('emits a detected event on device changed event with type unacquired', (done) => {
    TrezorBridge.once('trezor:detected', (path) => {
      try {
        expect(path).toBe('27')
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(DEVICE_EVENT, {
      type: DEVICE.CHANGED,
      payload: { type: 'unacquired', path: '27', features: {} }
    })
  })

  it('emits a detected event on device unacquired event', (done) => {
    TrezorBridge.once('trezor:detected', (path) => {
      try {
        expect(path).toBe('27')
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(DEVICE_EVENT, {
      type: DEVICE.CONNECT_UNACQUIRED,
      payload: { type: 'unacquired', path: '27', features: {} }
    })
  })

  it('emits a connected event on device connected event with type acquired', (done) => {
    const payload = { type: 'acquired', path: '27', features: { firmwareVersion: '2.1.4' } }

    TrezorBridge.once('trezor:connect', (device) => {
      try {
        expect(device).toEqual(payload)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(DEVICE_EVENT, { type: DEVICE.CONNECT, payload })
  })

  it('emits a disconnected event on device disconnected event', (done) => {
    const payload = { type: 'acquired', path: '27', features: { firmwareVersion: '2.1.4' } }

    TrezorBridge.once('trezor:disconnect', (device) => {
      try {
        expect(device).toEqual(payload)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(DEVICE_EVENT, { type: DEVICE.DISCONNECT, payload })
  })

  it('emits an updated event on device changed event where type is not unacquired', (done) => {
    const payload = { type: 'acquired', path: '27', features: { firmwareVersion: '2.1.4' } }

    TrezorBridge.once('trezor:update', (device) => {
      try {
        expect(device).toEqual(payload)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(DEVICE_EVENT, { type: DEVICE.CHANGED, payload })
  })
})

describe('ui events', () => {
  it('cancels a passive authentication request without using the transaction cancellation reason', () => {
    TrezorBridge.cancelAuthentication()

    expect(TrezorConnect.cancel).toHaveBeenCalledWith('Authentication dismissed in Wren')
  })

  it('emits a needPin event when a pin is requested', (done) => {
    const device = { type: 'acquired', id: 'someid1234', path: '27' }

    TrezorBridge.once('trezor:needPin', (reportedDevice) => {
      try {
        expect(reportedDevice).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_REQUEST, { type: UI_REQUESTS.REQUEST_PIN, requestId: 'pin-1', payload: { device } })
  })

  it('emits an invalidPin event when a pin is rejected', (done) => {
    const device = { type: 'acquired', id: 'someid1234', path: '27' }

    TrezorBridge.once('trezor:invalidPin', (reportedDevice) => {
      try {
        expect(reportedDevice).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI_EVENTS.PIN_INVALID, payload: { device } })
  })

  it('emits a pinAttemptsDepleted event when the current attempt sequence ends', (done) => {
    const device = { type: 'acquired', id: 'someid1234', path: '27' }

    expect(UI_EVENTS.PIN_INVALID_ATTEMPTS_DEPLETED).toBe('ui-event_pin_invalid_attempts_depleted')

    TrezorBridge.once('trezor:pinAttemptsDepleted', (reportedDevice) => {
      try {
        expect(reportedDevice).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI_EVENTS.PIN_INVALID_ATTEMPTS_DEPLETED, payload: { device } })
  })

  it('emits a needPhrase event when a passphrase is requested and entry on the device is not supported', (done) => {
    const device = { type: 'acquired', id: 'someid1234', path: '27' }
    const payload = { device, features: { capabilities: [] } }

    TrezorBridge.once('trezor:needPhrase', (reportedDevice) => {
      try {
        expect(reportedDevice).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_REQUEST, { type: UI_REQUESTS.REQUEST_PASSPHRASE, requestId: 'phrase-1', payload })
  })

  it('emits a needPairing event when a thp pairing tag is requested', (done) => {
    const device = { type: 'acquired', path: '27' }
    const payload = { device, availableMethods: [2], selectedMethod: 2 }

    TrezorBridge.once('trezor:needPairing', (request) => {
      try {
        expect(request).toEqual({ ...payload, requestId: 'pair-1' })
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_REQUEST, {
      type: UI_REQUESTS.REQUEST_THP_PAIRING_TAG,
      requestId: 'pair-1',
      payload
    })
  })
})

describe('requests', () => {
  it('serializes device requests so prompts cannot cross over', async () => {
    let resolveFeatures
    TrezorConnect.getFeatures.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFeatures = resolve
      })
    )
    TrezorConnect.ethereumGetAddress.mockResolvedValueOnce({
      id: 2,
      success: true,
      payload: { address: '0xabc' }
    })

    const features = TrezorBridge.getFeatures({ path: '41' })
    const address = TrezorBridge.getAddress({ path: '41' }, "m/44'/60'/0'/0/0")
    await Promise.resolve()

    expect(TrezorConnect.ethereumGetAddress).not.toHaveBeenCalled()

    resolveFeatures({ id: 1, success: true, payload: { model: 'T' } })
    await expect(features).resolves.toEqual({ model: 'T' })
    await expect(address).resolves.toBe('0xabc')
  })

  it('cancels a delayed conflict retry when the bridge closes', async () => {
    TrezorConnect.getFeatures.mockResolvedValueOnce({
      id: 1,
      success: false,
      error: { message: 'Call in progress', code: 'Device_CallInProgress' }
    })

    const features = TrezorBridge.getFeatures({ path: '41' })
    await Promise.resolve()
    await Promise.resolve()
    await TrezorBridge.close()

    await expect(features).rejects.toThrow('Trezor bridge closed')
  })

  it('loads features for a given device', async () => {
    const features = { vendor: 'trezor.io', device_id: 'G89EDFE91829DACC6B43' }

    TrezorConnect.getFeatures.mockImplementation(async (params) => {
      expect(params.device).toEqual({ path: '41' })
      return { id: 1, success: true, payload: features }
    })

    const loadedFeatures = await TrezorBridge.getFeatures({
      path: '41',
      state: undefined,
      mutableEventField: 'not-a-command-parameter'
    })

    expect(loadedFeatures).toEqual(features)
  })

  it('gets the public key for a given device', async () => {
    const key = { chainCode: 'eth', fingerprint: 19912902490 }

    TrezorConnect.ethereumGetPublicKey.mockImplementation(async (params) => {
      expect(params.device).toEqual({ path: '4', state: 'session@device:1' })
      expect(params.path).toBe("m/44'/60'/0/1/0")
      return { id: 1, success: true, payload: key }
    })

    const publicKey = await TrezorBridge.getPublicKey(
      { path: '4', state: 'session@device:1' },
      "m/44'/60'/0/1/0"
    )

    expect(publicKey).toEqual(key)
    expect(TrezorConnect.getPublicKey).not.toHaveBeenCalled()
  })

  it('gets the signature after signing a transaction', async () => {
    const tx = { chainId: '0x4', type: '0x2', value: '0x1929' }

    TrezorConnect.ethereumSignTransaction.mockImplementation(async (params) => {
      expect(params.device.path).toBe('11')
      expect(params.path).toBe("m/44'/60'/0'/4/0")
      expect(params.transaction).toEqual(tx)
      return { id: 1, success: true, payload: { v: 1, r: 2, s: 3 } }
    })

    const signature = await TrezorBridge.signTransaction({ path: '11' }, "m/44'/60'/0'/4/0", tx)

    expect(signature).toEqual({ v: 1, r: 2, s: 3 })
  })

  it('reports transaction dispatch only when the serialized device request actually starts', async () => {
    let resolveFeatures
    TrezorConnect.getFeatures.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFeatures = resolve
      })
    )
    TrezorConnect.ethereumSignTransaction.mockResolvedValueOnce({
      id: 2,
      success: true,
      payload: { v: 1, r: 2, s: 3 }
    })
    const onDispatch = jest.fn()
    const features = TrezorBridge.getFeatures({ path: '11' })
    const signing = TrezorBridge.signTransaction(
      { path: '11' },
      "m/44'/60'/0'/4/0",
      { chainId: '0x1' },
      onDispatch
    )
    await Promise.resolve()

    expect(onDispatch).not.toHaveBeenCalled()
    expect(TrezorConnect.ethereumSignTransaction).not.toHaveBeenCalled()

    resolveFeatures({ id: 1, success: true, payload: { model: 'T' } })
    await features
    await expect(signing).resolves.toEqual({ v: 1, r: 2, s: 3 })
    expect(onDispatch).toHaveBeenCalledTimes(1)
    expect(onDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      TrezorConnect.ethereumSignTransaction.mock.invocationCallOrder[0]
    )
  })

  it('forwards an active transaction cancellation to Trezor Connect', () => {
    TrezorBridge.cancelCurrentRequest()

    expect(TrezorConnect.cancel).toHaveBeenCalledWith('Transaction signing cancelled in Wren')
  })

  it('sends a pairing response back to trezor connect', () => {
    TrezorConnect.emit(UI_REQUEST, {
      type: UI_REQUESTS.REQUEST_THP_PAIRING_TAG,
      requestId: 'pair-1',
      payload: { device: { path: '27' } }
    })
    TrezorBridge.pairingEntered(trezorSignerId('27'), { tag: 'ABC123' }, 'pair-1')

    expect(TrezorConnect.uiResponse).toHaveBeenCalledWith({
      type: UI_RESPONSE.RECEIVE_THP_PAIRING_TAG,
      requestId: 'pair-1',
      payload: { tag: 'ABC123' }
    })
  })

  it('correlates PIN responses to the requesting device and ignores wrong types and duplicates', () => {
    TrezorBridge.pinEntered(trezorSignerId('27'), 'absent', 'pin-27')
    TrezorConnect.emit(UI_REQUEST, {
      type: UI_REQUESTS.REQUEST_PIN,
      requestId: 'pin-27',
      payload: { device: { path: '27' } }
    })
    TrezorBridge.pinEntered(trezorSignerId('28'), 'wrong-device', 'pin-27')
    TrezorBridge.passphraseEntered(trezorSignerId('27'), 'wrong-type', 'pin-27')
    expect(TrezorConnect.uiResponse).not.toHaveBeenCalled()

    TrezorBridge.pinEntered(trezorSignerId('27'), '1234', 'pin-27')
    TrezorBridge.pinEntered(trezorSignerId('27'), 'duplicate', 'pin-27')
    expect(TrezorConnect.uiResponse).toHaveBeenCalledTimes(1)
    expect(TrezorConnect.uiResponse).toHaveBeenCalledWith({
      type: UI_RESPONSE.RECEIVE_PIN,
      requestId: 'pin-27',
      payload: '1234'
    })
  })

  it.each(['cancelAuthentication', 'cancelCurrentRequest'])(
    '%s discards pending authentication responses',
    (cancel) => {
      TrezorConnect.emit(UI_REQUEST, {
        type: UI_REQUESTS.REQUEST_PASSPHRASE,
        requestId: 'phrase-27',
        payload: { device: { path: '27' } }
      })
      TrezorBridge[cancel]()
      TrezorBridge.passphraseEntered(trezorSignerId('27'), 'stale', 'phrase-27')
      expect(TrezorConnect.uiResponse).not.toHaveBeenCalled()
    }
  )

  it('discards disconnected and previous-lifecycle prompts', async () => {
    const prompt = {
      type: UI_REQUESTS.REQUEST_PIN,
      requestId: 'pin-27',
      payload: { device: { path: '27' } }
    }
    TrezorConnect.emit(UI_REQUEST, prompt)
    TrezorConnect.emit(DEVICE_EVENT, { type: DEVICE.DISCONNECT, payload: { path: '27' } })
    TrezorBridge.pinEntered(trezorSignerId('27'), 'disconnected', 'pin-27')
    TrezorConnect.emit(UI_REQUEST, prompt)
    await TrezorBridge.close()
    await TrezorBridge.open()
    TrezorBridge.pinEntered(trezorSignerId('27'), 'previous-lifecycle', 'pin-27')
    expect(TrezorConnect.uiResponse).not.toHaveBeenCalled()
  })

  it('cancels unsupported SDK requests and discards an earlier PIN prompt', () => {
    TrezorConnect.emit(UI_REQUEST, {
      type: UI_REQUESTS.REQUEST_PIN,
      requestId: 'pin-27',
      payload: { device: { path: '27' } }
    })
    TrezorConnect.emit(UI_REQUEST, { type: 'ui-request_confirmation', requestId: 'unsupported' })
    TrezorBridge.pinEntered(trezorSignerId('27'), 'stale', 'pin-27')
    expect(TrezorConnect.cancel).toHaveBeenCalledWith('Unsupported Trezor authentication request in Wren')
    expect(TrezorConnect.uiResponse).not.toHaveBeenCalled()
  })

  it('rejects a cancelled PIN reply after a replacement prompt for the same device', () => {
    const prompt = {
      type: UI_REQUESTS.REQUEST_PIN,
      requestId: 'pin-old',
      payload: { device: { path: '27' } }
    }
    TrezorConnect.emit(UI_REQUEST, prompt)
    TrezorBridge.cancelAuthentication()
    TrezorConnect.emit(UI_REQUEST, { ...prompt, requestId: 'pin-new' })
    TrezorBridge.pinEntered(trezorSignerId('27'), 'old-pin', 'pin-old')
    TrezorBridge.pinEntered(trezorSignerId('27'), 'missing-token')
    expect(TrezorConnect.uiResponse).not.toHaveBeenCalled()
    TrezorBridge.pinEntered(trezorSignerId('27'), 'new-pin', 'pin-new')
    expect(TrezorConnect.uiResponse).toHaveBeenCalledWith({
      type: UI_RESPONSE.RECEIVE_PIN,
      requestId: 'pin-new',
      payload: 'new-pin'
    })
  })

  it.each([false, true])('correlates passphrase entry on device=%s', (onDevice) => {
    TrezorConnect.emit(UI_REQUEST, {
      type: UI_REQUESTS.REQUEST_PASSPHRASE,
      requestId: 'phrase-27',
      payload: { device: { path: '27' } }
    })
    if (onDevice) TrezorBridge.enterPassphraseOnDevice(trezorSignerId('27'), 'phrase-27')
    else TrezorBridge.passphraseEntered(trezorSignerId('27'), '', 'phrase-27')
    expect(TrezorConnect.uiResponse).toHaveBeenCalledWith({
      type: UI_RESPONSE.RECEIVE_PASSPHRASE,
      requestId: 'phrase-27',
      payload: onDevice ? { value: '', passphraseOnDevice: true, save: true } : { save: true, value: '' }
    })
  })

  it('preserves a new prompt when a previous lifecycle request settles late', async () => {
    let resolvePrevious
    const previousSdkResponse = new Promise((resolve) => {
      resolvePrevious = resolve
    })
    TrezorConnect.getFeatures.mockReturnValueOnce(previousSdkResponse)
    const previousRequest = TrezorBridge.getFeatures({ path: '27' })
    const previousResult = previousRequest.catch((error) => error)
    await Promise.resolve()
    await Promise.resolve()
    await TrezorBridge.close()
    await TrezorBridge.open()
    TrezorConnect.emit(UI_REQUEST, {
      type: UI_REQUESTS.REQUEST_PIN,
      requestId: 'current-pin',
      payload: { device: { path: '27' } }
    })
    resolvePrevious({ success: true, payload: {} })
    await expect(previousResult).resolves.toEqual(new Error('Trezor bridge closed'))
    TrezorBridge.pinEntered(trezorSignerId('27'), 'current-value', 'current-pin')
    expect(TrezorConnect.uiResponse).toHaveBeenCalledWith({
      type: UI_RESPONSE.RECEIVE_PIN,
      requestId: 'current-pin',
      payload: 'current-value'
    })
  })

  it('preserves SDK 10 error messages and codes', async () => {
    TrezorConnect.getFeatures.mockResolvedValueOnce({
      success: false,
      error: { message: 'Device is disconnected', code: 'Device_Disconnected' }
    })
    await expect(TrezorBridge.getFeatures({ path: '27' })).rejects.toMatchObject({
      message: 'Device is disconnected',
      code: 'Device_Disconnected'
    })
  })
})
