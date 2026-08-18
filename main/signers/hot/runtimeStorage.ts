import { app, safeStorage } from 'electron'
import path from 'path'

import { OsSignerStorage } from './storage'

const unavailableSafeStorage = {
  decryptString: () => {
    throw new Error('OS keychain is unavailable')
  },
  encryptString: () => {
    throw new Error('OS keychain is unavailable')
  },
  getSelectedStorageBackend: () => 'unknown' as const,
  isEncryptionAvailable: () => false
}

const userData = app?.getPath
  ? app.getPath('userData')
  : path.resolve(path.dirname(require.main?.filename || process.cwd()), '../.userData')

export const osSignerStorage = new OsSignerStorage(userData, {
  safeStorage: safeStorage || unavailableSafeStorage
})
