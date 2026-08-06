import { EventEmitter } from 'events'
import { EmbeddedWorkspace } from '../../../main/windows/embeddedWorkspace'

const createSetup = () => {
  const webContents = {
    close: jest.fn(),
    focus: jest.fn(),
    getOSProcessId: jest.fn(() => 42),
    isDestroyed: jest.fn(() => false),
    loadURL: jest.fn(),
    on: jest.fn(),
    openDevTools: jest.fn(),
    reload: jest.fn(),
    send: jest.fn()
  }
  const view = {
    setBounds: jest.fn(),
    setVisible: jest.fn(),
    webContents
  }
  const parent = {
    contentView: {
      addChildView: jest.fn(),
      removeChildView: jest.fn()
    },
    isDestroyed: jest.fn(() => false),
    setBounds: jest.fn()
  }
  const app = new EventEmitter()
  const workspace = new EmbeddedWorkspace(parent as never, view as never, app as never)
  return { app, parent, view, webContents, workspace }
}

it('attaches once, starts hidden, and applies local pane bounds', () => {
  const { parent, view, workspace } = createSetup()
  const bounds = { x: 0, y: 0, width: 520, height: 720 }

  workspace.applyLayout(bounds, true)

  expect(parent.contentView.addChildView).toHaveBeenCalledTimes(1)
  expect(view.setBounds).toHaveBeenCalledWith(bounds)
  expect(view.setVisible.mock.calls).toEqual([[false], [true]])
  expect(workspace.isVisible()).toBe(true)
})

it('coordinates parent expansion with child bounds and visibility', () => {
  const { parent, view, workspace } = createSetup()
  const windowBounds = { x: 640, y: 204, width: 1280, height: 720 }
  const viewBounds = { x: 0, y: 0, width: 520, height: 720 }

  workspace.applyShellLayout(windowBounds, viewBounds, true)

  expect(parent.setBounds).toHaveBeenCalledWith(windowBounds, false)
  expect(view.setBounds).toHaveBeenCalledWith(viewBounds)
  expect(view.setVisible.mock.calls).toEqual([[false], [true]])
  expect(parent.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
    view.setBounds.mock.invocationCallOrder[0]
  )
  expect(view.setBounds.mock.invocationCallOrder[0]).toBeLessThan(view.setVisible.mock.invocationCallOrder[1])
  expect(workspace.isVisible()).toBe(true)
})

it('moves focus into and out of visibility without recreating the view', () => {
  const { view, webContents, workspace } = createSetup()

  workspace.show()
  workspace.hide()

  expect(view.setVisible.mock.calls).toEqual([[false], [true], [false]])
  expect(webContents.focus).toHaveBeenCalledTimes(1)
  expect(workspace.isVisible()).toBe(false)
})

it('forwards state updates and reloads while active', () => {
  const { webContents, workspace } = createSetup()

  workspace.send('main:action', 'stateSync', '{}')
  workspace.reload()

  expect(webContents.send).toHaveBeenCalledWith('main:action', 'stateSync', '{}')
  expect(webContents.reload).toHaveBeenCalledTimes(1)
})

it('detaches and closes web contents exactly once', () => {
  const { app, parent, webContents, workspace } = createSetup()

  workspace.destroy()
  workspace.destroy()

  expect(parent.contentView.removeChildView).toHaveBeenCalledTimes(1)
  expect(webContents.close).toHaveBeenCalledTimes(1)
  expect(webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  expect(app.listenerCount('before-quit')).toBe(0)
  expect(workspace.isVisible()).toBe(false)
})

it('detaches and closes web contents before application shutdown', () => {
  const { app, parent, webContents, workspace } = createSetup()

  app.emit('before-quit')

  expect(parent.contentView.removeChildView).toHaveBeenCalledTimes(1)
  expect(webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  expect(app.listenerCount('before-quit')).toBe(0)
  expect(workspace.isVisible()).toBe(false)
})
