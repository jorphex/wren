import { BrowserWindow, app, dialog } from 'electron'

enum ExitAction {
  OK,
  Quit
}

export const showUnhandledExceptionDialog = (message: string, code?: string) => {
  let exitAction = ExitAction.Quit

  if (code === 'EADDRINUSE') {
    dialog.showErrorBox(
      'Wren is already running',
      'Wren is already running or another application is using port 1248.'
    )
  } else {
    exitAction = dialog.showMessageBoxSync(undefined as unknown as BrowserWindow, {
      title: 'Unhandled Exception',
      message: 'An unexpected error occured',
      detail: message,
      type: 'error',
      buttons: Object.keys(ExitAction).slice(Object.keys(ExitAction).length / 2),
      defaultId: ExitAction.OK,
      cancelId: ExitAction.OK
    })
  }

  if (exitAction === ExitAction.OK) {
    app.relaunch()
  }

  app.quit()
}

export const openFileDialog = async () => {
  const browserWindow = BrowserWindow.getFocusedWindow() as BrowserWindow
  const file = await dialog.showOpenDialog(browserWindow, { properties: ['openFile'] })
  return file
}

export const openAddressBookDialog = async () => {
  const browserWindow = BrowserWindow.getFocusedWindow() as BrowserWindow
  const result = await dialog.showOpenDialog(browserWindow, {
    title: 'Import Contacts',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  return result.canceled ? undefined : result.filePaths[0]
}

export const saveAddressBookDialog = async () => {
  const browserWindow = BrowserWindow.getFocusedWindow() as BrowserWindow
  const result = await dialog.showSaveDialog(browserWindow, {
    title: 'Export Contacts',
    defaultPath: 'frame-contacts.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  return result.canceled ? undefined : result.filePath
}

export const openProfileBackupDialog = async () => {
  const browserWindow = BrowserWindow.getFocusedWindow() as BrowserWindow
  const result = await dialog.showOpenDialog(browserWindow, {
    title: 'Inspect Wren Profile Backup',
    properties: ['openFile'],
    filters: [{ name: 'Wren profile backup', extensions: ['wrenbackup'] }]
  })
  return result.canceled ? undefined : result.filePaths[0]
}

export const saveProfileBackupDialog = async (now = new Date()) => {
  const browserWindow = BrowserWindow.getFocusedWindow() as BrowserWindow
  const date = now.toISOString().slice(0, 10)
  const result = await dialog.showSaveDialog(browserWindow, {
    title: 'Export Encrypted Wren Profile',
    defaultPath: `wren-profile-${date}.wrenbackup`,
    filters: [{ name: 'Wren profile backup', extensions: ['wrenbackup'] }]
  })
  return result.canceled ? undefined : result.filePath
}
