interface PowerLockMonitor {
  on(event: 'lock-screen' | 'suspend', listener: () => void): unknown
  removeListener(event: 'lock-screen' | 'suspend', listener: () => void): unknown
}

export function installSignerPowerLockHandlers(monitor: PowerLockMonitor, lock: (reason: string) => void) {
  const onSuspend = () => lock('system suspend')
  const onLockScreen = () => lock('screen lock')

  monitor.on('suspend', onSuspend)
  monitor.on('lock-screen', onLockScreen)

  return () => {
    monitor.removeListener('suspend', onSuspend)
    monitor.removeListener('lock-screen', onLockScreen)
  }
}
