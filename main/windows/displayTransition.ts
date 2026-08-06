export function shouldSuppressRepeatedShow(recentDisplayEvent: boolean, currentlyVisible: boolean) {
  return recentDisplayEvent && currentlyVisible
}

export function shouldAnimateShell(currentlyVisible: boolean, prefersReducedMotion: boolean) {
  return currentlyVisible && !prefersReducedMotion
}
