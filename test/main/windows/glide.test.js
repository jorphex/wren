import { GlideDetector, isAtEdge, isAtRightEdge } from '../../../main/windows/glide'

const display = {
  workArea: { x: 0, y: 48, width: 3840, height: 2112 }
}

const createScreen = (point) => ({
  getCursorScreenPoint: jest.fn(() => point),
  getDisplayNearestPoint: jest.fn(() => display)
})

const createScreenSequence = (points) => {
  let index = 0

  return {
    getCursorScreenPoint: jest.fn(() => points[Math.min(index++, points.length - 1)]),
    getDisplayNearestPoint: jest.fn(() => display)
  }
}

describe('isAtRightEdge', () => {
  it('accepts the final two pixels of the usable right edge', () => {
    expect(isAtRightEdge({ x: 3838, y: 1080 }, display)).toBe(true)
    expect(isAtRightEdge({ x: 3839, y: 1080 }, display)).toBe(true)
  })

  it('supports the left edge without accepting points outside the display', () => {
    expect(isAtEdge({ x: 0, y: 1080 }, display, 'left')).toBe(true)
    expect(isAtEdge({ x: 1, y: 1080 }, display, 'left')).toBe(true)
    expect(isAtEdge({ x: -1, y: 1080 }, display, 'left')).toBe(false)
    expect(isAtEdge({ x: 2, y: 1080 }, display, 'left')).toBe(false)
  })

  it('rejects nearby and vertically reserved screen coordinates', () => {
    expect(isAtRightEdge({ x: 3837, y: 1080 }, display)).toBe(false)
    expect(isAtRightEdge({ x: 3839, y: 48 }, display)).toBe(false)
    expect(isAtRightEdge({ x: 3839, y: 2160 }, display)).toBe(false)
  })
})

describe('GlideDetector', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('retries when the window lifecycle temporarily rejects a reveal', () => {
    const screen = createScreen({ x: 3839, y: 1080 })
    const reveal = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const detector = new GlideDetector(screen, () => true, reveal)

    detector.start()
    jest.advanceTimersByTime(100)

    expect(reveal).toHaveBeenCalledTimes(2)

    jest.advanceTimersByTime(500)
    expect(reveal).toHaveBeenCalledTimes(2)
  })

  it('reveals while the pointer moves vertically along the edge', () => {
    const screen = createScreenSequence([
      { x: 3839, y: 800 },
      { x: 3839, y: 812 }
    ])
    const reveal = jest.fn(() => true)
    const lifecycle = { start: jest.fn(), stop: jest.fn() }
    const detector = new GlideDetector(screen, () => true, reveal, lifecycle)

    detector.start()
    jest.advanceTimersByTime(50)

    expect(reveal).toHaveBeenCalledTimes(1)
    expect(lifecycle.start).toHaveBeenCalledTimes(1)
    expect(lifecycle.stop).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('requires the pointer to leave the edge before revealing again', () => {
    const screen = createScreenSequence([
      { x: 3839, y: 800 },
      { x: 3839, y: 800 },
      { x: 3839, y: 800 },
      { x: 3839, y: 800 },
      { x: 3800, y: 800 },
      { x: 3800, y: 800 },
      { x: 3839, y: 800 },
      { x: 3839, y: 800 }
    ])
    const reveal = jest.fn(() => true)
    const detector = new GlideDetector(screen, () => true, reveal)

    detector.start()
    jest.advanceTimersByTime(50)
    expect(reveal).toHaveBeenCalledTimes(1)

    detector.start()
    jest.advanceTimersByTime(100)
    expect(reveal).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(50)
    expect(reveal).toHaveBeenCalledTimes(2)
  })

  it('requires consecutive edge samples', () => {
    const screen = createScreenSequence([
      { x: 3839, y: 800 },
      { x: 3837, y: 800 },
      { x: 3839, y: 800 },
      { x: 3839, y: 800 }
    ])
    const reveal = jest.fn(() => true)
    const detector = new GlideDetector(screen, () => true, reveal)

    detector.start()
    jest.advanceTimersByTime(50)
    expect(reveal).not.toHaveBeenCalled()

    jest.advanceTimersByTime(50)
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('does not create duplicate polling loops', () => {
    const screen = createScreen({ x: 100, y: 100 })
    const reveal = jest.fn(() => false)
    const lifecycle = { start: jest.fn(), stop: jest.fn() }
    const detector = new GlideDetector(screen, () => true, reveal, lifecycle)

    detector.start()
    detector.start()

    expect(lifecycle.start).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(50)
    expect(jest.getTimerCount()).toBe(1)
    detector.stop()
    detector.stop()
    expect(lifecycle.stop).toHaveBeenCalledTimes(1)
  })

  it('stops polling when Glide is disabled', () => {
    let enabled = true
    const screen = createScreen({ x: 100, y: 100 })
    const detector = new GlideDetector(
      screen,
      () => enabled,
      jest.fn(() => false)
    )

    detector.start()
    enabled = false
    jest.advanceTimersByTime(500)

    expect(screen.getCursorScreenPoint).toHaveBeenCalledTimes(1)
  })

  it('reveals from the configured left edge', () => {
    const screen = createScreen({ x: 0, y: 800 })
    const reveal = jest.fn(() => true)
    const detector = new GlideDetector(
      screen,
      () => true,
      reveal,
      undefined,
      () => 'left'
    )

    detector.start()
    jest.advanceTimersByTime(50)

    expect(reveal).toHaveBeenCalledTimes(1)
  })
})
