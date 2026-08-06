import { getShellLayout } from '../../../main/windows/shellGeometry'

describe('getShellLayout', () => {
  it('anchors a compact wallet to the right edge', () => {
    expect(getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right')).toEqual({
      window: { x: 1160, y: 204, width: 760, height: 720 },
      main: { x: 0, y: 0, width: 760, height: 720 },
      workspace: { x: 0, y: 0, width: 0, height: 720 },
      workspaceOverlaysMain: false
    })
  })

  it('expands left while keeping the right-edge wallet in place', () => {
    const compact = getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right')
    const expanded = getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right', true)

    expect(expanded).toEqual({
      window: { x: 640, y: 204, width: 1280, height: 720 },
      main: { x: 520, y: 0, width: 760, height: 720 },
      workspace: { x: 0, y: 0, width: 520, height: 720 },
      workspaceOverlaysMain: false
    })
    expect(expanded.window.x + expanded.main.x).toBe(compact.window.x)
  })

  it('mirrors expansion at the left edge without moving the wallet', () => {
    const compact = getShellLayout({ x: -1920, y: 0, width: 1920, height: 1080 }, 'left')
    const expanded = getShellLayout({ x: -1920, y: 0, width: 1920, height: 1080 }, 'left', true)

    expect(expanded).toEqual({
      window: { x: -1920, y: 180, width: 1280, height: 720 },
      main: { x: 0, y: 0, width: 760, height: 720 },
      workspace: { x: 760, y: 0, width: 520, height: 720 },
      workspaceOverlaysMain: false
    })
    expect(expanded.window.x + expanded.main.x).toBe(compact.window.x)
  })

  it('uses all available adjacent width before falling back to an overlay', () => {
    expect(getShellLayout({ x: 0, y: 0, width: 1200, height: 900 }, 'right', true)).toEqual({
      window: { x: 0, y: 90, width: 1200, height: 720 },
      main: { x: 440, y: 0, width: 760, height: 720 },
      workspace: { x: 0, y: 0, width: 440, height: 720 },
      workspaceOverlaysMain: false
    })
  })

  it('overlays the wallet on narrow displays instead of going off-screen', () => {
    expect(getShellLayout({ x: 10, y: 20, width: 1000, height: 600 }, 'right', true)).toEqual({
      window: { x: 250, y: 32, width: 760, height: 576 },
      main: { x: 0, y: 0, width: 760, height: 576 },
      workspace: { x: 0, y: 0, width: 760, height: 576 },
      workspaceOverlaysMain: true
    })
  })

  it('never returns dimensions outside an undersized work area', () => {
    expect(getShellLayout({ x: 5, y: 7, width: 320, height: 20 }, 'left', true)).toEqual({
      window: { x: 5, y: 16, width: 320, height: 1 },
      main: { x: 0, y: 0, width: 320, height: 1 },
      workspace: { x: 0, y: 0, width: 320, height: 1 },
      workspaceOverlaysMain: true
    })
  })
})
