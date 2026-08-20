import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'

const CREDENTIAL_FILE = '.etherscan-v2-api-key.json'
const CREDENTIAL_NAME = 'etherscan-v2-api-key'
const WRAPPER_FORMAT = 'wren-contract-verification-credential'
const PAYLOAD_FORMAT = 'wren-contract-verification-credential-payload'
const VERSION = 1
const MAX_API_KEY_LENGTH = 128
const MAX_CIPHERTEXT_BYTES = 16 * 1024
const MAX_WRAPPER_BYTES = 32 * 1024
const STORED_CREDENTIAL_ERROR = 'Explorer API key credential is unavailable or invalid'
const SECURE_STORAGE_ERROR = 'Secure OS credential storage is unavailable'
const SAVE_CREDENTIAL_ERROR = 'Explorer API key could not be saved'

export type SafeStorageBackend =
  | 'basic_text'
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'secret_service'
  | 'unknown'
  | 'windows_dpapi'

export type CredentialBackend =
  'kwallet' | 'kwallet5' | 'kwallet6' | 'secret_service' | 'unsupported' | 'windows_dpapi'

export interface SafeStorageLike {
  decryptString(encrypted: Buffer): string
  encryptString(plainText: string): Buffer
  getSelectedStorageBackend(): SafeStorageBackend
  isEncryptionAvailable(): boolean
}

export type ExplorerCredentialStatus = Readonly<{
  available: boolean
  backend: CredentialBackend
  configured: boolean
}>

type FileSystem = typeof fs
type SupportedPlatform = 'linux' | 'windows'
type SecureBackend = Exclude<CredentialBackend, 'unsupported'>

const ApiKeySchema = z
  .string()
  .min(16)
  .max(MAX_API_KEY_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/u)
const Base64Schema = z
  .string()
  .min(1)
  .max(MAX_CIPHERTEXT_BYTES * 2)
const SecureBackendSchema = z.enum(['kwallet', 'kwallet5', 'kwallet6', 'secret_service', 'windows_dpapi'])
const WrapperSchema = z
  .object({
    format: z.literal(WRAPPER_FORMAT),
    version: z.literal(VERSION),
    name: z.literal(CREDENTIAL_NAME),
    platform: z.enum(['linux', 'windows']),
    backend: SecureBackendSchema,
    ciphertext: Base64Schema
  })
  .strict()
const PayloadSchema = z
  .object({
    format: z.literal(PAYLOAD_FORMAT),
    version: z.literal(VERSION),
    name: z.literal(CREDENTIAL_NAME),
    apiKey: ApiKeySchema
  })
  .strict()

type StoredWrapper = z.infer<typeof WrapperSchema>

const canonicalBase64 = (value: string) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error(STORED_CREDENTIAL_ERROR)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > MAX_CIPHERTEXT_BYTES || bytes.toString('base64') !== value) {
    bytes.fill(0)
    throw new Error(STORED_CREDENTIAL_ERROR)
  }
  return bytes
}

const selectedPlatform = (platform: NodeJS.Platform): SupportedPlatform | undefined => {
  if (platform === 'linux') return 'linux'
  if (platform === 'win32') return 'windows'
  return undefined
}

const canonicalLinuxBackend = (backend: SafeStorageBackend): SecureBackend | undefined => {
  // Electron reports gnome_libsecret; secret_service is the equivalent injected/test alias.
  if (backend === 'gnome_libsecret' || backend === 'secret_service') return 'secret_service'
  if (backend === 'kwallet' || backend === 'kwallet5' || backend === 'kwallet6') return backend
  return undefined
}

const fileExists = (fileSystem: FileSystem, target: string) => {
  try {
    fileSystem.lstatSync(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const fsyncDirectory = (fileSystem: FileSystem, directory: string, platform: NodeJS.Platform) => {
  if (platform === 'win32') return
  let descriptor: number | undefined
  try {
    descriptor = fileSystem.openSync(directory, fileSystem.constants.O_RDONLY)
    fileSystem.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor)
  }
}

const ensureRoot = (fileSystem: FileSystem, root: string) => {
  fileSystem.mkdirSync(root, { recursive: true, mode: 0o700 })
  const stats = fileSystem.lstatSync(root)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(STORED_CREDENTIAL_ERROR)
}

const readRegularFile = (fileSystem: FileSystem, source: string, platform: NodeJS.Platform): Buffer => {
  const before = fileSystem.lstatSync(source)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > MAX_WRAPPER_BYTES ||
    (platform !== 'win32' && (before.mode & 0o077) !== 0)
  ) {
    throw new Error(STORED_CREDENTIAL_ERROR)
  }
  const descriptor = fileSystem.openSync(
    source,
    fileSystem.constants.O_RDONLY | (fileSystem.constants.O_NOFOLLOW || 0)
  )
  try {
    const after = fileSystem.fstatSync(descriptor)
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size < 1 ||
      after.size > MAX_WRAPPER_BYTES ||
      (platform !== 'win32' && (after.mode & 0o077) !== 0)
    ) {
      throw new Error(STORED_CREDENTIAL_ERROR)
    }
    const bytes = fileSystem.readFileSync(descriptor)
    if (bytes.length < 1 || bytes.length > MAX_WRAPPER_BYTES) {
      bytes.fill(0)
      throw new Error(STORED_CREDENTIAL_ERROR)
    }
    return bytes
  } finally {
    fileSystem.closeSync(descriptor)
  }
}

const parseWrapper = (bytes: Buffer): StoredWrapper => {
  try {
    const parsed = WrapperSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (!parsed.success) throw new Error(STORED_CREDENTIAL_ERROR)
    canonicalBase64(parsed.data.ciphertext).fill(0)
    return parsed.data
  } catch {
    throw new Error(STORED_CREDENTIAL_ERROR)
  } finally {
    bytes.fill(0)
  }
}

const atomicWrite = (
  fileSystem: FileSystem,
  destination: string,
  bytes: Buffer,
  platform: NodeJS.Platform
) => {
  const directory = path.dirname(destination)
  ensureRoot(fileSystem, directory)
  const temporary = path.join(directory, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = fileSystem.openSync(temporary, 'wx', 0o600)
    fileSystem.writeFileSync(descriptor, bytes)
    fileSystem.fsyncSync(descriptor)
    fileSystem.closeSync(descriptor)
    descriptor = undefined
    fileSystem.renameSync(temporary, destination)
    if (platform !== 'win32') fileSystem.chmodSync(destination, 0o600)
    fsyncDirectory(fileSystem, directory, platform)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fileSystem.closeSync(descriptor)
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fileSystem.unlinkSync(temporary)
    } catch {
      // Preserve the original write error.
    }
    throw error
  }
}

export const createEtherscanApiKeyStore = (
  profileRoot: string,
  options: {
    fileSystem?: FileSystem
    platform?: NodeJS.Platform
    safeStorage: SafeStorageLike
  }
) => {
  const fileSystem = options.fileSystem || fs
  const platform = options.platform || process.platform
  const safeStorage = options.safeStorage
  const root = path.resolve(profileRoot)
  const credentialPath = path.join(root, CREDENTIAL_FILE)

  const hasCredential = () => {
    try {
      return fileExists(fileSystem, credentialPath)
    } catch {
      throw new Error(STORED_CREDENTIAL_ERROR)
    }
  }

  const backend = (): { available: boolean; backend: CredentialBackend } => {
    if (platform === 'win32') {
      try {
        return {
          available: safeStorage.isEncryptionAvailable(),
          backend: 'windows_dpapi'
        }
      } catch {
        return { available: false, backend: 'windows_dpapi' }
      }
    }
    if (platform !== 'linux') return { available: false, backend: 'unsupported' }
    try {
      const selected = canonicalLinuxBackend(safeStorage.getSelectedStorageBackend())
      const available = safeStorage.isEncryptionAvailable()
      return selected && available
        ? { available: true, backend: selected }
        : { available: false, backend: 'unsupported' }
    } catch {
      return { available: false, backend: 'unsupported' }
    }
  }

  const requireSecureBackend = () => {
    const selected = backend()
    if (!selected.available || selected.backend === 'unsupported') throw new Error(SECURE_STORAGE_ERROR)
    return selected.backend
  }

  const readWrapper = () => {
    try {
      const wrapper = parseWrapper(readRegularFile(fileSystem, credentialPath, platform))
      const expectedPlatform = selectedPlatform(platform)
      if (!expectedPlatform || wrapper.platform !== expectedPlatform) {
        throw new Error(STORED_CREDENTIAL_ERROR)
      }
      return wrapper
    } catch {
      throw new Error(STORED_CREDENTIAL_ERROR)
    }
  }

  const status = (): ExplorerCredentialStatus => {
    const selected = backend()
    let configured = false
    try {
      configured = hasCredential()
      if (configured) {
        const wrapper = readWrapper()
        return Object.freeze({
          available: selected.available && wrapper.backend === selected.backend,
          backend:
            selected.available && wrapper.backend === selected.backend ? selected.backend : 'unsupported',
          configured: true
        })
      }
    } catch {
      throw new Error(STORED_CREDENTIAL_ERROR)
    }
    return Object.freeze({ ...selected, configured })
  }

  const load = () => {
    if (!hasCredential()) return undefined
    const selected = requireSecureBackend()
    const wrapper = readWrapper()
    if (wrapper.backend !== selected) throw new Error(STORED_CREDENTIAL_ERROR)
    const ciphertext = canonicalBase64(wrapper.ciphertext)
    let plaintext = ''
    try {
      plaintext = safeStorage.decryptString(ciphertext)
      const parsed = PayloadSchema.safeParse(JSON.parse(plaintext))
      if (!parsed.success) throw new Error(STORED_CREDENTIAL_ERROR)
      return parsed.data.apiKey
    } catch {
      throw new Error(STORED_CREDENTIAL_ERROR)
    } finally {
      ciphertext.fill(0)
      plaintext = ''
    }
  }

  const save = (apiKey: string): ExplorerCredentialStatus => {
    const parsedKey = ApiKeySchema.safeParse(apiKey)
    if (!parsedKey.success) throw new Error('Explorer API key is invalid')
    const selected = requireSecureBackend()
    const selectedOs = selectedPlatform(platform)
    if (!selectedOs) throw new Error(SECURE_STORAGE_ERROR)
    if (hasCredential()) {
      const current = readWrapper()
      if (current.backend !== selected) throw new Error(STORED_CREDENTIAL_ERROR)
    }
    const plaintext = JSON.stringify({
      format: PAYLOAD_FORMAT,
      version: VERSION,
      name: CREDENTIAL_NAME,
      apiKey: parsedKey.data
    })
    let ciphertext: Buffer
    try {
      ciphertext = safeStorage.encryptString(plaintext)
    } catch {
      throw new Error(SECURE_STORAGE_ERROR)
    }
    try {
      const wrapper = Buffer.from(
        `${JSON.stringify({
          format: WRAPPER_FORMAT,
          version: VERSION,
          name: CREDENTIAL_NAME,
          platform: selectedOs,
          backend: selected,
          ciphertext: ciphertext.toString('base64')
        })}\n`,
        'utf8'
      )
      try {
        try {
          atomicWrite(fileSystem, credentialPath, wrapper, platform)
        } catch {
          throw new Error(SAVE_CREDENTIAL_ERROR)
        }
      } finally {
        wrapper.fill(0)
      }
    } finally {
      ciphertext.fill(0)
    }
    return status()
  }

  const remove = (): ExplorerCredentialStatus => {
    if (!hasCredential()) return status()
    try {
      readRegularFile(fileSystem, credentialPath, platform).fill(0)
      fileSystem.unlinkSync(credentialPath)
      fsyncDirectory(fileSystem, root, platform)
    } catch {
      throw new Error(STORED_CREDENTIAL_ERROR)
    }
    return status()
  }

  return Object.freeze({ credentialPath, load, remove, save, status })
}

export type EtherscanApiKeyStore = ReturnType<typeof createEtherscanApiKeyStore>
