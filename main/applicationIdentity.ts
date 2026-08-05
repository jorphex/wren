import path from 'path'

export const APPLICATION_NAME = 'Wren'
export const APPLICATION_ID = 'io.github.jorphex.wren'
export const PROFILE_DIRECTORY = 'wren'
export const LEGACY_PROFILE_DIRECTORY = 'frame'

type ApplicationIdentityTarget = {
  commandLine: { hasSwitch(name: string): boolean }
  getPath(name: 'appData'): string
  setName(name: string): void
  setPath(name: 'userData', value: string): void
}

export function configureApplicationIdentity(application: ApplicationIdentityTarget) {
  application.setName(APPLICATION_NAME)

  if (!application.commandLine.hasSwitch('user-data-dir')) {
    application.setPath('userData', path.join(application.getPath('appData'), PROFILE_DIRECTORY))
  }
}

export function legacyProfilePath(appDataPath: string) {
  return path.join(appDataPath, LEGACY_PROFILE_DIRECTORY)
}
