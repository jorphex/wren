export type GlideEdge = 'left' | 'right'

export type Rectangle = {
  x: number
  y: number
  width: number
  height: number
}

export type ShellLayout = {
  main: Rectangle
  dashboard: Rectangle
  dashboardOverlaysMain: boolean
}

export const shellMainTargetWidth = 720
export const shellDashboardTargetWidth = 500
const dashboardMinimumWidth = 400
const shellTargetHeight = 680
const paneGap = 6
const verticalMargin = 12

export function getShellLayout(workArea: Rectangle, edge: GlideEdge): ShellLayout {
  const mainWidth = Math.min(shellMainTargetWidth, workArea.width)
  const height = Math.max(1, Math.min(shellTargetHeight, workArea.height - verticalMargin * 2))
  const main = {
    x: edge === 'right' ? workArea.x + workArea.width - mainWidth : workArea.x,
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width: mainWidth,
    height
  }
  const adjacentWidth = workArea.width - mainWidth - paneGap
  const dashboardOverlaysMain = adjacentWidth < dashboardMinimumWidth
  const dashboardWidth = dashboardOverlaysMain
    ? mainWidth
    : Math.min(shellDashboardTargetWidth, adjacentWidth)
  const dashboard = dashboardOverlaysMain
    ? { ...main }
    : {
        x: edge === 'right' ? main.x - paneGap - dashboardWidth : main.x + main.width + paneGap,
        y: main.y,
        width: dashboardWidth,
        height
      }

  return { main, dashboard, dashboardOverlaysMain }
}
