import { getShellLayout, shouldJoinWorkspace } from '../../../main/windows/shellGeometry'

describe('getShellLayout', () => {
  it('anchors a compact wallet to the right edge', () => {
    expect(getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right')).toEqual({
      window: { x: 1300, y: 114, width: 620, height: 900 },
      main: { x: 0, y: 0, width: 620, height: 900 },
      workspace: { x: 0, y: 0, width: 0, height: 900 },
      workspaceOverlaysMain: false
    })
  })

  it('scales physical panes while preserving the right wallet edge', () => {
    const compact = getShellLayout({ x: 0, y: 0, width: 1920, height: 1080 }, 'right', false, 1.25)
    const expanded = getShellLayout({ x: 0, y: 0, width: 1920, height: 1080 }, 'right', true, 1.25)

    expect(compact).toEqual({
      window: { x: 1145, y: 12, width: 775, height: 1056 },
      main: { x: 0, y: 0, width: 775, height: 1056 },
      workspace: { x: 0, y: 0, width: 0, height: 1056 },
      workspaceOverlaysMain: false
    })
    expect(expanded).toEqual({
      window: { x: 370, y: 12, width: 1550, height: 1056 },
      main: { x: 775, y: 0, width: 775, height: 1056 },
      workspace: { x: 0, y: 0, width: 775, height: 1056 },
      workspaceOverlaysMain: false
    })
    expect(expanded.window.x + expanded.main.x).toBe(compact.window.x)
  })

  it('scales overlay thresholds and caps target height to the work area margin', () => {
    expect(getShellLayout({ x: 0, y: 0, width: 1440, height: 1200 }, 'right', true, 1.5)).toEqual({
      window: { x: 510, y: 12, width: 930, height: 1176 },
      main: { x: 0, y: 0, width: 930, height: 1176 },
      workspace: { x: 0, y: 0, width: 930, height: 1176 },
      workspaceOverlaysMain: true
    })
  })

  it('collapses a left-edge workspace at the wallet seam', () => {
    expect(getShellLayout({ x: 0, y: 0, width: 1920, height: 1080 }, 'left')).toEqual({
      window: { x: 0, y: 90, width: 620, height: 900 },
      main: { x: 0, y: 0, width: 620, height: 900 },
      workspace: { x: 620, y: 0, width: 0, height: 900 },
      workspaceOverlaysMain: false
    })
  })

  it('expands left while keeping the right-edge wallet in place', () => {
    const compact = getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right')
    const expanded = getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right', true)

    expect(expanded).toEqual({
      window: { x: 680, y: 114, width: 1240, height: 900 },
      main: { x: 620, y: 0, width: 620, height: 900 },
      workspace: { x: 0, y: 0, width: 620, height: 900 },
      workspaceOverlaysMain: false
    })
    expect(expanded.window.x + expanded.main.x).toBe(compact.window.x)
  })

  it('mirrors expansion at the left edge without moving the wallet', () => {
    const compact = getShellLayout({ x: -1920, y: 0, width: 1920, height: 1080 }, 'left')
    const expanded = getShellLayout({ x: -1920, y: 0, width: 1920, height: 1080 }, 'left', true)

    expect(expanded).toEqual({
      window: { x: -1920, y: 90, width: 1240, height: 900 },
      main: { x: 0, y: 0, width: 620, height: 900 },
      workspace: { x: 620, y: 0, width: 620, height: 900 },
      workspaceOverlaysMain: false
    })
    expect(expanded.window.x + expanded.main.x).toBe(compact.window.x)
  })

  it('uses all available adjacent width before falling back to an overlay', () => {
    expect(getShellLayout({ x: 0, y: 0, width: 1200, height: 900 }, 'right', true)).toEqual({
      window: { x: 0, y: 12, width: 1200, height: 876 },
      main: { x: 580, y: 0, width: 620, height: 876 },
      workspace: { x: 0, y: 0, width: 580, height: 876 },
      workspaceOverlaysMain: false
    })
  })

  it('fits an adjacent workspace inside a common 1366x768 work area', () => {
    expect(getShellLayout({ x: 0, y: 0, width: 1366, height: 768 }, 'right', true)).toEqual({
      window: { x: 126, y: 12, width: 1240, height: 744 },
      main: { x: 620, y: 0, width: 620, height: 744 },
      workspace: { x: 0, y: 0, width: 620, height: 744 },
      workspaceOverlaysMain: false
    })
  })

  it('uses the available adjacent workspace on a common 1024x768 work area', () => {
    expect(getShellLayout({ x: 0, y: 0, width: 1024, height: 768 }, 'right', true)).toEqual({
      window: { x: 0, y: 12, width: 1024, height: 744 },
      main: { x: 404, y: 0, width: 620, height: 744 },
      workspace: { x: 0, y: 0, width: 404, height: 744 },
      workspaceOverlaysMain: false
    })
  })

  it('overlays the wallet on narrow displays instead of going off-screen', () => {
    expect(getShellLayout({ x: 10, y: 20, width: 1000, height: 600 }, 'right', true)).toEqual({
      window: { x: 390, y: 32, width: 620, height: 576 },
      main: { x: 0, y: 0, width: 620, height: 576 },
      workspace: { x: 0, y: 0, width: 620, height: 576 },
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

  it('joins only an adjacent workspace to the wallet shell', () => {
    const adjacent = getShellLayout({ x: 0, y: 0, width: 1920, height: 1080 }, 'left', true)
    const overlay = getShellLayout({ x: 0, y: 0, width: 1000, height: 768 }, 'left', true)
    const collapsedOverlay = getShellLayout({ x: 0, y: 0, width: 1000, height: 768 }, 'left')

    expect(shouldJoinWorkspace(adjacent, true)).toBe(true)
    expect(shouldJoinWorkspace(adjacent, false)).toBe(false)
    expect(shouldJoinWorkspace(overlay, true)).toBe(false)
    expect(collapsedOverlay.workspaceOverlaysMain).toBe(true)
    expect(collapsedOverlay.workspace).toEqual({ x: 620, y: 0, width: 0, height: 744 })
    expect(overlay.workspace).toEqual({ x: 0, y: 0, width: 620, height: 744 })
    expect(shouldJoinWorkspace(collapsedOverlay, false)).toBe(false)
  })
})
