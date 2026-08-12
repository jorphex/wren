import { app, dialog } from 'electron'
import {
  openProfileBackupDialog,
  saveProfileBackupDialog,
  showUnhandledExceptionDialog
} from '../../../../main/windows/dialog'

jest.mock('electron', () => ({
  dialog: {
    showMessageBoxSync: jest.fn(),
    showErrorBox: jest.fn(),
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn()
  },
  BrowserWindow: { getFocusedWindow: jest.fn(() => 'focused window') },
  app: {
    quit: jest.fn(),
    relaunch: jest.fn()
  }
}))
jest.mock('../../../../main/windows', () => ({ browserWindows: () => ({ dash: 'mock dash browserwindow' }) }))

describe('#showUnhandledExceptionDialog', () => {
  it('displays the error message to the user', () => {
    showUnhandledExceptionDialog('something bad happened')

    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        detail: 'something bad happened'
      })
    )
  })

  it('gives the user an option to accept the error or quit Frame', () => {
    showUnhandledExceptionDialog('something bad happened')

    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        buttons: ['OK', 'Quit']
      })
    )
  })

  it('will relaunch the app when the user clicks OK', () => {
    dialog.showMessageBoxSync.mockImplementation(() => 0)

    showUnhandledExceptionDialog('something bad happened')

    expect(app.relaunch).toHaveBeenCalled()
    expect(app.quit).toHaveBeenCalled()
  })

  it('will not relaunch the app when the user clicks quit', () => {
    dialog.showMessageBoxSync.mockImplementation(() => 1)

    showUnhandledExceptionDialog('something bad happened')

    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.quit).toHaveBeenCalled()
  })

  it('shows a simple error box and quits for an EADDRINUSE error', () => {
    showUnhandledExceptionDialog('Frame is already running', 'EADDRINUSE')

    expect(dialog.showErrorBox).toHaveBeenCalled()
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.quit).toHaveBeenCalled()
  })
})

describe('profile backup dialogs', () => {
  it('opens only Wren backup files without exposing the selected path elsewhere', async () => {
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/profile.wrenbackup'] })

    await expect(openProfileBackupDialog()).resolves.toBe('/tmp/profile.wrenbackup')
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      'focused window',
      expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: 'Wren profile backup', extensions: ['wrenbackup'] }]
      })
    )
  })

  it('uses a dated non-JSON filename and reports cancellation', async () => {
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/profile.wrenbackup' })
    await expect(saveProfileBackupDialog(new Date('2026-08-12T00:00:00.000Z'))).resolves.toBe(
      '/tmp/profile.wrenbackup'
    )
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      'focused window',
      expect.objectContaining({ defaultPath: 'wren-profile-2026-08-12.wrenbackup' })
    )

    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    await expect(saveProfileBackupDialog()).resolves.toBeUndefined()
  })
})
