import { app, dialog } from 'electron'
import log from 'electron-log'

import { configureApplicationIdentity, requestWrenSingleInstanceLock } from './applicationIdentity'
import { rollbackImportedProfile, runRequestedProfileMigration } from './profileMigration'

let importedProfileId: string | undefined
try {
  configureApplicationIdentity(app)

  if (!requestWrenSingleInstanceLock(app)) {
    app.exit(1)
  } else {
    const userDataPath = app.getPath('userData')
    const importRequested = process.argv.includes('--import-frame-profile')
    if (importRequested) log.transports.file.level = false
    const migration = runRequestedProfileMigration({
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

    require('./application')
  }
} catch (error) {
  if (importedProfileId) rollbackImportedProfile(app.getPath('userData'), importedProfileId)
  const message = error instanceof Error ? error.message : 'Unknown profile import error'
  dialog.showErrorBox('Wren startup failed', message)
  app.exit(1)
}
