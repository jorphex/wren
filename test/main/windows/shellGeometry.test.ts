import { getShellLayout } from '../../../main/windows/shellGeometry'

describe('getShellLayout', () => {
  it('anchors a coupled landscape shell to the right edge', () => {
    expect(getShellLayout({ x: 0, y: 48, width: 1920, height: 1032 }, 'right')).toEqual({
      main: { x: 1200, y: 224, width: 720, height: 680 },
      dashboard: { x: 694, y: 224, width: 500, height: 680 },
      dashboardOverlaysMain: false
    })
  })

  it('mirrors both panes at the left edge', () => {
    expect(getShellLayout({ x: -1920, y: 0, width: 1920, height: 1080 }, 'left')).toEqual({
      main: { x: -1920, y: 200, width: 720, height: 680 },
      dashboard: { x: -1194, y: 200, width: 500, height: 680 },
      dashboardOverlaysMain: false
    })
  })

  it('overlays the dashboard instead of placing it off-screen on narrow displays', () => {
    expect(getShellLayout({ x: 10, y: 20, width: 800, height: 600 }, 'right')).toEqual({
      main: { x: 90, y: 32, width: 720, height: 576 },
      dashboard: { x: 90, y: 32, width: 720, height: 576 },
      dashboardOverlaysMain: true
    })
  })

  it('never returns dimensions outside an undersized work area', () => {
    expect(getShellLayout({ x: 5, y: 7, width: 320, height: 20 }, 'left')).toEqual({
      main: { x: 5, y: 16, width: 320, height: 1 },
      dashboard: { x: 5, y: 16, width: 320, height: 1 },
      dashboardOverlaysMain: true
    })
  })
})
