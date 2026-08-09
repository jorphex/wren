import store from '../../../../main/store'
import server from '../../../../main/dapps/server'
import viewInstances, { embeddedDappOrigin } from '../../../../main/windows/frames/viewInstances'
import { createViewInstance } from '../../../../main/windows/window'

jest.mock('../../../../main/store', () => jest.fn())
jest.mock('../../../../main/dapps/server', () => ({
  sessions: { remove: jest.fn(), verify: jest.fn() }
}))
jest.mock('../../../../main/windows/window', () => ({ createViewInstance: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  store.mockReset()
})

const createFrameWindow = () => {
  const view = { setBounds: jest.fn() }
  return {
    frame: {
      frameId: 'frame',
      getBounds: () => ({ width: 800, height: 600 }),
      views: { view }
    },
    view
  }
}

describe('WebContentsView creation', () => {
  it('uses the canonical local origin expected by embedded dapp permissions', () => {
    expect(embeddedDappOrigin('send.frame.eth')).toBe('http://send.frame.eth.localhost:8421')
  })

  it('rewrites embedded Send requests to its canonical permission origin', () => {
    const onBeforeSendHeaders = jest.fn()
    const viewInstance = {
      setBounds: jest.fn(),
      webContents: {
        session: {
          webRequest: { onBeforeSendHeaders },
          cookies: { set: jest.fn(() => new Promise(() => {})) }
        },
        setVisualZoomLevelLimits: jest.fn(),
        once: jest.fn(),
        loadURL: jest.fn()
      }
    }
    const frame = {
      contentView: { addChildView: jest.fn(), removeChildView: jest.fn() },
      frameId: 'frame',
      getBounds: () => ({ width: 800, height: 600 })
    }
    const view = {
      id: 'send',
      dappId: 'send',
      ens: 'send.frame.eth',
      url: 'http://send.frame.eth.localhost:8421/?session=session'
    }
    store.mockImplementation((...path) => (path[0] === 'main.frames' ? { fullscreen: false } : undefined))
    createViewInstance.mockReturnValue(viewInstance)
    server.sessions.verify.mockReturnValue(true)

    viewInstances.create(frame, view)
    const rewrite = onBeforeSendHeaders.mock.calls[0][0]
    const respond = jest.fn()
    rewrite(
      {
        frame: { url: view.url },
        resourceType: 'xmlhttprequest',
        url: 'http://127.0.0.1:1248',
        requestHeaders: { Origin: 'send.frame.eth' }
      },
      respond
    )

    expect(respond).toHaveBeenCalledWith({
      requestHeaders: { Origin: 'http://send.frame.eth.localhost:8421' }
    })
  })

  it('rejects missing frame state before allocating a view', () => {
    store.mockReturnValue(undefined)

    expect(() => viewInstances.create({ frameId: 'missing' }, { ens: 'app.example' })).toThrow(
      'Frame missing is unavailable while creating a view'
    )
    expect(createViewInstance).not.toHaveBeenCalled()
  })
})

describe('WebContentsView positioning', () => {
  it('reserves the frame title area in windowed mode', () => {
    const { frame, view } = createFrameWindow()
    store.mockReturnValue({ fullscreen: false })

    viewInstances.position(frame, 'view')

    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 32, width: 800, height: 568 })
  })

  it('fills the complete frame in fullscreen mode', () => {
    const { frame, view } = createFrameWindow()
    store.mockReturnValue({ fullscreen: true })

    viewInstances.position(frame, 'view')

    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 800, height: 600 })
  })

  it('ignores positioning after the frame has been removed from state', () => {
    const { frame, view } = createFrameWindow()
    store.mockReturnValue(undefined)

    viewInstances.position(frame, 'view')

    expect(view.setBounds).not.toHaveBeenCalled()
  })
})

describe('WebContentsView destruction', () => {
  it('detaches the view and closes its web contents without waiting for unload', () => {
    const view = { webContents: { close: jest.fn() } }
    const frame = {
      contentView: { removeChildView: jest.fn() },
      frameId: 'frame',
      isDestroyed: () => false,
      views: { view }
    }
    store.mockReturnValue({ url: 'https://app.example/?session=session' })

    viewInstances.destroy(frame, 'view')

    expect(frame.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(server.sessions.remove).toHaveBeenCalledWith('', 'session')
    expect(frame.views).not.toHaveProperty('view')
  })

  it('still closes a live view after its state metadata has been removed', () => {
    const view = { webContents: { close: jest.fn() } }
    const frame = {
      contentView: { removeChildView: jest.fn() },
      frameId: 'frame',
      isDestroyed: () => false,
      views: { view }
    }
    store.mockReturnValue(undefined)

    viewInstances.destroy(frame, 'view')

    expect(server.sessions.remove).not.toHaveBeenCalled()
    expect(frame.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(frame.views).not.toHaveProperty('view')
  })
})
