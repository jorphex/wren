import type { App, BrowserWindow, Event } from 'electron'

const closeToTrayListeners = new Set<() => void>()

export function onCloseToTray(listener: () => void) {
  closeToTrayListeners.add(listener)
  return () => closeToTrayListeners.delete(listener)
}

export function installCloseToTray(app: App, window: BrowserWindow, hide: () => void) {
  let quitting = false

  const allowClose = () => {
    quitting = true
  }
  const handleClose = (event: Event) => {
    if (quitting) return

    event.preventDefault()
    closeToTrayListeners.forEach((listener) => listener())
    hide()
  }
  const cleanup = () => {
    app.off('before-quit', allowClose)
    window.off('close', handleClose)
  }

  app.once('before-quit', allowClose)
  window.on('close', handleClose)
  window.once('closed', cleanup)
}
