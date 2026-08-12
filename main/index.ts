import { app, dialog } from 'electron'
import log from 'electron-log'

import { configureApplicationIdentity, requestWrenSingleInstanceLock } from './applicationIdentity'
import { rollbackImportedProfile, runRequestedProfileMigration } from './profileMigration'
import { runPendingProfileRestore, type ProfileRestoreBootstrapResult } from './profileBackup'

let importedProfileId: string | undefined
let profileRestore: ProfileRestoreBootstrapResult = { status: 'not-requested' }
try {
  configureApplicationIdentity(app)

  if (!requestWrenSingleInstanceLock(app)) {
    app.exit(1)
  } else {
    const userDataPath = app.getPath('userData')
    profileRestore = runPendingProfileRestore(userDataPath)
    const importRequested = process.argv.includes('--import-frame-profile')
    if (importRequested) log.transports.file.level = false
    const migration =
      profileRestore.status === 'applied'
        ? ({ status: 'not-requested' } as const)
        : runRequestedProfileMigration({
            appDataPath: app.getPath('appData'),
            argv: process.argv,
            userDataPath
          })
    importedProfileId = migration.status === 'imported' ? migration.importId : undefined

    if (importedProfileId) {
      app.once('ready', () => {
        void dialog.showMessageBox({
          type: 'info',
          title: 'Frame profile imported',
          message: 'Your Frame wallet data was copied into Wren.',
          detail:
            'The original Frame profile was not changed. Wren will now finish migrating its private copy.',
          buttons: ['Continue'],
          defaultId: 0
        })
      })
    }

    if (profileRestore.status === 'applied') {
      const appliedRestore = profileRestore
      app.once('ready', () => {
        void dialog.showMessageBox({
          type: 'info',
          title: 'Wren profile restored',
          message: 'Your encrypted profile backup was restored.',
          detail: `Restored ${appliedRestore.signerCount} encrypted signer record${appliedRestore.signerCount === 1 ? '' : 's'}.`,
          buttons: ['Continue'],
          defaultId: 0
        })
      })
    } else if (profileRestore.status === 'canceled') {
      const canceledRestore = profileRestore
      app.once('ready', () => {
        void dialog.showMessageBox({
          type: 'warning',
          title: 'Wren profile restore canceled',
          message: 'Wren kept your existing profile.',
          detail:
            canceledRestore.reason === 'expired'
              ? 'The restore confirmation expired before Wren restarted.'
              : 'The staged backup could not be applied safely.',
          buttons: ['Continue'],
          defaultId: 0
        })
      })
    }

    require('./application')
  }
} catch (error) {
  if (importedProfileId) rollbackImportedProfile(app.getPath('userData'), importedProfileId)
  const message = error instanceof Error ? error.message : 'Unknown profile import error'
  dialog.showErrorBox('Wren startup failed', message)
  app.exit(1)
}
