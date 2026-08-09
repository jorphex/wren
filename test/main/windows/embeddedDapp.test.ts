import { EventEmitter } from 'events'

import server from '../../../main/dapps/server'
import { EmbeddedDapp, dashContentTop } from '../../../main/windows/embeddedDapp'
import { loadDappView } from '../../../main/windows/dappView'
import { createViewInstance } from '../../../main/windows/window'

jest.mock('../../../main/dapps/server', () => ({ sessions: { remove: jest.fn() } }))
jest.mock('../../../main/windows/dappView', () => ({
  extractDappSession: jest.fn(() => ({ ens: 'send.frame.eth', session: 'session' })),
  loadDappView: jest.fn(() => Promise.resolve())
}))
jest.mock('../../../main/windows/window', () => ({ createViewInstance: jest.fn() }))

const descriptor = {
  id: 'send',
  ready: false,
  dappId: 'send',
  ens: 'send.frame.eth',
  url: 'http://send.frame.eth.localhost:8421/?session=session'
}

const createSetup = () => {
  const webContents = {
    close: jest.fn(),
    focus: jest.fn(),
    isDestroyed: jest.fn(() => false),
    setVisualZoomLevelLimits: jest.fn()
  }
  const view = { setBounds: jest.fn(), setVisible: jest.fn(), webContents }
  const parent = {
    contentView: { addChildView: jest.fn(), removeChildView: jest.fn() },
    isDestroyed: jest.fn(() => false)
  }
  const app = new EventEmitter()
  let finishLoad = () => {}
  ;(createViewInstance as jest.Mock).mockReturnValue(view)
  ;(loadDappView as jest.Mock).mockImplementation((_view, _descriptor, onLoaded) => {
    finishLoad = onLoaded
    return Promise.resolve()
  })

  const onReady = jest.fn()
  const embedded = new EmbeddedDapp(parent as never, descriptor, onReady, app as never)
  return { app, embedded, finishLoad: () => finishLoad(), onReady, parent, view, webContents }
}

beforeEach(() => jest.clearAllMocks())

it('keeps Send hidden until loaded and reserves the dashboard command area', () => {
  const { embedded, finishLoad, onReady, view, webContents } = createSetup()

  embedded.applyLayout({ x: 0, y: 0, width: 620, height: 900 }, true, true)

  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 0,
    y: dashContentTop,
    width: 620,
    height: 900 - dashContentTop
  })
  expect(view.setVisible).toHaveBeenLastCalledWith(false)
  expect(webContents.focus).not.toHaveBeenCalled()

  finishLoad()

  expect(view.setVisible).toHaveBeenLastCalledWith(true)
  expect(webContents.focus).toHaveBeenCalledTimes(1)
  expect(onReady).toHaveBeenCalledTimes(1)
})

it('hides without discarding the active Send session', () => {
  const { embedded, finishLoad, view, webContents } = createSetup()
  embedded.applyLayout({ x: 0, y: 0, width: 620, height: 900 }, true)
  finishLoad()

  embedded.hide()
  embedded.focus()

  expect(view.setVisible).toHaveBeenLastCalledWith(false)
  expect(webContents.close).not.toHaveBeenCalled()
})

it('identifies the active dapp so repeated entry can focus without replacing it', () => {
  const { embedded } = createSetup()

  expect(embedded.matches('send.frame.eth')).toBe(true)
  expect(embedded.matches('other.example')).toBe(false)

  embedded.destroy()
  expect(embedded.matches('send.frame.eth')).toBe(false)
})

it('removes the session and closes the child view exactly once', () => {
  const { app, embedded, parent, webContents } = createSetup()

  embedded.destroy()
  embedded.destroy()

  expect(server.sessions.remove).toHaveBeenCalledWith('send.frame.eth', 'session')
  expect(parent.contentView.removeChildView).toHaveBeenCalledTimes(1)
  expect(webContents.close).toHaveBeenCalledTimes(1)
  expect(webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  expect(app.listenerCount('before-quit')).toBe(0)
})
