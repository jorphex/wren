let activeGuard

export const setDashNavigationGuard = (guard) => {
  activeGuard = guard

  return () => {
    if (activeGuard === guard) activeGuard = undefined
  }
}

export const requestDashNavigation = (type, navigate) => {
  if (activeGuard?.({ type, navigate })) return false
  navigate()
  return true
}
