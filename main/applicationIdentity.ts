import fs from 'fs'
import path from 'path'

export const APPLICATION_NAME = 'Wren'
export const APPLICATION_ID = 'io.github.jorphex.wren'
export const PROFILE_DIRECTORY = 'wren'
export const LEGACY_PROFILE_DIRECTORY = 'frame'
export const INSTANCE_LOCK_DIRECTORY = '.wren-instance'

type ApplicationIdentityTarget = {
  commandLine: { hasSwitch(name: string): boolean }
  getPath(name: 'appData' | 'userData'): string
  setName(name: string): void
  setPath(name: 'userData', value: string): void
}

type SingleInstanceTarget = Pick<ApplicationIdentityTarget, 'getPath' | 'setPath'> & {
  requestSingleInstanceLock(): boolean
}

export function configureApplicationIdentity(application: ApplicationIdentityTarget) {
  application.setName(APPLICATION_NAME)

  if (!application.commandLine.hasSwitch('user-data-dir')) {
    application.setPath('userData', path.join(application.getPath('appData'), PROFILE_DIRECTORY))
  }

  const appDataPath = application.getPath('appData')
  const userDataPath = canonicalProfilePath(application.getPath('userData'))
  const frameProfilePath = canonicalProfilePath(legacyProfilePath(appDataPath))
  const relativeToFrame = path.relative(frameProfilePath, userDataPath)
  if (
    relativeToFrame === '' ||
    (!relativeToFrame.startsWith(`..${path.sep}`) &&
      relativeToFrame !== '..' &&
      !path.isAbsolute(relativeToFrame))
  ) {
    throw new Error('Wren cannot use a profile inside the Frame profile; use --import-frame-profile instead')
  }
}

export function legacyProfilePath(appDataPath: string) {
  return path.join(appDataPath, LEGACY_PROFILE_DIRECTORY)
}

export function requestWrenSingleInstanceLock(application: SingleInstanceTarget) {
  const profilePath = application.getPath('userData')
  const lockPath = path.join(application.getPath('appData'), INSTANCE_LOCK_DIRECTORY)
  fs.mkdirSync(lockPath, { recursive: true, mode: 0o700 })
  const lockStats = fs.lstatSync(lockPath)
  if (!lockStats.isDirectory() || lockStats.isSymbolicLink()) {
    throw new Error('Wren instance lock path is not a regular directory')
  }
  if (process.platform !== 'win32') fs.chmodSync(lockPath, 0o700)

  application.setPath('userData', lockPath)
  try {
    return application.requestSingleInstanceLock()
  } finally {
    application.setPath('userData', profilePath)
  }
}

export function canonicalProfilePath(profilePath: string) {
  let existing = path.resolve(profilePath)
  const suffix: string[] = []

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    suffix.unshift(path.basename(existing))
    existing = parent
  }

  const canonicalRoot = fs.realpathSync.native(existing)
  const canonical = path.resolve(canonicalRoot, ...suffix)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}
