import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'

import { canonicalProfilePath, legacyProfilePath } from './applicationIdentity'
import migrations from './store/migrate'
import { MainSchema } from './store/state/types/main'

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
const ADDRESS = /^0x[0-9a-f]{40}$/iu
const ImportedMainSchema = MainSchema.partial().passthrough()

const SignerRecordSchema = z
  .object({
    id: z.string().min(1).max(256),
    addresses: z.array(z.string().regex(ADDRESS)).min(1).max(1024),
    type: z.enum(['seed', 'ring']),
    network: z.string().max(128).optional(),
    encryptedSeed: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional(),
    encryptedKeys: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional()
  })
  .passthrough()
  .superRefine((signer, context) => {
    const validSecret =
      (signer.type === 'seed' && signer.encryptedSeed !== undefined && signer.encryptedKeys === undefined) ||
      (signer.type === 'ring' && signer.encryptedKeys !== undefined && signer.encryptedSeed === undefined)
    if (!validSecret)
      context.addIssue({ code: 'custom', message: 'Signer encryption does not match its type' })
  })

type ProfileMigrationRequest = {
  appDataPath: string
  argv: string[]
  userDataPath: string
}

export type ProfileMigrationResult =
  { status: 'not-requested' } | { status: 'imported'; files: string[]; importId: string }

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
  const sourceStats = fs.lstatSync(source)
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`)
  }

  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(`${label} is not a regular file`)
    }
    throw error
  }

  let bytes: Buffer
  try {
    const stats = fs.fstatSync(descriptor)
    if (!stats.isFile()) throw new Error(`${label} is not a regular file`)
    if (stats.dev !== sourceStats.dev || stats.ino !== sourceStats.ino) {
      throw new Error(`${label} changed during import`)
    }
    if (stats.size > maximumBytes) throw new Error(`${label} exceeds the import size limit`)
    bytes = fs.readFileSync(descriptor)
    if (bytes.length > maximumBytes) throw new Error(`${label} exceeds the import size limit`)

    const finalStats = fs.lstatSync(source)
    if (
      !finalStats.isFile() ||
      finalStats.isSymbolicLink() ||
      finalStats.dev !== stats.dev ||
      finalStats.ino !== stats.ino
    ) {
      throw new Error(`${label} changed during import`)
    }
  } finally {
    fs.closeSync(descriptor)
  }

  let parsed: object
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return { bytes, parsed }
}

function validatePersistedConfiguration(config: unknown) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Frame configuration must contain a JSON object')
  }

  const main = Reflect.get(config, 'main')
  if (!main || typeof main !== 'object' || Array.isArray(main)) {
    throw new Error('Frame configuration does not contain wallet state')
  }

  const snapshots = Reflect.get(main, '__')
  let state: unknown
  if (snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots)) {
    const versions = Object.keys(snapshots).map((version) => {
      if (!/^\d+$/u.test(version)) throw new Error('Frame configuration contains an invalid state version')
      return Number(version)
    })
    if (versions.length === 0) throw new Error('Frame configuration does not contain wallet state')
    const futureVersion = versions.find((version) => version > migrations.latest)
    if (futureVersion !== undefined) {
      throw new Error(`Frame profile version ${futureVersion} is newer than Wren supports`)
    }
    const latestVersion = Math.max(...versions)
    state = Reflect.get(snapshots, String(latestVersion))
  } else {
    state = { main }
  }

  let migrated: ReturnType<typeof migrations.apply>
  try {
    migrated = migrations.apply(structuredClone(state))
  } catch {
    throw new Error('Frame configuration cannot be migrated safely')
  }
  if (!ImportedMainSchema.safeParse(migrated.main).success) {
    throw new Error('Frame configuration is invalid after migration')
  }
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
    const { bytes, parsed } = readValidatedJson(
      path.join(source, entry.name),
      MAX_SIGNER_BYTES,
      `Frame signer file ${entry.name}`
    )
    if (entry.name.endsWith('.json') && !SignerRecordSchema.safeParse(parsed).success) {
      throw new Error(`Frame signer file ${entry.name} has an invalid record`)
    }
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
  const sourceRoot = canonicalProfilePath(sourceProfilePath)
  const targetRoot = canonicalProfilePath(userDataPath)
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
    validatePersistedConfiguration(config.parsed)
    writePrivateFile(path.join(stagingRoot, CONFIG_FILE), config.bytes)
    const files = [CONFIG_FILE, ...copySignerFiles(sourceRoot, stagingRoot)]
    const importId = randomUUID()
    const receipt = Buffer.from(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          importId,
          importedAt: new Date().toISOString(),
          sourceProfile: 'frame',
          files
        },
        null,
        2
      )}\n`
    )
    writePrivateFile(path.join(stagingRoot, RECEIPT_FILE), receipt)
    assertFrameIsClosed(sourceRoot)
    fs.renameSync(stagingRoot, targetRoot)
    return { status: 'imported', files, importId }
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

export function rollbackImportedProfile(userDataPath: string, importId: string) {
  const targetRoot = path.resolve(userDataPath)
  const receipt = path.join(targetRoot, RECEIPT_FILE)
  if (!lstatIfPresent(receipt)) return false
  let parsed: unknown
  try {
    parsed = readValidatedJson(receipt, MAX_SIGNER_BYTES, 'Wren profile import receipt').parsed
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  if (Reflect.get(parsed, 'schemaVersion') !== 1 || Reflect.get(parsed, 'importId') !== importId) {
    return false
  }
  fs.rmSync(targetRoot, { recursive: true, force: true })
  return true
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
