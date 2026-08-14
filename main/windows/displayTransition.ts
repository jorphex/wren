export function shouldSuppressRepeatedShow(recentDisplayEvent: boolean, currentlyVisible: boolean) {
  return recentDisplayEvent && currentlyVisible
}

export function shouldAnimateShell(currentlyVisible: boolean, prefersReducedMotion: boolean) {
  return currentlyVisible && !prefersReducedMotion
}

export function shouldAnimateWorkspaceOpen(
  workspaceLoaded: boolean,
  trayVisible: boolean,
  workspaceSettled: boolean,
  prefersReducedMotion: boolean
) {
  return workspaceLoaded && shouldAnimateShell(trayVisible && !workspaceSettled, prefersReducedMotion)
}

export function shouldAnimateWorkspaceClose(
  trayVisible: boolean,
  workspaceSettled: boolean,
  prefersReducedMotion: boolean
) {
  return shouldAnimateShell(trayVisible && !workspaceSettled, prefersReducedMotion)
}
