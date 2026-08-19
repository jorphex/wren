import { EventEmitter } from 'events'
import { EmbeddedWorkspace } from '../../../main/windows/embeddedWorkspace'

const createSetup = (recoveryOptions: { beforeReload?: () => void; unresponsiveDelay?: number } = {}) => {
  const webContents = Object.assign(new EventEmitter(), {
    close: jest.fn(),
    focus: jest.fn(),
    getOSProcessId: jest.fn(() => 42),
    isDestroyed: jest.fn(() => false),
    loadURL: jest.fn(),
    openDevTools: jest.fn(),
    reload: jest.fn(),
    send: jest.fn(),
    setZoomFactor: jest.fn()
  })
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
    setBounds: jest.fn(),
    setShape: jest.fn()
  }
  const app = new EventEmitter()
  const workspace = new EmbeddedWorkspace(parent as never, view as never, app as never, recoveryOptions)
  webContents.emit('did-finish-load')
  return { app, parent, view, webContents, workspace }
}

const visibleBounds = { x: 0, y: 0, width: 620, height: 900 }

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

  workspace.applyShellLayout(windowBounds, { x: 620, y: 0, width: 760, height: 900 }, viewBounds, true)

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
  workspace.applyShellLayout(windowBounds, { x: 620, y: 0, width: 760, height: 900 }, viewBounds, true, true)

  expect(view.setVisible.mock.calls).toEqual([[false]])
  expect(parent.setBounds).toHaveBeenCalledTimes(1)
  expect(parent.setBounds).toHaveBeenLastCalledWith(windowBounds, false)
  expect(view.setBounds).toHaveBeenLastCalledWith(viewBounds)
  if (process.platform === 'linux') {
    expect(parent.setShape).toHaveBeenCalledWith([{ x: 0, y: 0, width: 1380, height: 900 }])
  }
  expect(workspace.isVisible()).toBe(false)
  expect(workspace.isSettled(true)).toBe(false)
  expect(workspace.isTransitioningTo(true)).toBe(true)

  jest.runAllTimers()

  expect(parent.setBounds).toHaveBeenCalledTimes(1)
  expect(view.setVisible.mock.calls).toEqual([[false], [true]])
  expect(workspace.isVisible()).toBe(true)
  expect(workspace.isSettled(true)).toBe(true)
  expect(workspace.isTransitioningTo(true)).toBe(false)
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
  workspace.applyShellLayout(windowBounds, { x: 0, y: 0, width: 760, height: 900 }, viewBounds, true, true)

  expect(view.setBounds).toHaveBeenCalledWith(viewBounds)
  expect(parent.setBounds).toHaveBeenCalledWith(windowBounds, false)
  jest.runAllTimers()
  expect(view.setVisible).toHaveBeenLastCalledWith(true)
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
  view.setVisible.mockClear()
  workspace.applyShellLayout(windowBounds, { x: 0, y: 0, width: 760, height: 744 }, viewBounds, true, true)

  expect(view.setVisible).toHaveBeenCalledWith(false)
  expect(view.setBounds).toHaveBeenCalledWith(viewBounds)
  jest.runAllTimers()

  expect(view.setVisible).toHaveBeenLastCalledWith(true)
  jest.useRealTimers()
})

it('keeps workspace content visible during concealment and hides it on collapse completion', () => {
  jest.useFakeTimers()
  const { parent, view, workspace } = createSetup()
  const onComplete = jest.fn()
  const expandedView = { x: 0, y: 0, width: 620, height: 900 }
  const windowBounds = { x: 540, y: 114, width: 1380, height: 900 }
  const mainBounds = { x: 620, y: 0, width: 760, height: 900 }
  const viewBounds = { x: 0, y: 0, width: 620, height: 900 }

  parent.getBounds.mockReturnValue({ x: 540, y: 114, width: 1380, height: 900 })
  workspace.applyLayout(expandedView, true)
  parent.setBounds.mockClear()
  view.setBounds.mockClear()
  view.setVisible.mockClear()
  workspace.applyShellLayout(windowBounds, mainBounds, viewBounds, false, true, onComplete)

  expect(view.setVisible).not.toHaveBeenCalled()
  expect(workspace.isVisible()).toBe(true)
  expect(workspace.isSettled(false)).toBe(false)
  expect(workspace.isTransitioningTo(false)).toBe(true)
  expect(onComplete).not.toHaveBeenCalled()
  expect(parent.setBounds).not.toHaveBeenCalled()
  expect(view.setBounds).not.toHaveBeenCalled()

  jest.runAllTimers()

  expect(view.setVisible).toHaveBeenCalledTimes(1)
  expect(view.setVisible).toHaveBeenCalledWith(false)
  expect(parent.setBounds).not.toHaveBeenCalled()
  if (process.platform === 'linux') expect(parent.setShape).toHaveBeenCalledWith([mainBounds])
  expect(view.setBounds).toHaveBeenCalledWith(viewBounds)
  expect(workspace.isVisible()).toBe(false)
  expect(workspace.isSettled(false)).toBe(true)
  expect(workspace.isTransitioningTo(false)).toBe(false)
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
    { x: 620, y: 0, width: 760, height: 900 },
    { x: 0, y: 0, width: 620, height: 900 },
    true,
    true,
    cancelledComplete
  )
  workspace.applyShellLayout(
    { x: 540, y: 114, width: 1380, height: 900 },
    { x: 620, y: 0, width: 760, height: 900 },
    { x: 0, y: 0, width: 620, height: 900 },
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

it('focuses only a visible settled workspace', () => {
  const { webContents, workspace } = createSetup()

  workspace.focus()
  workspace.show()
  webContents.focus.mockClear()
  workspace.focus()
  workspace.hide()
  workspace.focus()

  expect(webContents.focus).toHaveBeenCalledTimes(1)
})

it('forwards state updates and reloads while active', () => {
  const { webContents, workspace } = createSetup()

  workspace.send('main:action', 'stateSync', '{}')
  workspace.reload()

  expect(webContents.send).toHaveBeenCalledWith('main:action', 'stateSync', '{}')
  expect(webContents.reload).toHaveBeenCalledTimes(1)
})

it('defers an explicit reload until a visible workspace closes', () => {
  const { webContents, workspace } = createSetup()

  workspace.applyLayout(visibleBounds, true)
  workspace.reload()

  expect(webContents.reload).not.toHaveBeenCalled()

  workspace.applyLayout(visibleBounds, false)

  expect(webContents.reload).toHaveBeenCalledTimes(1)
})

it('applies interface zoom to embedded renderer web contents', () => {
  const { webContents, workspace } = createSetup()

  workspace.setZoomFactor(1.25)

  expect(webContents.setZoomFactor).toHaveBeenCalledWith(1.25)
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

it('waits for an explicit close before recovering a visible failed renderer', () => {
  const { view, webContents, workspace } = createSetup()

  workspace.applyLayout(visibleBounds, true)
  webContents.emit('render-process-gone')

  expect(webContents.reload).not.toHaveBeenCalled()
  expect(view.setVisible).toHaveBeenLastCalledWith(true)

  workspace.applyLayout(visibleBounds, false)

  expect(view.setVisible).toHaveBeenLastCalledWith(false)
  expect(webContents.reload).toHaveBeenCalledTimes(1)
})

it('waits for animated close completion before recovering a failed renderer', () => {
  jest.useFakeTimers()
  const { webContents, workspace } = createSetup()
  const onComplete = jest.fn()

  workspace.applyLayout(visibleBounds, true)
  webContents.emit('render-process-gone')
  workspace.applyShellLayout(
    { x: 1160, y: 114, width: 760, height: 900 },
    { x: 0, y: 0, width: 760, height: 900 },
    visibleBounds,
    false,
    true,
    onComplete
  )

  expect(webContents.reload).not.toHaveBeenCalled()
  jest.runAllTimers()

  expect(onComplete).toHaveBeenCalledTimes(1)
  expect(webContents.reload).toHaveBeenCalledTimes(1)
  expect(onComplete.mock.invocationCallOrder[0]).toBeLessThan(webContents.reload.mock.invocationCallOrder[0])
  jest.useRealTimers()
})

it('immediately recovers a failed renderer that is already hidden', () => {
  const { webContents } = createSetup()

  webContents.emit('render-process-gone')

  expect(webContents.reload).toHaveBeenCalledTimes(1)
})

it('keeps a queued reopen hidden until recovery finishes loading', () => {
  const { view, webContents, workspace } = createSetup()

  webContents.emit('render-process-gone')
  workspace.applyLayout(visibleBounds, true)

  expect(view.setVisible).toHaveBeenLastCalledWith(false)
  expect(workspace.isVisible()).toBe(false)
})

it('permits a queued reopen through the loaded reposition flow', () => {
  const { view, webContents, workspace } = createSetup()
  const reposition = jest.fn(() => workspace.applyLayout(visibleBounds, true))
  workspace.onLoaded(reposition)

  webContents.emit('render-process-gone')
  workspace.applyLayout(visibleBounds, true)
  webContents.emit('did-finish-load')

  expect(reposition).toHaveBeenCalledTimes(1)
  expect(view.setVisible).toHaveBeenLastCalledWith(true)
  expect(workspace.isVisible()).toBe(true)
})

it('cancels unresponsive recovery when the renderer responds again', () => {
  jest.useFakeTimers()
  const { webContents } = createSetup()

  webContents.emit('unresponsive')
  webContents.emit('responsive')
  jest.runAllTimers()

  expect(webContents.reload).not.toHaveBeenCalled()
  jest.useRealTimers()
})

it('cancels a sustained visible unresponsive failure if the renderer recovers before close', () => {
  jest.useFakeTimers()
  const { webContents, workspace } = createSetup({ unresponsiveDelay: 50 })

  workspace.applyLayout(visibleBounds, true)
  webContents.emit('unresponsive')
  jest.advanceTimersByTime(50)
  webContents.emit('responsive')
  workspace.applyLayout(visibleBounds, false)

  expect(webContents.reload).not.toHaveBeenCalled()
  jest.useRealTimers()
})

it('recovers a sustained unresponsive renderer immediately when hidden', () => {
  jest.useFakeTimers()
  const beforeReload = jest.fn()
  const { webContents } = createSetup({ beforeReload, unresponsiveDelay: 50 })

  webContents.emit('unresponsive')
  jest.advanceTimersByTime(50)

  expect(beforeReload).toHaveBeenCalledTimes(1)
  expect(webContents.reload).toHaveBeenCalledTimes(1)
  expect(beforeReload.mock.invocationCallOrder[0]).toBeLessThan(
    webContents.reload.mock.invocationCallOrder[0]
  )
  jest.useRealTimers()
})

it('bounds automatic recovery when failure events repeat', () => {
  const { webContents, workspace } = createSetup()

  workspace.applyLayout(visibleBounds, true)
  webContents.emit('render-process-gone')
  webContents.emit('render-process-gone')
  webContents.emit('unresponsive')
  workspace.applyLayout(visibleBounds, false)
  webContents.emit('render-process-gone')

  expect(webContents.reload).toHaveBeenCalledTimes(2)
})

it('retries a failed recovery load and permits a later explicit close to try again', () => {
  const { webContents, workspace } = createSetup()

  webContents.emit('render-process-gone')
  webContents.emit('did-fail-load', {}, -105, 'Name not resolved', 'file:///dash.html', true)
  webContents.emit('did-fail-load', {}, -105, 'Name not resolved', 'file:///dash.html', true)

  expect(webContents.reload).toHaveBeenCalledTimes(2)

  workspace.applyLayout(visibleBounds, false)

  expect(webContents.reload).toHaveBeenCalledTimes(3)
})

it('does not let a recovery-triggered hide reset the automatic retry bound', () => {
  let workspace: EmbeddedWorkspace
  const setup = createSetup({ beforeReload: () => workspace.hide() })
  workspace = setup.workspace

  setup.webContents.emit('render-process-gone')
  setup.webContents.emit('did-fail-load', {}, -105, 'Name not resolved', 'file:///dash.html', true)
  setup.webContents.emit('did-fail-load', {}, -105, 'Name not resolved', 'file:///dash.html', true)
  setup.webContents.emit('did-fail-load', {}, -105, 'Name not resolved', 'file:///dash.html', true)

  expect(setup.webContents.reload).toHaveBeenCalledTimes(2)
})

it('removes recovery listeners and ignores lifecycle events after destruction', () => {
  jest.useFakeTimers()
  const { webContents, workspace } = createSetup()

  workspace.destroy()
  webContents.emit('render-process-gone')
  webContents.emit('unresponsive')
  jest.runAllTimers()

  expect(webContents.reload).not.toHaveBeenCalled()
  expect(webContents.listenerCount('did-finish-load')).toBe(0)
  expect(webContents.listenerCount('did-fail-load')).toBe(0)
  expect(webContents.listenerCount('render-process-gone')).toBe(0)
  expect(webContents.listenerCount('unresponsive')).toBe(0)
  expect(webContents.listenerCount('responsive')).toBe(0)
  jest.useRealTimers()
})
