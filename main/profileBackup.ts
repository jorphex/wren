import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'

import {
  SignerRecordSchema,
  migratePersistedConfiguration,
  validatePersistedConfiguration
} from './profileMigration'
import migrations from './store/migrate'

const FORMAT = 'wren-profile-backup'
const VERSION = 1
const AAD = Buffer.from(`${FORMAT}:v${VERSION}`, 'utf8')
const CONFIG_FILE = 'config.json'
const SIGNERS_DIRECTORY = 'signers'
const SIGNER_FILE = /^[A-Za-z0-9._-]+(?:\.json|\.legacy-v1\.bak)$/u
const MAX_CONFIG_BYTES = 32 * 1024 * 1024
const MAX_SIGNER_BYTES = 2 * 1024 * 1024
const MAX_SIGNER_FILES = 512
const MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024
const MAX_BACKUP_BYTES = 96 * 1024 * 1024
const RESTORE_INTENT_MAX_AGE_MS = 10 * 60 * 1000
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32 })

const Base64Schema = z
  .string()
  .min(1)
  .max(MAX_BACKUP_BYTES * 2)
const BackupEnvelopeSchema = z
  .object({
    format: z.literal(FORMAT),
    version: z.literal(VERSION),
    kdf: z
      .object({
        name: z.literal('scrypt'),
        N: z.literal(SCRYPT.N),
        r: z.literal(SCRYPT.r),
        p: z.literal(SCRYPT.p),
        keyLength: z.literal(SCRYPT.keyLength),
        salt: Base64Schema
      })
      .strict(),
    cipher: z
      .object({
        name: z.literal('aes-256-gcm'),
        iv: Base64Schema,
        tag: Base64Schema
      })
      .strict(),
    ciphertext: Base64Schema
  })
  .strict()

const BackupPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: z.string().datetime(),
    files: z
      .object({
        config: Base64Schema,
        signers: z
          .array(
            z
              .object({
                name: z.string().regex(SIGNER_FILE),
                bytes: Base64Schema
              })
              .strict()
          )
          .max(MAX_SIGNER_FILES)
      })
      .strict()
  })
  .strict()

type BackupPayload = z.infer<typeof BackupPayloadSchema>

type ProfileBackupOptions = Readonly<{
  readSignerFiles?: () => ReadonlyArray<{ name: string; bytes: Buffer }>
}>

export type ProfileBackupInspection = Readonly<{
  formatVersion: 1
  createdAt: string
  signerCount: number
}>

export type ProfileBackupFileBinding = Readonly<{
  identity: string
  sha256: string
  backup: ProfileBackupInspection
}>

const RestoreFileSchema = z
  .object({
    name: z.string().regex(/^(?:config\.json|signers\/[A-Za-z0-9._-]+(?:\.json|\.legacy-v1\.bak))$/u),
    bytes: z.number().int().nonnegative().max(MAX_PLAINTEXT_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u)
  })
  .strict()

const RestoreIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    restoreId: z.uuid(),
    targetFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
    stageName: z.string().regex(/^\.wren-restore-[0-9a-f]{16}-stage-[0-9a-f-]{36}$/u),
    previousName: z.string().regex(/^\.wren-restore-[0-9a-f]{16}-previous-[0-9a-f-]{36}$/u),
    stagedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    signerCount: z.number().int().nonnegative().max(MAX_SIGNER_FILES),
    files: z
      .array(RestoreFileSchema)
      .min(1)
      .max(MAX_SIGNER_FILES + 1)
  })
  .strict()

type RestoreIntent = z.infer<typeof RestoreIntentSchema>

const RestoreReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    restoreId: z.uuid(),
    targetFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
    previousName: z.string().regex(/^\.wren-restore-[0-9a-f]{16}-previous-[0-9a-f-]{36}$/u),
    stagedAt: z.string().datetime(),
    restoredAt: z.string().datetime(),
    signerCount: z.number().int().nonnegative().max(MAX_SIGNER_FILES),
    files: z
      .array(RestoreFileSchema)
      .min(1)
      .max(MAX_SIGNER_FILES + 1)
  })
  .strict()

type RestoreReceipt = z.infer<typeof RestoreReceiptSchema>

export type ProfileRestoreBootstrapResult =
  | { status: 'not-requested' }
  | { status: 'applied'; restoreId: string; signerCount: number; restoredAt: string }
  | { status: 'canceled'; reason: 'expired' | 'invalid' | 'failed' }

function fail(message = 'Invalid Wren profile backup'): never {
  throw new Error(message)
}

const canonicalBase64 = (value: string, maximumBytes: number) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > maximumBytes || bytes.toString('base64') !== value) fail()
  return bytes
}

const validatePassword = (password: string) => {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new Error('Backup password must be between 12 and 1024 characters')
  }
}

const lstatIfPresent = (target: string) => {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

const readRegularFileSnapshot = (source: string, maximumBytes: number, label: string) => {
  const sourceStats = fs.lstatSync(source)
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error(`${label} is not a regular file`)

  const descriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stats = fs.fstatSync(descriptor)
    if (
      !stats.isFile() ||
      stats.dev !== sourceStats.dev ||
      stats.ino !== sourceStats.ino ||
      stats.size > maximumBytes
    ) {
      throw new Error(`${label} is not a regular bounded file`)
    }
    const bytes = fs.readFileSync(descriptor)
    if (bytes.length > maximumBytes) throw new Error(`${label} exceeds the size limit`)
    const finalStats = fs.lstatSync(source)
    if (
      !finalStats.isFile() ||
      finalStats.isSymbolicLink() ||
      finalStats.dev !== stats.dev ||
      finalStats.ino !== stats.ino
    ) {
      throw new Error(`${label} changed while it was read`)
    }
    return {
      bytes,
      identity: `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`
    }
  } finally {
    fs.closeSync(descriptor)
  }
}

const readRegularFile = (source: string, maximumBytes: number, label: string) =>
  readRegularFileSnapshot(source, maximumBytes, label).bytes

const parseJsonObject = (bytes: Buffer, label: string) => {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return value
}

const validateSigner = (name: string, bytes: Buffer) => {
  const parsed = parseJsonObject(bytes, `Signer file ${name}`)
  if (name.endsWith('.json') && !SignerRecordSchema.safeParse(parsed).success) {
    throw new Error(`Signer file ${name} has an invalid record`)
  }
}

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const copyKeys = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, structuredClone(source[key])])
  )

const recoveryAccounts = (value: unknown) =>
  Object.fromEntries(
    Object.entries(recordValue(value)).map(([address, account]) => [
      address,
      copyKeys(recordValue(account), [
        'id',
        'name',
        'lastSignerType',
        'address',
        'signer',
        'ensName',
        'created'
      ])
    ])
  )

const recoveryOrigins = (value: unknown) =>
  Object.fromEntries(
    Object.entries(recordValue(value)).flatMap(([id, originValue]) => {
      const origin = recordValue(originValue)
      if (
        origin['sessionOnly'] === true ||
        origin['provenance'] === 'companion' ||
        origin['provenance'] === 'native'
      ) {
        return []
      }
      return [
        [
          id,
          {
            ...copyKeys(origin, ['chain', 'name', 'provenance', 'sourceId']),
            sessionOnly: false,
            session: { requests: 0, startedAt: 0, lastUpdatedAt: 0 }
          }
        ]
      ]
    })
  )

const recoveryPermissions = (value: unknown, droppedOriginIds: Set<string>) =>
  Object.fromEntries(
    Object.entries(recordValue(value)).map(([account, permissionsValue]) => [
      account,
      Object.fromEntries(
        Object.entries(recordValue(permissionsValue)).filter(([originId, permissionValue]) => {
          const permission = recordValue(permissionValue)
          const legacyOrigin = permission['origin']
          return (
            !droppedOriginIds.has(originId) &&
            !(
              typeof legacyOrigin === 'string' &&
              (legacyOrigin === 'Unknown' || legacyOrigin.startsWith('Unknown/'))
            )
          )
        })
      )
    ])
  )

const recoveryNetworks = (value: unknown) => {
  const ethereum = recordValue(recordValue(value)['ethereum'])
  return {
    ethereum: Object.fromEntries(
      Object.entries(ethereum).map(([chainId, chainValue]) => {
        const chain = recordValue(chainValue)
        const connection = recordValue(chain['connection'])
        const endpoints = Array.isArray(connection['endpoints']) ? connection['endpoints'] : []
        return [
          chainId,
          {
            ...copyKeys(chain, ['id', 'name', 'on', 'layer', 'isTestnet', 'explorer']),
            connection: {
              endpoints: endpoints.map((endpointValue) => {
                const endpoint = recordValue(endpointValue)
                return {
                  ...copyKeys(endpoint, ['id', 'on', 'current', 'custom']),
                  connected: false,
                  status: endpoint['on'] === false ? 'off' : 'loading'
                }
              })
            }
          }
        ]
      })
    )
  }
}

const recoveryNetworksMeta = (value: unknown) => {
  const ethereum = recordValue(recordValue(value)['ethereum'])
  return {
    ethereum: Object.fromEntries(
      Object.entries(ethereum).map(([chainId, metadataValue]) => {
        const metadata = recordValue(metadataValue)
        const nativeCurrency = recordValue(metadata['nativeCurrency'])
        const gas = recordValue(metadata['gas'])
        const price = recordValue(gas['price'])
        const levels = recordValue(price['levels'])
        return [
          chainId,
          {
            ...copyKeys(metadata, ['icon', 'primaryColor']),
            nativeCurrency: {
              ...copyKeys(nativeCurrency, ['symbol', 'icon', 'name', 'decimals']),
              usd: { price: 0, change24hr: 0 }
            },
            gas: {
              samples: [],
              price: {
                selected: price['selected'],
                levels: { custom: typeof levels['custom'] === 'string' ? levels['custom'] : '' }
              }
            }
          }
        ]
      })
    )
  }
}

const recoveryMainState = (value: unknown) => {
  const main = recordValue(value)
  const persistedOrigins = recordValue(main['origins'])
  const origins = recoveryOrigins(persistedOrigins)
  const droppedOriginIds = new Set(
    Object.entries(persistedOrigins)
      .filter(([, originValue]) => {
        const origin = recordValue(originValue)
        return (
          origin['sessionOnly'] === true ||
          origin['provenance'] === 'companion' ||
          origin['provenance'] === 'native'
        )
      })
      .map(([id]) => id)
  )
  const tokens = recordValue(main['tokens'])
  const shortcuts = structuredClone(recordValue(main['shortcuts']))
  const summon = recordValue(shortcuts['summon'])
  if (Object.keys(summon).length > 0) summon['configuring'] = false

  return {
    ...copyKeys(main, [
      '_version',
      'colorway',
      'colorwayPrimary',
      'mute',
      'launch',
      'reveal',
      'glideSide',
      'interfaceScale',
      'showLocalNameWithENS',
      'autohide',
      'transactionNotifications',
      'accountCloseLock',
      'hardwareDerivation',
      'menubarGasPrice',
      'lattice',
      'latticeSettings',
      'ledger',
      'trezor',
      'accountsMeta',
      'addressBook'
    ]),
    ...(Object.keys(shortcuts).length > 0 ? { shortcuts } : {}),
    accounts: recoveryAccounts(main['accounts']),
    origins,
    permissions: recoveryPermissions(main['permissions'], droppedOriginIds),
    tokens: {
      custom: Array.isArray(tokens['custom']) ? structuredClone(tokens['custom']) : [],
      known: {}
    },
    networks: recoveryNetworks(main['networks']),
    networksMeta: recoveryNetworksMeta(main['networksMeta'])
  }
}

const sanitizedConfiguration = (bytes: Buffer) => {
  const migrated = migratePersistedConfiguration(parseJsonObject(bytes, 'Wren configuration'))
  const state = { main: recoveryMainState(migrated.main) }

  const normalized = Buffer.from(
    `${JSON.stringify({ main: { __: { [migrations.latest]: state } } })}\n`,
    'utf8'
  )
  if (normalized.length > MAX_CONFIG_BYTES) throw new Error('Wren configuration exceeds the size limit')
  validatePersistedConfiguration(parseJsonObject(normalized, 'Wren configuration'))
  return normalized
}

const profilePayload = (profileRoot: string, now: Date, options: ProfileBackupOptions): BackupPayload => {
  const root = path.resolve(profileRoot)
  const rootStats = fs.lstatSync(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Wren profile is not a regular directory')
  }

  const config = sanitizedConfiguration(
    readRegularFile(path.join(root, CONFIG_FILE), MAX_CONFIG_BYTES, 'Wren configuration')
  )

  const signers: BackupPayload['files']['signers'] = []
  let totalBytes = config.length
  const signerRoot = path.join(root, SIGNERS_DIRECTORY)
  const suppliedFiles = options.readSignerFiles?.()
  const files = suppliedFiles
    ? [...suppliedFiles].sort((left, right) => left.name.localeCompare(right.name))
    : (() => {
        const signerStats = lstatIfPresent(signerRoot)
        if (!signerStats) return []
        if (!signerStats.isDirectory() || signerStats.isSymbolicLink()) {
          throw new Error('Wren signer directory is not a regular directory')
        }
        return fs
          .readdirSync(signerRoot, { withFileTypes: true })
          .filter((entry) => SIGNER_FILE.test(entry.name))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => {
            if (!entry.isFile() || entry.isSymbolicLink()) {
              throw new Error(`Signer file ${entry.name} is not regular`)
            }
            return {
              name: entry.name,
              bytes: readRegularFile(
                path.join(signerRoot, entry.name),
                MAX_SIGNER_BYTES,
                `Signer file ${entry.name}`
              )
            }
          })
      })()
  if (files.length > MAX_SIGNER_FILES) throw new Error('Wren profile contains too many signer files')
  if (new Set(files.map(({ name }) => name)).size !== files.length) {
    throw new Error('Wren profile contains duplicate signer files')
  }

  for (const { name, bytes } of files) {
    if (!SIGNER_FILE.test(name) || !Buffer.isBuffer(bytes) || bytes.length > MAX_SIGNER_BYTES) {
      throw new Error(`Signer file ${name} is invalid or exceeds the size limit`)
    }
    validateSigner(name, bytes)
    totalBytes += bytes.length
    if (totalBytes > MAX_PLAINTEXT_BYTES) throw new Error('Wren profile exceeds the backup size limit')
    signers.push({ name, bytes: bytes.toString('base64') })
  }

  return {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    files: { config: config.toString('base64'), signers }
  }
}

export const createEncryptedProfileBackup = (
  profileRoot: string,
  password: string,
  now = new Date(),
  options: ProfileBackupOptions = {}
) => {
  validatePassword(password)
  const plaintext = Buffer.from(JSON.stringify(profilePayload(profileRoot, now, options)), 'utf8')
  if (plaintext.length > MAX_PLAINTEXT_BYTES) fail('Wren profile exceeds the backup size limit')

  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024
  })
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(AAD)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const envelope = {
      format: FORMAT,
      version: VERSION,
      kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
      ciphertext: ciphertext.toString('base64')
    }
    const encoded = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8')
    if (encoded.length > MAX_BACKUP_BYTES) fail('Wren profile exceeds the backup size limit')
    return encoded
  } finally {
    plaintext.fill(0)
    key.fill(0)
  }
}

const decryptProfileBackup = (backup: Buffer, password: string): BackupPayload => {
  validatePassword(password)
  if (backup.length > MAX_BACKUP_BYTES) fail()
  const parsedEnvelope = BackupEnvelopeSchema.safeParse(parseJsonObject(backup, 'Wren profile backup'))
  if (!parsedEnvelope.success) return fail()
  const envelope = parsedEnvelope.data
  const salt = canonicalBase64(envelope.kdf.salt, 16)
  const iv = canonicalBase64(envelope.cipher.iv, 12)
  const tag = canonicalBase64(envelope.cipher.tag, 16)
  const ciphertext = canonicalBase64(envelope.ciphertext, MAX_PLAINTEXT_BYTES)
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) fail()

  const key = crypto.scryptSync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024
  })
  let plaintext: Buffer | undefined
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    if (plaintext.length > MAX_PLAINTEXT_BYTES) fail()
    const parsedPayload = BackupPayloadSchema.safeParse(
      parseJsonObject(plaintext, 'Wren profile backup payload')
    )
    if (!parsedPayload.success) return fail()
    return parsedPayload.data
  } catch {
    return fail()
  } finally {
    plaintext?.fill(0)
    key.fill(0)
  }
}

export const inspectEncryptedProfileBackup = (backup: Buffer, password: string): ProfileBackupInspection => {
  const payload = decryptProfileBackup(backup, password)
  const config = canonicalBase64(payload.files.config, MAX_CONFIG_BYTES)
  validatePersistedConfiguration(parseJsonObject(config, 'Wren configuration'))
  payload.files.signers.forEach(({ name, bytes }) =>
    validateSigner(name, canonicalBase64(bytes, MAX_SIGNER_BYTES))
  )
  return Object.freeze({
    formatVersion: VERSION,
    createdAt: payload.createdAt,
    signerCount: payload.files.signers.length
  })
}

export const readAndInspectEncryptedProfileBackup = (source: string, password: string) =>
  inspectEncryptedProfileBackup(readRegularFile(source, MAX_BACKUP_BYTES, 'Wren profile backup'), password)

export const inspectEncryptedProfileBackupFile = (
  source: string,
  password: string
): ProfileBackupFileBinding => {
  const snapshot = readRegularFileSnapshot(source, MAX_BACKUP_BYTES, 'Wren profile backup')
  return Object.freeze({
    identity: snapshot.identity,
    sha256: sha256(snapshot.bytes),
    backup: inspectEncryptedProfileBackup(snapshot.bytes, password)
  })
}

const writePrivateFile = (destination: string, bytes: Buffer) => {
  const descriptor = fs.openSync(destination, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex')

const targetFingerprint = (targetRoot: string) =>
  sha256(Buffer.from(process.platform === 'win32' ? targetRoot.toLowerCase() : targetRoot)).slice(0, 16)

const restorePaths = (targetProfileRoot: string) => {
  const targetRoot = path.resolve(targetProfileRoot)
  const parent = path.dirname(targetRoot)
  const fingerprint = targetFingerprint(targetRoot)
  return {
    targetRoot,
    parent,
    fingerprint,
    intentPath: path.join(parent, `.wren-restore-${fingerprint}-intent.json`),
    stagePrefix: `.wren-restore-${fingerprint}-stage-`
  }
}

const requireRegularDirectory = (directory: string, label: string) => {
  const stats = fs.lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} is not a regular directory`)
}

const ensurePrivateDirectory = (directory: string, label: string) => {
  requireRegularDirectory(directory, label)
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
}

const writeAtomicPrivateJson = (destination: string, value: unknown) => {
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`
  try {
    writePrivateFile(temporary, Buffer.from(`${JSON.stringify(value, null, 2)}\n`))
    fs.renameSync(temporary, destination)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

const safeRemoveRestoreDirectory = (directory: string, parent: string, prefix: string) => {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const exactRestoreDirectory = new RegExp(
    `^${escapedPrefix}[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'u'
  )
  if (path.dirname(directory) !== parent || !exactRestoreDirectory.test(path.basename(directory)))
    return false
  const stats = lstatIfPresent(directory)
  if (!stats) return true
  if (!stats.isDirectory() || stats.isSymbolicLink()) return false
  fs.rmSync(directory, { recursive: true, force: true })
  return true
}

const stagedFiles = (root: string, expected: RestoreIntent['files']) => {
  ensurePrivateDirectory(root, 'Wren restore stage')
  const files = expected.map((file) => {
    const destination = path.join(root, ...file.name.split('/'))
    const relative = path.relative(root, destination)
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail('Invalid Wren restore stage')
    const maximum = file.name === CONFIG_FILE ? MAX_CONFIG_BYTES : MAX_SIGNER_BYTES
    const bytes = readRegularFile(destination, maximum, `Restore file ${file.name}`)
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) fail('Invalid Wren restore stage')
    return { ...file, bytesValue: bytes }
  })

  const config = files.find(({ name }) => name === CONFIG_FILE)?.bytesValue
  if (!config) fail('Invalid Wren restore stage')
  validatePersistedConfiguration(parseJsonObject(config, 'Wren configuration'))
  files
    .filter(({ name }) => name.startsWith(`${SIGNERS_DIRECTORY}/`))
    .forEach(({ name, bytesValue }) => validateSigner(path.basename(name), bytesValue))
  return files
}

const writeStagedPayload = (stageRoot: string, payload: BackupPayload) => {
  const config = canonicalBase64(payload.files.config, MAX_CONFIG_BYTES)
  validatePersistedConfiguration(parseJsonObject(config, 'Wren configuration'))
  writePrivateFile(path.join(stageRoot, CONFIG_FILE), config)

  const files: RestoreIntent['files'] = [{ name: CONFIG_FILE, bytes: config.length, sha256: sha256(config) }]
  if (payload.files.signers.length > 0) {
    const signerRoot = path.join(stageRoot, SIGNERS_DIRECTORY)
    fs.mkdirSync(signerRoot, { mode: 0o700 })
    payload.files.signers.forEach(({ name, bytes }) => {
      const decoded = canonicalBase64(bytes, MAX_SIGNER_BYTES)
      validateSigner(name, decoded)
      writePrivateFile(path.join(signerRoot, name), decoded)
      files.push({ name: `${SIGNERS_DIRECTORY}/${name}`, bytes: decoded.length, sha256: sha256(decoded) })
    })
  }
  return files
}

const stageProfileRestorePayload = (payload: BackupPayload, targetProfileRoot: string, now = new Date()) => {
  const { targetRoot, parent, fingerprint, intentPath, stagePrefix } = restorePaths(targetProfileRoot)
  requireRegularDirectory(parent, 'Wren profile parent')
  if (lstatIfPresent(intentPath)) throw new Error('A Wren profile restore is already pending')
  const target = fs.lstatSync(targetRoot)
  if (!target.isDirectory() || target.isSymbolicLink())
    throw new Error('Wren profile is not a regular directory')

  const restoreId = crypto.randomUUID()
  const stageName = `${stagePrefix}${restoreId}`
  const previousName = `.wren-restore-${fingerprint}-previous-${restoreId}`
  const stageRoot = path.join(parent, stageName)
  fs.mkdirSync(stageRoot, { mode: 0o700 })

  try {
    const files = writeStagedPayload(stageRoot, payload)
    const stagedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + RESTORE_INTENT_MAX_AGE_MS).toISOString()
    const intent = RestoreIntentSchema.parse({
      schemaVersion: 1,
      restoreId,
      targetFingerprint: fingerprint,
      stageName,
      previousName,
      stagedAt,
      expiresAt,
      signerCount: payload.files.signers.length,
      files
    })
    stagedFiles(stageRoot, intent.files)
    writeAtomicPrivateJson(intentPath, intent)
    return Object.freeze({
      restoreId,
      stagedAt,
      expiresAt,
      signerCount: intent.signerCount,
      relaunchRequired: true as const
    })
  } catch (error) {
    safeRemoveRestoreDirectory(stageRoot, parent, stagePrefix)
    throw error
  }
}

export const stageEncryptedProfileRestore = (
  source: string,
  password: string,
  targetProfileRoot: string,
  now = new Date()
) => {
  const backup = readRegularFile(source, MAX_BACKUP_BYTES, 'Wren profile backup')
  return stageProfileRestorePayload(decryptProfileBackup(backup, password), targetProfileRoot, now)
}

export const stageInspectedProfileRestore = (
  source: string,
  password: string,
  binding: ProfileBackupFileBinding,
  targetProfileRoot: string,
  now = new Date()
) => {
  const snapshot = readRegularFileSnapshot(source, MAX_BACKUP_BYTES, 'Wren profile backup')
  if (snapshot.identity !== binding.identity || sha256(snapshot.bytes) !== binding.sha256) {
    throw new Error('The inspected Wren profile backup changed before restore')
  }
  const payload = decryptProfileBackup(snapshot.bytes, password)
  const inspection = inspectEncryptedProfileBackup(snapshot.bytes, password)
  if (JSON.stringify(inspection) !== JSON.stringify(binding.backup)) {
    throw new Error('The inspected Wren profile backup changed before restore')
  }
  return stageProfileRestorePayload(payload, targetProfileRoot, now)
}

const readRestoreIntent = (intentPath: string) => {
  const parsed = RestoreIntentSchema.safeParse(
    parseJsonObject(readRegularFile(intentPath, 1024 * 1024, 'Wren restore intent'), 'Wren restore intent')
  )
  if (!parsed.success) throw new Error('Invalid Wren restore intent')
  return parsed.data
}

const readRestoreReceipt = (targetRoot: string) => {
  const receiptPath = path.join(targetRoot, 'wren-profile-restore.json')
  if (!lstatIfPresent(receiptPath)) return
  try {
    const parsed = RestoreReceiptSchema.safeParse(
      parseJsonObject(
        readRegularFile(receiptPath, 1024 * 1024, 'Wren restore receipt'),
        'Wren restore receipt'
      )
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const cleanupOrphanedStages = (parent: string, stagePrefix: string, keep?: string) => {
  fs.readdirSync(parent, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === keep || !entry.name.startsWith(stagePrefix)) return
    try {
      safeRemoveRestoreDirectory(path.join(parent, entry.name), parent, stagePrefix)
    } catch {
      // A later early-bootstrap pass can retry; never trade profile availability for cleanup.
    }
  })
}

const validReceiptForTarget = (
  receipt: RestoreReceipt | undefined,
  targetRoot: string,
  fingerprint: string,
  intent?: RestoreIntent
) => {
  if (
    !receipt ||
    receipt.targetFingerprint !== fingerprint ||
    (intent &&
      (receipt.restoreId !== intent.restoreId ||
        receipt.previousName !== intent.previousName ||
        receipt.stagedAt !== intent.stagedAt ||
        receipt.signerCount !== intent.signerCount ||
        JSON.stringify(receipt.files) !== JSON.stringify(intent.files)))
  ) {
    return false
  }
  try {
    stagedFiles(targetRoot, receipt.files)
    return true
  } catch {
    return false
  }
}

const finalizeRestoreReceipt = (
  receipt: RestoreReceipt,
  targetRoot: string,
  parent: string,
  fingerprint: string,
  intentPath: string,
  stagePrefix: string
) => {
  if (!validReceiptForTarget(receipt, targetRoot, fingerprint)) return false
  const previousRoot = path.join(parent, receipt.previousName)
  if (path.dirname(previousRoot) !== parent) return false
  try {
    fs.rmSync(intentPath, { force: true })
  } catch {
    // The receipt makes finalization idempotent; retry intent cleanup on the next bootstrap.
  }
  try {
    safeRemoveRestoreDirectory(previousRoot, parent, `.wren-restore-${fingerprint}-previous-`)
  } catch {
    // Keep the valid installed profile and retry sensitive old-profile cleanup on next startup.
  }
  cleanupOrphanedStages(parent, stagePrefix)
  return true
}

const restoreDisplacedProfile = (
  targetRoot: string,
  previousRoot: string,
  parent: string,
  fingerprint: string,
  restoreId: string
) => {
  const previous = lstatIfPresent(previousRoot)
  if (!previous) return
  if (!previous.isDirectory() || previous.isSymbolicLink()) {
    throw new Error('Wren displaced profile is not a regular directory')
  }
  const installed = lstatIfPresent(targetRoot)
  if (!installed) {
    fs.renameSync(previousRoot, targetRoot)
    return
  }
  if (!installed.isDirectory() || installed.isSymbolicLink()) {
    throw new Error('Wren installed profile is not a regular directory')
  }

  const failedRoot = path.join(parent, `.wren-restore-${fingerprint}-failed-${restoreId}`)
  fs.renameSync(targetRoot, failedRoot)
  try {
    fs.renameSync(previousRoot, targetRoot)
  } catch (error) {
    fs.renameSync(failedRoot, targetRoot)
    throw error
  }
  safeRemoveRestoreDirectory(failedRoot, parent, `.wren-restore-${fingerprint}-failed-`)
}

export const runPendingProfileRestore = (
  targetProfileRoot: string,
  now = new Date()
): ProfileRestoreBootstrapResult => {
  const { targetRoot, parent, fingerprint, intentPath, stagePrefix } = restorePaths(targetProfileRoot)
  requireRegularDirectory(parent, 'Wren profile parent')
  if (!lstatIfPresent(intentPath)) {
    const receipt = readRestoreReceipt(targetRoot)
    if (receipt) finalizeRestoreReceipt(receipt, targetRoot, parent, fingerprint, intentPath, stagePrefix)
    cleanupOrphanedStages(parent, stagePrefix)
    return { status: 'not-requested' }
  }

  let intent: RestoreIntent
  try {
    intent = readRestoreIntent(intentPath)
  } catch {
    fs.rmSync(intentPath, { force: true })
    cleanupOrphanedStages(parent, stagePrefix)
    return { status: 'canceled', reason: 'invalid' }
  }

  const stageRoot = path.join(parent, intent.stageName)
  const previousRoot = path.join(parent, intent.previousName)
  if (
    intent.targetFingerprint !== fingerprint ||
    path.dirname(stageRoot) !== parent ||
    path.dirname(previousRoot) !== parent ||
    intent.stageName !== `${stagePrefix}${intent.restoreId}` ||
    Number.isNaN(Date.parse(intent.expiresAt)) ||
    now.getTime() > Date.parse(intent.expiresAt) ||
    now.getTime() < Date.parse(intent.stagedAt) - 60_000
  ) {
    restoreDisplacedProfile(targetRoot, previousRoot, parent, fingerprint, intent.restoreId)
    safeRemoveRestoreDirectory(stageRoot, parent, stagePrefix)
    fs.rmSync(intentPath, { force: true })
    cleanupOrphanedStages(parent, stagePrefix)
    return {
      status: 'canceled',
      reason: now.getTime() > Date.parse(intent.expiresAt) ? 'expired' : 'invalid'
    }
  }

  const existingReceipt = readRestoreReceipt(targetRoot)
  if (
    existingReceipt &&
    validReceiptForTarget(existingReceipt, targetRoot, fingerprint, intent) &&
    finalizeRestoreReceipt(existingReceipt, targetRoot, parent, fingerprint, intentPath, stagePrefix)
  ) {
    return {
      status: 'applied',
      restoreId: intent.restoreId,
      signerCount: intent.signerCount,
      restoredAt: existingReceipt.restoredAt
    }
  }

  let displaced = lstatIfPresent(previousRoot)?.isDirectory() === true
  let installed =
    !lstatIfPresent(stageRoot) && displaced && lstatIfPresent(targetRoot)?.isDirectory() === true
  try {
    if (!installed) stagedFiles(stageRoot, intent.files)
    if (!displaced) {
      ensurePrivateDirectory(targetRoot, 'Wren profile')
      fs.renameSync(targetRoot, previousRoot)
      displaced = true
    }
    if (!installed) {
      fs.renameSync(stageRoot, targetRoot)
      installed = true
    }
    stagedFiles(targetRoot, intent.files)
    const restoredAt = now.toISOString()
    const receipt = RestoreReceiptSchema.parse({
      schemaVersion: 1,
      restoreId: intent.restoreId,
      targetFingerprint: fingerprint,
      previousName: intent.previousName,
      stagedAt: intent.stagedAt,
      restoredAt,
      signerCount: intent.signerCount,
      files: intent.files
    })
    writePrivateFile(
      path.join(targetRoot, 'wren-profile-restore.json'),
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
    )
    if (!finalizeRestoreReceipt(receipt, targetRoot, parent, fingerprint, intentPath, stagePrefix)) {
      throw new Error('Wren restore receipt could not be finalized')
    }
    return { status: 'applied', restoreId: intent.restoreId, signerCount: intent.signerCount, restoredAt }
  } catch {
    try {
      if (displaced) restoreDisplacedProfile(targetRoot, previousRoot, parent, fingerprint, intent.restoreId)
      fs.rmSync(intentPath, { force: true })
      safeRemoveRestoreDirectory(stageRoot, parent, stagePrefix)
      cleanupOrphanedStages(parent, stagePrefix)
      return { status: 'canceled', reason: 'failed' }
    } catch (rollbackError) {
      throw new Error(
        `Wren profile restore rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      )
    }
  }
}

export const writeEncryptedProfileBackup = (
  profileRoot: string,
  destination: string,
  password: string,
  now = new Date(),
  options: ProfileBackupOptions = {}
) => {
  const backup = createEncryptedProfileBackup(profileRoot, password, now, options)
  writePrivateFile(destination, backup)
  return { bytes: backup.length }
}
