export function shouldSuppressRepeatedShow(recentDisplayEvent: boolean, currentlyVisible: boolean) {
  return recentDisplayEvent && currentlyVisible
}
