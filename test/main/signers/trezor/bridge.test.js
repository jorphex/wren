import TrezorConnect, { DEVICE_EVENT, DEVICE, UI_EVENT, UI } from '@trezor/connect'
import { EventEmitter } from 'stream'
import log from 'electron-log'

import TrezorBridge from '../../../../main/signers/trezor/bridge'
import { FrameNodeUsbTransport } from '../../../../main/signers/trezor/nodeUsbTransport'

jest.mock('@trezor/connect')

const events = new EventEmitter()

beforeAll(() => {
  log.transports.console.level = false

  TrezorConnect.on = events.on.bind(events)
  TrezorConnect.once = events.once.bind(events)
  TrezorConnect.emit = events.emit.bind(events)
  TrezorConnect.removeAllListeners = events.removeAllListeners.bind(events)
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

beforeEach((done) => {
  TrezorBridge.once('connect', done)
  TrezorBridge.open()
})

afterEach(() => {
  TrezorBridge.close()
})

describe('connect events', () => {
  it("initializes Trezor Connect with Wren's guarded NodeUsb transport", () => {
    expect(TrezorConnect.init).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: {
          appName: 'Wren',
          appUrl: 'https://github.com/jorphex/wren',
          email: 'jorphex@users.noreply.github.com'
        },
        transports: [FrameNodeUsbTransport]
      })
    )
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
  it('emits a needPin event when a pin is requested', (done) => {
    const device = { type: 'acquired', id: 'someid1234' }

    TrezorBridge.once('trezor:needPin', (device) => {
      try {
        expect(device).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI.REQUEST_PIN, payload: { device } })
  })

  it('emits an invalidPin event when a pin is rejected', (done) => {
    const device = { type: 'acquired', id: 'someid1234' }

    TrezorBridge.once('trezor:invalidPin', (reportedDevice) => {
      try {
        expect(reportedDevice).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI.INVALID_PIN, payload: { device } })
  })

  it('emits a pinAttemptsDepleted event when the current attempt sequence ends', (done) => {
    const device = { type: 'acquired', id: 'someid1234' }

    expect(UI.INVALID_PIN_ATTEMPTS_DEPLETED).toBe('ui-invalid_pin_attempts_depleted')

    TrezorBridge.once('trezor:pinAttemptsDepleted', (reportedDevice) => {
      try {
        expect(reportedDevice).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI.INVALID_PIN_ATTEMPTS_DEPLETED, payload: { device } })
  })

  it('emits a needPhrase event when a passphrase is requested and entry on the device is not supported', (done) => {
    const device = { type: 'acquired', id: 'someid1234' }
    const payload = { device, features: { capabilities: [] } }

    TrezorBridge.once('trezor:needPhrase', (device) => {
      try {
        expect(device).toEqual(device)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI.REQUEST_PASSPHRASE, payload })
  })

  it('emits a needPairing event when a thp pairing tag is requested', (done) => {
    const device = { type: 'acquired', path: '27' }
    const payload = { device, availableMethods: [2], selectedMethod: 2 }

    TrezorBridge.once('trezor:needPairing', (request) => {
      try {
        expect(request).toEqual(payload)
        done()
      } catch (e) {
        done(e)
      }
    })

    TrezorConnect.emit(UI_EVENT, { type: UI.REQUEST_THP_PAIRING, payload })
  })
})

describe('requests', () => {
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

    TrezorConnect.getPublicKey.mockImplementation(async (params) => {
      expect(params.device).toEqual({ path: '4', state: 'session@device:1' })
      expect(params.path).toBe("m/44'/60'/0/1/0")
      return { id: 1, success: true, payload: key }
    })

    const publicKey = await TrezorBridge.getPublicKey(
      { path: '4', state: 'session@device:1' },
      "m/44'/60'/0/1/0"
    )

    expect(publicKey).toEqual(key)
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

  it('sends a pairing response back to trezor connect', () => {
    TrezorBridge.pairingEntered('device-id', { tag: 'ABC123' })

    expect(TrezorConnect.uiResponse).toHaveBeenCalledWith({
      type: UI.RECEIVE_THP_PAIRING_TAG,
      payload: { tag: 'ABC123' }
    })
  })
})
