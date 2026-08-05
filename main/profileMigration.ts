import fs from 'fs'
import path from 'path'

import { legacyProfilePath } from './applicationIdentity'

const IMPORT_FLAG = '--import-frame-profile'
const IMPORT_SOURCE_PREFIX = '--import-frame-profile-from='
const CONFIG_FILE = 'config.json'
const SIGNERS_DIRECTORY = 'signers'
const RECEIPT_FILE = 'frame-profile-import.json'
const FRAME_LOCK_FILES = ['SingletonCookie', 'SingletonLock', 'SingletonSocket']
const MAX_CONFIG_BYTES = 32 * 1024 * 1024
const MAX_SIGNER_BYTES = 2 * 1024 * 1024
const MAX_SIGNER_FILES = 512
const SIGNER_FILE = /^[A-Za-z0-9._-]+(?:\.json|\.legacy-v1\.bak)$/u

type ProfileMigrationRequest = {
  appDataPath: string
  argv: string[]
  userDataPath: string
}

export type ProfileMigrationResult = { status: 'not-requested' } | { status: 'imported'; files: string[] }

function lstatIfPresent(target: string) {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

function requireDirectory(directory: string, label: string) {
  const stats = fs.lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular directory`)
  }
}

function readValidatedJson(source: string, maximumBytes: number, label: string) {
  const stats = fs.lstatSync(source)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a regular file`)
  if (stats.size > maximumBytes) throw new Error(`${label} exceeds the import size limit`)

  const bytes = fs.readFileSync(source)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return bytes
}

function writePrivateFile(destination: string, bytes: Buffer) {
  const descriptor = fs.openSync(destination, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function copySignerFiles(sourceRoot: string, stagingRoot: string) {
  const source = path.join(sourceRoot, SIGNERS_DIRECTORY)
  if (!lstatIfPresent(source)) return []
  requireDirectory(source, 'Frame signer directory')

  const entries = fs.readdirSync(source, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => SIGNER_FILE.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  if (candidates.length > MAX_SIGNER_FILES) throw new Error('Frame profile contains too many signer files')

  const destination = path.join(stagingRoot, SIGNERS_DIRECTORY)
  fs.mkdirSync(destination, { mode: 0o700 })
  const copied: string[] = []

  for (const entry of candidates) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Frame signer file is not regular: ${entry.name}`)
    }
    const relative = path.join(SIGNERS_DIRECTORY, entry.name)
    const bytes = readValidatedJson(
      path.join(source, entry.name),
      MAX_SIGNER_BYTES,
      `Frame signer file ${entry.name}`
    )
    writePrivateFile(path.join(stagingRoot, relative), bytes)
    copied.push(relative)
  }

  return copied
}

function assertFrameIsClosed(sourceRoot: string) {
  const activeLock = FRAME_LOCK_FILES.find((file) => lstatIfPresent(path.join(sourceRoot, file)))
  if (activeLock) {
    throw new Error('Close Frame before importing its profile, then try again')
  }
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

export function importFrameProfile(sourceProfilePath: string, userDataPath: string): ProfileMigrationResult {
  const sourceRoot = path.resolve(sourceProfilePath)
  const targetRoot = path.resolve(userDataPath)
  const targetParent = path.dirname(targetRoot)

  if (sourceRoot === targetRoot || isInside(sourceRoot, targetRoot) || isInside(targetRoot, sourceRoot)) {
    throw new Error('Frame and Wren profile paths must be different')
  }
  if (lstatIfPresent(targetRoot)) {
    throw new Error('A Wren profile already exists; import is available only before first launch')
  }
  if (!lstatIfPresent(sourceRoot)) throw new Error('No Frame profile was found to import')

  requireDirectory(sourceRoot, 'Frame profile')
  assertFrameIsClosed(sourceRoot)
  requireDirectory(targetParent, 'Wren profile parent directory')

  const stagingRoot = fs.mkdtempSync(path.join(targetParent, '.wren-import-'))
  fs.chmodSync(stagingRoot, 0o700)

  try {
    const config = readValidatedJson(
      path.join(sourceRoot, CONFIG_FILE),
      MAX_CONFIG_BYTES,
      'Frame configuration'
    )
    writePrivateFile(path.join(stagingRoot, CONFIG_FILE), config)
    const files = [CONFIG_FILE, ...copySignerFiles(sourceRoot, stagingRoot)]
    const receipt = Buffer.from(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          importedAt: new Date().toISOString(),
          sourceProfile: 'frame',
          files
        },
        null,
        2
      )}\n`
    )
    writePrivateFile(path.join(stagingRoot, RECEIPT_FILE), receipt)
    fs.renameSync(stagingRoot, targetRoot)
    return { status: 'imported', files }
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

export function runRequestedProfileMigration({
  appDataPath,
  argv,
  userDataPath
}: ProfileMigrationRequest): ProfileMigrationResult {
  if (!argv.includes(IMPORT_FLAG)) return { status: 'not-requested' }
  const sourceArguments = argv.filter((argument) => argument.startsWith(IMPORT_SOURCE_PREFIX))
  if (sourceArguments.length > 1) throw new Error('Specify only one Frame profile import source')
  const requestedSource = sourceArguments[0]?.slice(IMPORT_SOURCE_PREFIX.length)
  if (sourceArguments.length === 1 && !requestedSource) {
    throw new Error('Frame profile import source cannot be empty')
  }
  if (requestedSource && !path.isAbsolute(requestedSource)) {
    throw new Error('Frame profile import source must be an absolute path')
  }
  return importFrameProfile(requestedSource || legacyProfilePath(appDataPath), userDataPath)
}
