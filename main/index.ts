import { app, dialog } from 'electron'

import { configureApplicationIdentity } from './applicationIdentity'
import { runRequestedProfileMigration } from './profileMigration'

configureApplicationIdentity(app)

try {
  const migration = runRequestedProfileMigration({
    appDataPath: app.getPath('appData'),
    argv: process.argv,
    userDataPath: app.getPath('userData')
  })

  if (!app.requestSingleInstanceLock()) {
    app.exit(1)
  } else {
    if (migration.status === 'imported') {
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
  const message = error instanceof Error ? error.message : 'Unknown profile import error'
  dialog.showErrorBox('Wren profile import failed', message)
  app.exit(1)
}
