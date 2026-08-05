import { GlideSentinel } from '../../../main/windows/glideSentinel'

const displays = [
  { workArea: { x: 0, y: 48, width: 3840, height: 2112 } },
  { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }
]

const createSetup = ({ supported = true, createFailure } = {}) => {
  const screen = { getAllDisplays: jest.fn(() => displays) }
  const windows = []
  const createWindow = jest.fn((options) => {
    if (createFailure && windows.length === createFailure.after) throw createFailure.error

    const window = {
      options,
      destroy: jest.fn(),
      isDestroyed: jest.fn(() => false),
      setVisibleOnAllWorkspaces: jest.fn(),
      showInactive: jest.fn()
    }
    windows.push(window)
    return window
  })
  const reportError = jest.fn()
  const sentinel = new GlideSentinel(screen, createWindow, supported, reportError)

  return { createWindow, reportError, screen, sentinel, windows }
}

describe('GlideSentinel', () => {
  it('maps a renderer-free two-pixel edge on every display', () => {
    const { createWindow, sentinel, windows } = createSetup()

    sentinel.start()

    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(windows[0].options).toMatchObject({
      x: 3838,
      y: 53,
      width: 2,
      height: 2102,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true
    })
    expect(windows[1].options).toMatchObject({
      x: -2,
      y: 5,
      width: 2,
      height: 1070
    })
    windows.forEach((window) => {
      expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
        visibleOnFullScreen: true
      })
      expect(window.showInactive).toHaveBeenCalledTimes(1)
    })
  })

  it('starts once and destroys every mapped edge when stopped', () => {
    const { createWindow, sentinel, windows } = createSetup()

    sentinel.start()
    sentinel.start()
    sentinel.stop()
    sentinel.stop()

    expect(createWindow).toHaveBeenCalledTimes(2)
    windows.forEach((window) => expect(window.destroy).toHaveBeenCalledTimes(1))
  })

  it('rebuilds mapped edges only while active', () => {
    const { createWindow, sentinel, windows } = createSetup()

    sentinel.refresh()
    expect(createWindow).not.toHaveBeenCalled()

    sentinel.start()
    sentinel.refresh()

    expect(createWindow).toHaveBeenCalledTimes(4)
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    expect(windows[1].destroy).toHaveBeenCalledTimes(1)
  })

  it('moves every mapped sentinel to the left edge', () => {
    const { createWindow, sentinel, windows } = createSetup()

    sentinel.start()
    sentinel.setEdge('left')

    expect(createWindow).toHaveBeenCalledTimes(4)
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    expect(windows[1].destroy).toHaveBeenCalledTimes(1)
    expect(windows[2].options.x).toBe(0)
    expect(windows[3].options.x).toBe(-1920)
  })

  it('does nothing outside supported X11 sessions', () => {
    const { createWindow, screen, sentinel } = createSetup({ supported: false })

    sentinel.start()

    expect(screen.getAllDisplays).not.toHaveBeenCalled()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('cleans up partial state when an edge cannot be created', () => {
    const error = new Error('window creation failed')
    const { reportError, sentinel, windows } = createSetup({
      createFailure: { after: 1, error }
    })

    sentinel.start()

    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(error)
  })

  it('recovers on refresh after a transient creation failure', () => {
    const error = new Error('window creation failed')
    let fail = true
    const { createWindow, reportError, sentinel, windows } = createSetup()
    createWindow.mockImplementation((options) => {
      if (fail) {
        fail = false
        throw error
      }

      const window = {
        options,
        destroy: jest.fn(),
        isDestroyed: jest.fn(() => false),
        setVisibleOnAllWorkspaces: jest.fn(),
        showInactive: jest.fn()
      }
      windows.push(window)
      return window
    })

    sentinel.start()
    sentinel.refresh()

    expect(reportError).toHaveBeenCalledWith(error)
    expect(windows).toHaveLength(2)
    windows.forEach((window) => expect(window.showInactive).toHaveBeenCalledTimes(1))
  })
})
