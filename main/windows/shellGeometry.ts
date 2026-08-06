export type GlideEdge = 'left' | 'right'

export type Rectangle = {
  x: number
  y: number
  width: number
  height: number
}

export type ShellLayout = {
  window: Rectangle
  main: Rectangle
  workspace: Rectangle
  workspaceOverlaysMain: boolean
}

export const shellMainTargetWidth = 760
export const shellWorkspaceTargetWidth = 620
export const shellTargetHeight = 900
const workspaceMinimumWidth = 400
const verticalMargin = 12

export function getShellLayout(workArea: Rectangle, edge: GlideEdge, workspaceOpen = false): ShellLayout {
  const mainWidth = Math.min(shellMainTargetWidth, workArea.width)
  const height = Math.max(1, Math.min(shellTargetHeight, workArea.height - verticalMargin * 2))
  const adjacentWidth = Math.max(0, workArea.width - mainWidth)
  const workspaceOverlaysMain = adjacentWidth < workspaceMinimumWidth
  const workspaceWidth = workspaceOpen
    ? workspaceOverlaysMain
      ? mainWidth
      : Math.min(shellWorkspaceTargetWidth, adjacentWidth)
    : 0
  const windowWidth = workspaceOverlaysMain ? mainWidth : mainWidth + workspaceWidth
  const window = {
    x: edge === 'right' ? workArea.x + workArea.width - windowWidth : workArea.x,
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width: windowWidth,
    height
  }
  const main = {
    x: workspaceOpen && !workspaceOverlaysMain && edge === 'right' ? workspaceWidth : 0,
    y: 0,
    width: mainWidth,
    height
  }
  const workspace = {
    x: edge === 'left' && !(workspaceOpen && workspaceOverlaysMain) ? mainWidth : 0,
    y: 0,
    width: workspaceWidth,
    height
  }

  return { window, main, workspace, workspaceOverlaysMain }
}

export function shouldJoinWorkspace(layout: ShellLayout, showing: boolean, transitioning: boolean) {
  return !layout.workspaceOverlaysMain && (showing || transitioning)
}
