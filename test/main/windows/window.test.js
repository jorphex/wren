import { BrowserWindow, shell, WebContentsView } from 'electron'
import path from 'path'

import {
  createRendererView,
  createViewInstance,
  createWindow,
  openBlockExplorer,
  openExternal
} from '../../../main/windows/window'
import store from '../../../main/store'

const createMockSession = () => ({
  on: jest.fn(),
  setBluetoothPairingHandler: jest.fn(),
  setDevicePermissionHandler: jest.fn(),
  setDisplayMediaRequestHandler: jest.fn(),
  setPermissionCheckHandler: jest.fn(),
  setPermissionRequestHandler: jest.fn()
})

const mockWindow = {
  webContents: {
    on: jest.fn(),
    once: jest.fn(),
    session: createMockSession(),
    setWindowOpenHandler: jest.fn()
  }
}

const mockView = {
  setBackgroundColor: jest.fn(),
  webContents: {
    on: jest.fn(),
    session: createMockSession(),
    setWindowOpenHandler: jest.fn()
  }
}

jest.mock('electron', () => ({
  BrowserWindow: jest.fn(() => mockWindow),
  shell: { openExternal: jest.fn() },
  WebContentsView: jest.fn(() => mockView)
}))

jest.mock('../../../main/store', () => jest.fn())

const originalBundleLocation = process.env.BUNDLE_LOCATION

beforeEach(() => {
  mockWindow.webContents.session = createMockSession()
  mockView.webContents.session = createMockSession()
  mockView.webContents.on.mockClear()
})

beforeAll(() => {
  process.env.BUNDLE_LOCATION = '/tmp/frame-test-bundle'
})

afterAll(() => {
  if (originalBundleLocation === undefined) {
    delete process.env.BUNDLE_LOCATION
  } else {
    process.env.BUNDLE_LOCATION = originalBundleLocation
  }
})

describe('createWindow', () => {
  it('preserves square frameless windows on Linux', () => {
    createWindow('tray')

    const options = BrowserWindow.mock.calls[0][0]
    expect(options).toEqual(
      expect.objectContaining({
        frame: false,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          additionalArguments: ['--frame-renderer-role=tray'],
          nodeIntegration: false,
          sandbox: true
        })
      })
    )

    if (process.platform === 'linux') {
      expect(options.roundedCorners).toBe(false)
    } else {
      expect(options).not.toHaveProperty('roundedCorners')
    }
  })

  it.each([
    ['dash', 'dash'],
    ['notify', 'notify'],
    ['onboard', 'onboard'],
    ['tray', 'tray'],
    ['frameInstance', 'dapp']
  ])('maps %s windows to the %s renderer role', (windowName, role) => {
    createWindow(windowName, undefined, { additionalArguments: ['--existing'] })

    expect(BrowserWindow.mock.calls[0][0].webPreferences.additionalArguments).toEqual([
      '--existing',
      `--frame-renderer-role=${role}`
    ])
  })

  it('rejects windows without an explicit renderer role', () => {
    expect(() => createWindow('unknown')).toThrow('has no renderer IPC role')
  })
})

describe('createViewInstance', () => {
  it('creates an isolated transparent view with a persistent dapp partition', () => {
    createViewInstance('app.example')

    expect(WebContentsView).toHaveBeenCalledWith({
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:app.example',
        preload: path.resolve(__dirname, '../../../main/windows/viewPreload.js'),
        sandbox: true,
        webviewTag: false
      })
    })
    expect(mockView.setBackgroundColor).toHaveBeenCalledWith('#00000000')
    expect(mockView.webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function))
    expect(mockView.webContents.on).toHaveBeenCalledWith('will-attach-webview', expect.any(Function))
    expect(mockView.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function))
  })

  it('denies browser and device permissions for embedded dapps', () => {
    createViewInstance('app.example')

    const session = mockView.webContents.session
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    expect(session.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false)

    const permissionCallback = jest.fn()
    session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)

    const displayCallback = jest.fn()
    session.setDisplayMediaRequestHandler.mock.calls[0][0](null, displayCallback)
    expect(displayCallback).toHaveBeenCalledWith({})

    const pairingCallback = jest.fn()
    session.setBluetoothPairingHandler.mock.calls[0][0](null, pairingCallback)
    expect(pairingCallback).toHaveBeenCalledWith({ confirmed: false })
  })

  it.each([
    ['select-hid-device', []],
    ['select-usb-device', []],
    ['select-serial-port', ['']],
    ['select-bluetooth-device', ['']]
  ])('cancels %s selection', (eventName, expectedArguments) => {
    createViewInstance('app.example')
    const emitter =
      eventName === 'select-bluetooth-device' ? mockView.webContents : mockView.webContents.session
    const registration = emitter.on.mock.calls.find(([name]) => name === eventName)
    const event = { preventDefault: jest.fn() }
    const callback = jest.fn()

    if (eventName === 'select-serial-port') registration[1](event, [], null, callback)
    else registration[1](event, [], callback)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(...expectedArguments)
  })
})

describe('createRendererView', () => {
  it('creates a hardened dashboard view with the dashboard renderer role', () => {
    createRendererView('dash', { additionalArguments: ['--existing'] })

    expect(WebContentsView).toHaveBeenCalledWith({
      webPreferences: expect.objectContaining({
        additionalArguments: ['--existing', '--frame-renderer-role=dash'],
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve('/tmp/frame-test-bundle', 'bridge.js'),
        sandbox: true,
        webviewTag: false
      })
    })
    expect(mockView.webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function))
    expect(mockView.webContents.on).toHaveBeenCalledWith('will-attach-webview', expect.any(Function))
    expect(mockView.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function))
  })

  it('rejects renderer views without an explicit role', () => {
    expect(() => createRendererView('unknown')).toThrow('has no renderer IPC role')
  })
})

describe('openExternal', () => {
  beforeEach(() => {
    shell.openExternal.mockClear()
  })

  it('allows Yearn vault pages without allowing lookalike hosts', () => {
    shell.openExternal.mockClear()

    openExternal('https://yearn.fi/vaults/1/0x696d02Db93291651ED510704c9b286841d506987')
    openExternal('https://yearn.fi.evil.example/vaults/1/0x696d02Db93291651ED510704c9b286841d506987')

    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://yearn.fi/vaults/1/0x696d02Db93291651ED510704c9b286841d506987'
    )
  })

  it('opens only the fork companion release path', () => {
    openExternal('https://github.com/jorphex/wren-companion/releases/tag/v0.12.1')
    openExternal('https://github.com/jorphex/wren-companion/security')
    openExternal('https://github.com/jorphex/wren-companion.evil.example/releases')

    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/jorphex/wren-companion/releases/tag/v0.12.1'
    )
  })

  it('opens fork update releases but rejects upstream and lookalike pages', () => {
    openExternal('https://github.com/jorphex/wren/releases/tag/v0.7.0-rc.1')
    openExternal('https://github.com/floating/frame/releases/tag/v0.7.0-rc.1')
    openExternal('https://github.com.evil.example/jorphex/wren/releases/tag/v0.7.0-rc.1')

    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/jorphex/wren/releases/tag/v0.7.0-rc.1'
    )
  })

  it('allows current community support links and rejects abandoned upstream channels', () => {
    openExternal('https://github.com/jorphex/wren/blob/main/LICENSE')
    openExternal('https://github.com/jorphex/wren/issues/new')
    openExternal('https://github.com/floating/frame/blob/master/LICENSE')
    openExternal('https://feedback.frame.sh')
    openExternal('https://discord.gg/UH7NGqY')

    expect(shell.openExternal.mock.calls).toEqual([
      ['https://github.com/jorphex/wren/blob/main/LICENSE'],
      ['https://github.com/jorphex/wren/issues/new']
    ])
  })

  it('allows official hardware shops without retaining legacy affiliate links', () => {
    openExternal('https://shop.ledger.com/')
    openExternal('https://shop.trezor.io/')
    openExternal('https://shop.ledger.com/pages/ledger-nano-x?r=1fb484cde64f')
    openExternal('https://shop.trezor.io/?offer_id=10&aff_id=3270')

    expect(shell.openExternal.mock.calls).toEqual([['https://shop.ledger.com/'], ['https://shop.trezor.io/']])
  })
})

describe('openBlockExplorer', () => {
  beforeEach(() => {
    shell.openExternal.mockClear()
    store.mockReset()
  })

  it('opens a configured HTTP(S) explorer path', () => {
    store.mockReturnValue('https://explorer.example/base/')

    openBlockExplorer({ id: 1, type: 'ethereum' }, '0x1234')

    expect(shell.openExternal).toHaveBeenCalledWith('https://explorer.example/base/tx/0x1234')
  })

  it.each([
    'file:///tmp/frame-wallet',
    'javascript:alert(1)',
    'https://user:password@explorer.example',
    'not a URL'
  ])('rejects an unsafe configured explorer URL: %s', (explorer) => {
    store.mockReturnValue(explorer)

    openBlockExplorer({ id: 1, type: 'ethereum' }, '0x1234')

    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
