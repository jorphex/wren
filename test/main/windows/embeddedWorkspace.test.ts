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
    getBounds: jest.fn(() => ({ x: 1160, y: 114, width: 760, height: 900 })),
    isDestroyed: jest.fn(() => false),
    setBounds: jest.fn()
  }
  const app = new EventEmitter()
  const workspace = new EmbeddedWorkspace(parent as never, view as never, app as never)
  return { app, parent, view, webContents, workspace }
}

it('attaches once, starts hidden, and applies local pane bounds', () => {
  const { parent, view, workspace } = createSetup()
  const bounds = { x: 0, y: 0, width: 620, height: 900 }

  workspace.applyLayout(bounds, true)

  expect(parent.contentView.addChildView).toHaveBeenCalledTimes(1)
  expect(view.setBounds).toHaveBeenCalledWith(bounds)
  expect(view.setVisible.mock.calls).toEqual([[false], [true]])
  expect(workspace.isVisible()).toBe(true)
})

it('coordinates parent expansion with child bounds and visibility', () => {
  const { parent, view, workspace } = createSetup()
  const windowBounds = { x: 540, y: 114, width: 1380, height: 900 }
  const viewBounds = { x: 0, y: 0, width: 620, height: 900 }

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

it('animates expansion and lands on exact shell bounds', () => {
  jest.useFakeTimers()
  const { parent, view, workspace } = createSetup()
  const compactView = { x: 0, y: 0, width: 0, height: 900 }
  const windowBounds = { x: 540, y: 114, width: 1380, height: 900 }
  const viewBounds = { x: 0, y: 0, width: 620, height: 900 }

  workspace.applyLayout(compactView, false)
  parent.setBounds.mockClear()
  view.setBounds.mockClear()
  view.setVisible.mockClear()
  workspace.applyShellLayout(windowBounds, viewBounds, true, true)

  expect(view.setVisible).toHaveBeenCalledWith(true)
  expect(parent.setBounds).not.toHaveBeenLastCalledWith(windowBounds, false)

  jest.runAllTimers()

  expect(parent.setBounds).toHaveBeenLastCalledWith(windowBounds, false)
  expect(view.setBounds).toHaveBeenLastCalledWith(viewBounds)
  expect(view.setVisible).toHaveBeenCalledTimes(1)
  expect(workspace.isVisible()).toBe(true)
  jest.useRealTimers()
})

it('keeps a left-edge expansion anchored at the wallet seam', () => {
  jest.useFakeTimers()
  const { parent, view, workspace } = createSetup()
  const compactView = { x: 760, y: 0, width: 0, height: 900 }
  const windowBounds = { x: 0, y: 90, width: 1380, height: 900 }
  const viewBounds = { x: 760, y: 0, width: 620, height: 900 }

  parent.getBounds.mockReturnValue({ x: 0, y: 90, width: 760, height: 900 })
  workspace.applyLayout(compactView, false)
  view.setBounds.mockClear()
  workspace.applyShellLayout(windowBounds, viewBounds, true, true)

  expect(view.setBounds.mock.calls.every(([bounds]) => bounds.x === 760)).toBe(true)
  jest.runAllTimers()
  expect(view.setBounds.mock.calls.every(([bounds]) => bounds.x === 760)).toBe(true)
  jest.useRealTimers()
})

it('keeps a left-edge overlay anchored while it expands over the wallet', () => {
  jest.useFakeTimers()
  const { parent, view, workspace } = createSetup()
  const compactView = { x: 760, y: 0, width: 0, height: 744 }
  const windowBounds = { x: 0, y: 12, width: 760, height: 744 }
  const viewBounds = { x: 0, y: 0, width: 760, height: 744 }

  parent.getBounds.mockReturnValue(windowBounds)
  workspace.applyLayout(compactView, false)
  view.setBounds.mockClear()
  workspace.applyShellLayout(windowBounds, viewBounds, true, true)

  jest.runAllTimers()

  expect(view.setBounds.mock.calls.every(([bounds]) => bounds.x + bounds.width === 760)).toBe(true)
  jest.useRealTimers()
})

it('keeps the workspace visible until a collapse animation completes', () => {
  jest.useFakeTimers()
  const { parent, view, workspace } = createSetup()
  const onComplete = jest.fn()
  const expandedView = { x: 0, y: 0, width: 620, height: 900 }
  const windowBounds = { x: 1160, y: 114, width: 760, height: 900 }
  const viewBounds = { x: 0, y: 0, width: 0, height: 900 }

  parent.getBounds.mockReturnValue({ x: 540, y: 114, width: 1380, height: 900 })
  workspace.applyLayout(expandedView, true)
  view.setVisible.mockClear()
  workspace.applyShellLayout(windowBounds, viewBounds, false, true, onComplete)

  expect(view.setVisible).not.toHaveBeenCalled()
  expect(workspace.isVisible()).toBe(true)
  expect(onComplete).not.toHaveBeenCalled()

  jest.runAllTimers()

  expect(view.setVisible).toHaveBeenCalledWith(false)
  expect(workspace.isVisible()).toBe(false)
  expect(onComplete).toHaveBeenCalledTimes(1)
  jest.useRealTimers()
})

it('does not complete a cancelled shell animation', () => {
  jest.useFakeTimers()
  const { workspace } = createSetup()
  const cancelledComplete = jest.fn()
  const replacementComplete = jest.fn()

  workspace.applyShellLayout(
    { x: 540, y: 114, width: 1380, height: 900 },
    { x: 0, y: 0, width: 620, height: 900 },
    true,
    true,
    cancelledComplete
  )
  workspace.applyShellLayout(
    { x: 1160, y: 114, width: 760, height: 900 },
    { x: 0, y: 0, width: 0, height: 900 },
    false,
    true,
    replacementComplete
  )

  jest.runAllTimers()

  expect(cancelledComplete).not.toHaveBeenCalled()
  expect(replacementComplete).toHaveBeenCalledTimes(1)
  jest.useRealTimers()
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
