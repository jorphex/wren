import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'

const MARKER_NAME = '.os-signer-protection.json'
const MARKER_FORMAT = 'wren-os-signer-protection'
const WRAPPER_FORMAT = 'wren-os-protected-signer'
const PAYLOAD_FORMAT = 'wren-os-protected-signer-payload'
const VERSION = 1
const MAX_SIGNER_BYTES = 2 * 1024 * 1024
const MAX_WRAPPER_BYTES = 4 * 1024 * 1024
const MAX_SIGNER_FILES = 512
const SIGNER_FILE = /^[A-Za-z0-9._-]+(?:\.json|\.legacy-v1\.bak)$/u
const SECURE_LINUX_BACKENDS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])

export type StorageBackend =
  'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown' | 'windows_dpapi'

interface SafeStorageLike {
  decryptString(encrypted: Buffer): string
  encryptString(plainText: string): Buffer
  getSelectedStorageBackend(): StorageBackend
  isEncryptionAvailable(): boolean
}

const Base64Schema = z
  .string()
  .min(1)
  .max(MAX_WRAPPER_BYTES * 2)
const MarkerSchema = z
  .object({
    format: z.literal(MARKER_FORMAT),
    version: z.literal(VERSION),
    backend: z.enum(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6', 'windows_dpapi'])
  })
  .strict()
const WrapperSchema = z
  .object({
    format: z.literal(WRAPPER_FORMAT),
    version: z.literal(VERSION),
    ciphertext: Base64Schema
  })
  .strict()
const PayloadSchema = z
  .object({
    format: z.literal(PAYLOAD_FORMAT),
    version: z.literal(VERSION),
    name: z.string().regex(SIGNER_FILE),
    bytes: Base64Schema
  })
  .strict()

export type OsSignerProtectionState =
  'disabled' | 'enabled' | 'unavailable' | 'recovery-required' | 'unsupported'

export type OsSignerProtectionStatus = Readonly<{
  available: boolean
  backend: StorageBackend | 'unsupported'
  enabled: boolean
  protectedFiles: number
  signerFiles: number
  state: OsSignerProtectionState
}>

type FileSnapshot = Readonly<{ bytes: Buffer; name: string; protected: boolean }>

const canonicalBase64 = (value: string, maximumBytes: number) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error('OS-protected signer data is invalid')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length > maximumBytes || bytes.toString('base64') !== value) {
    throw new Error('OS-protected signer data is invalid')
  }
  return bytes
}

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

const readRegularFile = (source: string, maximumBytes: number, label: string) => {
  const sourceStats = fs.lstatSync(source)
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink() || sourceStats.size > maximumBytes) {
    throw new Error(`${label} is not a regular bounded file`)
  }
  const descriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stats = fs.fstatSync(descriptor)
    if (
      !stats.isFile() ||
      stats.dev !== sourceStats.dev ||
      stats.ino !== sourceStats.ino ||
      stats.size > maximumBytes
    ) {
      throw new Error(`${label} changed while it was read`)
    }
    const bytes = fs.readFileSync(descriptor)
    if (bytes.length > maximumBytes) throw new Error(`${label} exceeds the size limit`)
    return bytes
  } finally {
    fs.closeSync(descriptor)
  }
}

const fsyncDirectory = (directory: string) => {
  if (process.platform === 'win32') return
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY)
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

const atomicWrite = (destination: string, bytes: Buffer) => {
  const directory = path.dirname(destination)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
  const temporary = path.join(directory, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, destination)
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o600)
    fsyncDirectory(directory)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor)
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fs.unlinkSync(temporary)
    } catch {
      // Preserve the original write error.
    }
    throw error
  }
}

const exclusiveWrite = (destination: string, bytes: Buffer) => {
  const directory = path.dirname(destination)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
  let descriptor: number | undefined
  let created = false
  try {
    descriptor = fs.openSync(destination, 'wx', 0o600)
    created = true
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fsyncDirectory(directory)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor)
      } catch {
        // Preserve the original write error.
      }
    }
    if (created) {
      try {
        fs.unlinkSync(destination)
      } catch {
        // Preserve the original write error.
      }
    }
    throw error
  }
}

export class OsSignerStorage {
  readonly signerRoot: string
  private readonly platform: NodeJS.Platform
  private readonly storage: SafeStorageLike

  constructor(profileRoot: string, options: { platform?: NodeJS.Platform; safeStorage: SafeStorageLike }) {
    this.signerRoot = path.join(path.resolve(profileRoot), 'signers')
    this.platform = options.platform || process.platform
    this.storage = options.safeStorage
  }

  private markerPath() {
    return path.join(this.signerRoot, MARKER_NAME)
  }

  private marker() {
    const markerPath = this.markerPath()
    if (!fs.existsSync(markerPath)) return
    const parsed = MarkerSchema.safeParse(
      parseJsonObject(
        readRegularFile(markerPath, 16 * 1024, 'Signer protection marker'),
        'Signer protection marker'
      )
    )
    if (!parsed.success) throw new Error('Signer protection marker is invalid')
    return parsed.data
  }

  private markerMatchesPlatform(marker: z.infer<typeof MarkerSchema>) {
    if (this.platform === 'win32') return marker.backend === 'windows_dpapi'
    if (this.platform === 'linux') return SECURE_LINUX_BACKENDS.has(marker.backend)
    return false
  }

  private backend() {
    if (this.platform === 'win32') {
      try {
        return {
          available: this.storage.isEncryptionAvailable(),
          backend: 'windows_dpapi' as const
        }
      } catch {
        return { available: false, backend: 'windows_dpapi' as const }
      }
    }
    if (this.platform !== 'linux') return { available: false, backend: 'unsupported' as const }
    let backend: StorageBackend = 'unknown'
    let encryptionAvailable = false
    try {
      backend = this.storage.getSelectedStorageBackend()
      encryptionAvailable = this.storage.isEncryptionAvailable()
    } catch {
      return { available: false, backend }
    }
    return { available: encryptionAvailable && SECURE_LINUX_BACKENDS.has(backend), backend }
  }

  private requireSecureBackend() {
    const selected = this.backend()
    if (!selected.available || selected.backend === 'unsupported') {
      if (this.platform === 'win32') throw new Error('Windows DPAPI encryption is unavailable')
      if (this.platform === 'linux') {
        throw new Error('A secure Linux Secret Service or KWallet backend is unavailable')
      }
      throw new Error('OS-backed signer protection is unsupported on this platform')
    }
    return selected.backend
  }

  private fileNames() {
    if (!fs.existsSync(this.signerRoot)) return []
    const root = fs.lstatSync(this.signerRoot)
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw new Error('Wren signer directory is not a regular directory')
    }
    const names = fs
      .readdirSync(this.signerRoot, { withFileTypes: true })
      .filter((entry) => entry.name !== MARKER_NAME && SIGNER_FILE.test(entry.name))
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new Error(`Signer file ${entry.name} is not regular`)
        }
        return entry.name
      })
      .sort((left, right) => left.localeCompare(right))
    if (names.length > MAX_SIGNER_FILES) throw new Error('Wren profile contains too many signer files')
    return names
  }

  private wrapper(bytes: Buffer) {
    if (bytes.length > MAX_WRAPPER_BYTES) throw new Error('Signer file exceeds the size limit')
    let value: unknown
    try {
      value = JSON.parse(bytes.toString('utf8'))
    } catch {
      return
    }
    const parsed = WrapperSchema.safeParse(value)
    return parsed.success ? parsed.data : undefined
  }

  private snapshots() {
    return this.fileNames().map((name): FileSnapshot => {
      const bytes = readRegularFile(
        path.join(this.signerRoot, name),
        MAX_WRAPPER_BYTES,
        `Signer file ${name}`
      )
      return Object.freeze({ bytes, name, protected: Boolean(this.wrapper(bytes)) })
    })
  }

  private protect(name: string, bytes: Buffer) {
    if (!SIGNER_FILE.test(name) || bytes.length > MAX_SIGNER_BYTES) {
      throw new Error('Signer file is invalid or exceeds the size limit')
    }
    parseJsonObject(bytes, `Signer file ${name}`)
    this.requireSecureBackend()
    const plaintext = JSON.stringify({
      format: PAYLOAD_FORMAT,
      version: VERSION,
      name,
      bytes: bytes.toString('base64')
    })
    const ciphertext = this.storage.encryptString(plaintext)
    try {
      return Buffer.from(
        JSON.stringify({
          format: WRAPPER_FORMAT,
          version: VERSION,
          ciphertext: ciphertext.toString('base64')
        }),
        'utf8'
      )
    } finally {
      ciphertext.fill(0)
    }
  }

  private unprotect(name: string, bytes: Buffer) {
    const wrapper = this.wrapper(bytes)
    if (!wrapper) throw new Error(`Signer file ${name} is not OS-protected`)
    this.requireSecureBackend()
    const ciphertext = canonicalBase64(wrapper.ciphertext, MAX_WRAPPER_BYTES)
    let plaintext = ''
    try {
      plaintext = this.storage.decryptString(ciphertext)
      const parsed = PayloadSchema.safeParse(JSON.parse(plaintext))
      if (!parsed.success || parsed.data.name !== name) {
        throw new Error('OS-protected signer data does not match its file')
      }
      const portable = canonicalBase64(parsed.data.bytes, MAX_SIGNER_BYTES)
      parseJsonObject(portable, `Signer file ${name}`)
      return portable
    } catch {
      throw new Error(`OS-protected signer file ${name} could not be decrypted`)
    } finally {
      ciphertext.fill(0)
      plaintext = ''
    }
  }

  status(): OsSignerProtectionStatus {
    const markerPresent = fs.existsSync(this.markerPath())
    let markerValid = true
    let markerMatchesPlatform = true
    try {
      const marker = this.marker()
      markerMatchesPlatform = marker ? this.markerMatchesPlatform(marker) : true
    } catch {
      markerValid = false
    }
    const snapshots = this.snapshots()
    const protectedFiles = snapshots.filter((file) => file.protected).length
    const mixed = markerPresent ? protectedFiles !== snapshots.length : protectedFiles !== 0
    const selected = this.backend()
    let decryptable = true
    if (markerPresent && markerValid && markerMatchesPlatform && !mixed && selected.available) {
      for (const snapshot of snapshots) {
        try {
          this.unprotect(snapshot.name, snapshot.bytes).fill(0)
        } catch {
          decryptable = false
          break
        }
      }
    }
    let state: OsSignerProtectionState
    if (this.platform !== 'linux' && this.platform !== 'win32') state = 'unsupported'
    else if (!markerValid || mixed) state = 'recovery-required'
    else if (markerPresent && (!selected.available || !markerMatchesPlatform || !decryptable)) {
      state = 'unavailable'
    } else if (markerPresent) state = 'enabled'
    else if (!selected.available) state = 'unavailable'
    else state = 'disabled'
    return Object.freeze({
      available: selected.available,
      backend: selected.backend,
      enabled: markerPresent,
      protectedFiles,
      signerFiles: snapshots.length,
      state
    })
  }

  readAllSignerFiles() {
    const marker = this.marker()
    if (marker && !this.markerMatchesPlatform(marker)) {
      throw new Error('OS-protected signer files belong to another operating-system backend')
    }
    const snapshots = this.snapshots()
    const protectedFiles = snapshots.filter((file) => file.protected).length
    if ((marker && protectedFiles !== snapshots.length) || (!marker && protectedFiles !== 0)) {
      throw new Error('Signer protection migration is incomplete')
    }
    if (marker) this.requireSecureBackend()
    return snapshots.map(({ bytes, name, protected: isProtected }) => ({
      bytes: isProtected ? this.unprotect(name, bytes) : bytes,
      name
    }))
  }

  writeSignerFile(name: string, bytes: Buffer, options: { exclusive?: boolean } = {}) {
    if (!SIGNER_FILE.test(name) || !Buffer.isBuffer(bytes) || bytes.length > MAX_SIGNER_BYTES) {
      throw new Error('Signer file is invalid or exceeds the size limit')
    }
    parseJsonObject(bytes, `Signer file ${name}`)
    const marker = this.marker()
    if (marker && !this.markerMatchesPlatform(marker)) {
      throw new Error('OS-protected signer files belong to another operating-system backend')
    }
    const snapshots = this.snapshots()
    const protectedFiles = snapshots.filter((file) => file.protected).length
    if ((marker && protectedFiles !== snapshots.length) || (!marker && protectedFiles !== 0)) {
      throw new Error('Signer protection migration is incomplete')
    }
    if (marker) {
      for (const snapshot of snapshots) {
        this.unprotect(snapshot.name, snapshot.bytes).fill(0)
      }
    }
    const destination = path.join(this.signerRoot, name)
    if (options.exclusive && fs.existsSync(destination)) throw new Error(`Signer file ${name} already exists`)
    const stored = marker ? this.protect(name, bytes) : bytes
    if (options.exclusive) exclusiveWrite(destination, stored)
    else atomicWrite(destination, stored)
  }

  enable() {
    const backend = this.requireSecureBackend()
    const snapshots = this.snapshots()
    for (const snapshot of snapshots) {
      if (!snapshot.protected) {
        atomicWrite(path.join(this.signerRoot, snapshot.name), this.protect(snapshot.name, snapshot.bytes))
      } else {
        this.unprotect(snapshot.name, snapshot.bytes).fill(0)
      }
    }
    atomicWrite(
      this.markerPath(),
      Buffer.from(`${JSON.stringify({ format: MARKER_FORMAT, version: VERSION, backend })}\n`, 'utf8')
    )
    return this.status()
  }

  disable() {
    this.requireSecureBackend()
    const snapshots = this.snapshots()
    for (const snapshot of snapshots) {
      if (snapshot.protected) {
        const bytes = this.unprotect(snapshot.name, snapshot.bytes)
        try {
          atomicWrite(path.join(this.signerRoot, snapshot.name), bytes)
        } finally {
          bytes.fill(0)
        }
      }
    }
    const markerPath = this.markerPath()
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath)
      fsyncDirectory(this.signerRoot)
    }
    return this.status()
  }
}
