import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { OsSignerStorage, type StorageBackend } from '../../../../main/signers/hot/storage'

class FakeSafeStorage {
  available = true
  backend: StorageBackend = 'gnome_libsecret'
  backendCalls = 0
  decryptCalls = 0
  encryptCalls = 0
  failDecryptAt = 0
  failEncryptAt = 0
  private readonly key: Buffer

  constructor(key = crypto.randomBytes(32)) {
    this.key = key
  }

  getSelectedStorageBackend() {
    this.backendCalls += 1
    return this.backend
  }

  isEncryptionAvailable() {
    return this.available
  }

  encryptString(plaintext: string) {
    this.encryptCalls += 1
    if (this.failEncryptAt === this.encryptCalls) throw new Error('injected encrypt failure')
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
  }

  decryptString(encrypted: Buffer) {
    this.decryptCalls += 1
    if (this.failDecryptAt === this.decryptCalls) throw new Error('injected decrypt failure')
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, encrypted.subarray(0, 12))
    decipher.setAuthTag(encrypted.subarray(12, 28))
    return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8')
  }
}

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

const signerRecord = (id: string) =>
  Buffer.from(
    JSON.stringify({
      id,
      addresses: [`0x${id.padEnd(40, 'a').slice(0, 40)}`],
      type: 'seed',
      encryptedSeed: { version: 2, ciphertext: `password-encrypted-${id}` }
    })
  )

const fixture = (safeStorage = new FakeSafeStorage(), platform: NodeJS.Platform = 'linux') => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-os-signer-storage-'))
  roots.push(profile)
  const signerRoot = path.join(profile, 'signers')
  fs.mkdirSync(signerRoot, { mode: 0o700 })
  const records = {
    'alpha.json': signerRecord('alpha'),
    'alpha.legacy-v1.bak': signerRecord('alpha-legacy'),
    'beta.json': signerRecord('beta')
  }
  Object.entries(records).forEach(([name, bytes]) =>
    fs.writeFileSync(path.join(signerRoot, name), bytes, { mode: 0o600 })
  )
  return {
    profile,
    records,
    safeStorage,
    signerRoot,
    storage: new OsSignerStorage(profile, { platform, safeStorage })
  }
}

test('protects all signer and legacy recovery files while preserving portable bytes', () => {
  const { records, signerRoot, storage } = fixture()

  expect(storage.status()).toMatchObject({ state: 'disabled', enabled: false, signerFiles: 3 })
  expect(storage.enable()).toMatchObject({ state: 'enabled', enabled: true, protectedFiles: 3 })

  for (const [name, original] of Object.entries(records)) {
    const stored = fs.readFileSync(path.join(signerRoot, name))
    expect(stored.includes(original)).toBe(false)
    expect(JSON.parse(stored.toString())).toMatchObject({ format: 'wren-os-protected-signer', version: 1 })
  }
  expect(fs.statSync(path.join(signerRoot, '.os-signer-protection.json')).mode & 0o777).toBe(0o600)
  expect(Object.fromEntries(storage.readAllSignerFiles().map(({ name, bytes }) => [name, bytes]))).toEqual(
    records
  )
})

test('disabling removes only the device layer and restores exact password-encrypted bytes', () => {
  const { records, signerRoot, storage } = fixture()
  storage.enable()

  expect(storage.disable()).toMatchObject({ state: 'disabled', enabled: false, protectedFiles: 0 })
  expect(fs.existsSync(path.join(signerRoot, '.os-signer-protection.json'))).toBe(false)
  Object.entries(records).forEach(([name, bytes]) => {
    expect(fs.readFileSync(path.join(signerRoot, name))).toEqual(bytes)
  })
})

test('uses Windows DPAPI without querying the Linux-only backend API', () => {
  const safeStorage = new FakeSafeStorage()
  const { records, signerRoot, storage } = fixture(safeStorage, 'win32')

  expect(storage.status()).toMatchObject({
    available: true,
    backend: 'windows_dpapi',
    enabled: false,
    state: 'disabled'
  })
  expect(storage.enable()).toMatchObject({
    backend: 'windows_dpapi',
    enabled: true,
    protectedFiles: 3,
    state: 'enabled'
  })
  expect(JSON.parse(fs.readFileSync(path.join(signerRoot, '.os-signer-protection.json'), 'utf8'))).toEqual({
    format: 'wren-os-signer-protection',
    version: 1,
    backend: 'windows_dpapi'
  })
  expect(Object.fromEntries(storage.readAllSignerFiles().map(({ name, bytes }) => [name, bytes]))).toEqual(
    records
  )
  expect(storage.disable()).toMatchObject({ enabled: false, protectedFiles: 0, state: 'disabled' })
  expect(safeStorage.backendCalls).toBe(0)
})

test('reopens Windows DPAPI-protected signers after an application restart', () => {
  const key = crypto.randomBytes(32)
  const firstSafeStorage = new FakeSafeStorage(key)
  const first = fixture(firstSafeStorage, 'win32')
  first.storage.enable()

  const restartedSafeStorage = new FakeSafeStorage(key)
  const restarted = new OsSignerStorage(first.profile, {
    platform: 'win32',
    safeStorage: restartedSafeStorage
  })

  expect(restarted.status()).toMatchObject({
    available: true,
    backend: 'windows_dpapi',
    enabled: true,
    protectedFiles: 3,
    state: 'enabled'
  })
  expect(Object.fromEntries(restarted.readAllSignerFiles().map(({ name, bytes }) => [name, bytes]))).toEqual(
    first.records
  )
  expect(firstSafeStorage.backendCalls).toBe(0)
  expect(restartedSafeStorage.backendCalls).toBe(0)
})

test('fails Windows DPAPI-protected signers closed under another Windows identity', () => {
  const first = fixture(new FakeSafeStorage(), 'win32')
  first.storage.enable()
  const otherIdentity = new FakeSafeStorage()
  const copiedProfile = new OsSignerStorage(first.profile, {
    platform: 'win32',
    safeStorage: otherIdentity
  })

  expect(copiedProfile.status()).toMatchObject({
    available: true,
    backend: 'windows_dpapi',
    enabled: true,
    state: 'unavailable'
  })
  expect(() => copiedProfile.readAllSignerFiles()).toThrow('could not be decrypted')
  expect(() => copiedProfile.writeSignerFile('new.json', signerRecord('new'))).toThrow(
    'could not be decrypted'
  )
  expect(fs.existsSync(path.join(first.signerRoot, 'new.json'))).toBe(false)
  expect(otherIdentity.backendCalls).toBe(0)
})

test('does not reinterpret a Linux keychain marker as Windows DPAPI data', () => {
  const key = crypto.randomBytes(32)
  const linux = fixture(new FakeSafeStorage(key), 'linux')
  linux.storage.enable()
  const windowsSafeStorage = new FakeSafeStorage(key)
  const windows = new OsSignerStorage(linux.profile, {
    platform: 'win32',
    safeStorage: windowsSafeStorage
  })

  expect(windows.status()).toMatchObject({
    available: true,
    backend: 'windows_dpapi',
    enabled: true,
    state: 'unavailable'
  })
  expect(() => windows.readAllSignerFiles()).toThrow(
    'OS-protected signer files belong to another operating-system backend'
  )
  expect(() => windows.writeSignerFile('new.json', signerRecord('new'))).toThrow(
    'OS-protected signer files belong to another operating-system backend'
  )
  expect(windowsSafeStorage.backendCalls).toBe(0)
})

test('fails Windows DPAPI protection closed when encryption is unavailable', () => {
  const safeStorage = new FakeSafeStorage()
  safeStorage.available = false
  const { signerRoot, storage } = fixture(safeStorage, 'win32')

  expect(storage.status()).toMatchObject({
    available: false,
    backend: 'windows_dpapi',
    enabled: false,
    state: 'unavailable'
  })
  expect(() => storage.enable()).toThrow('Windows DPAPI encryption is unavailable')
  expect(fs.existsSync(path.join(signerRoot, '.os-signer-protection.json'))).toBe(false)
  expect(safeStorage.encryptCalls).toBe(0)
  expect(safeStorage.backendCalls).toBe(0)
})

test('rejects tampered Windows DPAPI ciphertext without changing the profile', () => {
  const { signerRoot, storage } = fixture(new FakeSafeStorage(), 'win32')
  storage.enable()
  const signerPath = path.join(signerRoot, 'alpha.json')
  const wrapper = JSON.parse(fs.readFileSync(signerPath, 'utf8'))
  const ciphertext = Buffer.from(wrapper.ciphertext, 'base64')
  ciphertext[ciphertext.length - 1] ^= 1
  wrapper.ciphertext = ciphertext.toString('base64')
  fs.writeFileSync(signerPath, JSON.stringify(wrapper))

  expect(storage.status()).toMatchObject({ enabled: true, state: 'unavailable' })
  expect(() => storage.readAllSignerFiles()).toThrow('could not be decrypted')
  expect(JSON.parse(fs.readFileSync(signerPath, 'utf8')).format).toBe('wren-os-protected-signer')
})

test('recovers Windows DPAPI migrations interrupted in either direction', () => {
  const safeStorage = new FakeSafeStorage()
  safeStorage.failEncryptAt = 2
  const { records, storage } = fixture(safeStorage, 'win32')

  expect(() => storage.enable()).toThrow('injected encrypt failure')
  expect(storage.status()).toMatchObject({ enabled: false, protectedFiles: 1, state: 'recovery-required' })
  expect(() => storage.readAllSignerFiles()).toThrow('Signer protection migration is incomplete')

  safeStorage.failEncryptAt = 0
  expect(storage.enable()).toMatchObject({ enabled: true, protectedFiles: 3, state: 'enabled' })
  safeStorage.decryptCalls = 0
  safeStorage.failDecryptAt = 2

  expect(() => storage.disable()).toThrow('could not be decrypted')
  expect(storage.status()).toMatchObject({ enabled: true, state: 'recovery-required' })
  expect(() => storage.readAllSignerFiles()).toThrow('Signer protection migration is incomplete')

  safeStorage.failDecryptAt = 0
  expect(storage.disable()).toMatchObject({ enabled: false, protectedFiles: 0, state: 'disabled' })
  expect(Object.fromEntries(storage.readAllSignerFiles().map(({ name, bytes }) => [name, bytes]))).toEqual(
    records
  )
  expect(safeStorage.backendCalls).toBe(0)
})

test.each(['basic_text', 'unknown'] as const)(
  'rejects insecure or uninitialized Linux backend %s',
  (backend) => {
    const safeStorage = new FakeSafeStorage()
    safeStorage.backend = backend
    const { signerRoot, storage } = fixture(safeStorage)

    expect(storage.status()).toMatchObject({
      available: false,
      backend,
      enabled: false,
      state: 'unavailable'
    })
    expect(() => storage.enable()).toThrow('secure Linux Secret Service or KWallet backend is unavailable')
    expect(fs.existsSync(path.join(signerRoot, '.os-signer-protection.json'))).toBe(false)
  }
)

test('does not silently downgrade an enabled profile when its keychain becomes unavailable', () => {
  const { safeStorage, signerRoot, storage } = fixture()
  storage.enable()
  safeStorage.available = false

  expect(storage.status()).toMatchObject({ enabled: true, state: 'unavailable' })
  expect(() => storage.readAllSignerFiles()).toThrow(
    'secure Linux Secret Service or KWallet backend is unavailable'
  )
  expect(() => storage.writeSignerFile('new.json', signerRecord('new'))).toThrow(
    'secure Linux Secret Service or KWallet backend is unavailable'
  )
  expect(fs.existsSync(path.join(signerRoot, 'new.json'))).toBe(false)
  expect(JSON.parse(fs.readFileSync(path.join(signerRoot, 'alpha.json'), 'utf8')).format).toBe(
    'wren-os-protected-signer'
  )
})

test('fails the complete signer set closed after interrupted enable and can resume', () => {
  const safeStorage = new FakeSafeStorage()
  safeStorage.failEncryptAt = 2
  const { storage } = fixture(safeStorage)

  expect(() => storage.enable()).toThrow('injected encrypt failure')
  expect(storage.status()).toMatchObject({ enabled: false, protectedFiles: 1, state: 'recovery-required' })
  expect(() => storage.readAllSignerFiles()).toThrow('Signer protection migration is incomplete')

  safeStorage.failEncryptAt = 0
  expect(storage.enable()).toMatchObject({ enabled: true, protectedFiles: 3, state: 'enabled' })
  expect(storage.readAllSignerFiles()).toHaveLength(3)
})

test('keeps the marker during interrupted disable and can finish restoring portable records', () => {
  const safeStorage = new FakeSafeStorage()
  const { records, storage } = fixture(safeStorage)
  storage.enable()
  safeStorage.decryptCalls = 0
  safeStorage.failDecryptAt = 2

  expect(() => storage.disable()).toThrow('could not be decrypted')
  expect(storage.status()).toMatchObject({ enabled: true, state: 'recovery-required' })
  expect(() => storage.readAllSignerFiles()).toThrow('Signer protection migration is incomplete')

  safeStorage.failDecryptAt = 0
  expect(storage.disable()).toMatchObject({ enabled: false, protectedFiles: 0, state: 'disabled' })
  expect(Object.fromEntries(storage.readAllSignerFiles().map(({ name, bytes }) => [name, bytes]))).toEqual(
    records
  )
})

test('binds encrypted payloads to filenames and rejects ciphertext from another keychain', () => {
  const first = fixture()
  first.storage.enable()
  const alpha = path.join(first.signerRoot, 'alpha.json')
  const beta = path.join(first.signerRoot, 'beta.json')
  const alphaBytes = fs.readFileSync(alpha)
  fs.writeFileSync(alpha, fs.readFileSync(beta))
  fs.writeFileSync(beta, alphaBytes)

  expect(() => first.storage.readAllSignerFiles()).toThrow('could not be decrypted')

  fs.writeFileSync(alpha, alphaBytes)
  const secondKey = new FakeSafeStorage()
  const secondStorage = new OsSignerStorage(first.profile, { platform: 'linux', safeStorage: secondKey })
  expect(() => secondStorage.readAllSignerFiles()).toThrow('could not be decrypted')
  expect(() => secondStorage.writeSignerFile('new.json', signerRecord('new'))).toThrow(
    'could not be decrypted'
  )
  expect(fs.existsSync(path.join(first.signerRoot, 'new.json'))).toBe(false)
})

test('protects new writes while enabled and refuses writes during a mixed transition', () => {
  const { signerRoot, storage } = fixture()
  storage.enable()
  const added = signerRecord('added')
  storage.writeSignerFile('added.json', added)
  expect(JSON.parse(fs.readFileSync(path.join(signerRoot, 'added.json'), 'utf8')).format).toBe(
    'wren-os-protected-signer'
  )
  expect(storage.readAllSignerFiles().find(({ name }) => name === 'added.json')?.bytes).toEqual(added)

  fs.writeFileSync(path.join(signerRoot, 'plain.json'), signerRecord('plain'))
  expect(() => storage.writeSignerFile('another.json', signerRecord('another'))).toThrow(
    'Signer protection migration is incomplete'
  )
})

test('rejects invalid signer writes before either storage mode accepts them', () => {
  const { signerRoot, storage } = fixture()

  expect(() => storage.writeSignerFile('invalid.json', Buffer.from('not-json'))).toThrow(
    'Signer file invalid.json is not valid JSON'
  )
  expect(fs.existsSync(path.join(signerRoot, 'invalid.json'))).toBe(false)

  storage.enable()
  expect(() => storage.writeSignerFile('../escape.json', signerRecord('escape'))).toThrow(
    'Signer file is invalid or exceeds the size limit'
  )
  expect(fs.existsSync(path.join(signerRoot, 'escape.json'))).toBe(false)
})

test('does not remove a competing file when an exclusive create loses a race', () => {
  const { signerRoot, storage } = fixture()
  const destination = path.join(signerRoot, 'race.legacy-v1.bak')
  const competing = signerRecord('competing')
  const originalOpen = fs.openSync
  const open = jest.spyOn(fs, 'openSync').mockImplementation((source, flags, mode) => {
    if (source === destination && flags === 'wx') {
      const descriptor = originalOpen(destination, 'wx', mode)
      fs.writeSync(descriptor, competing)
      fs.closeSync(descriptor)
      const error = new Error('synthetic exclusive-create race') as NodeJS.ErrnoException
      error.code = 'EEXIST'
      throw error
    }
    return originalOpen(source, flags, mode)
  })

  try {
    expect(() =>
      storage.writeSignerFile('race.legacy-v1.bak', signerRecord('ours'), { exclusive: true })
    ).toThrow('synthetic exclusive-create race')
    expect(fs.readFileSync(destination)).toEqual(competing)
  } finally {
    open.mockRestore()
  }
})

test('reports macOS as unsupported without invoking safeStorage', () => {
  const safeStorage = new FakeSafeStorage()
  const { storage } = fixture(safeStorage, 'darwin')
  expect(storage.status()).toMatchObject({ available: false, backend: 'unsupported', state: 'unsupported' })
  expect(() => storage.enable()).toThrow('OS-backed signer protection is unsupported on this platform')
  expect(safeStorage.backendCalls).toBe(0)
  expect(safeStorage.encryptCalls).toBe(0)
})

test('bounds the signer set before keychain work', () => {
  const { safeStorage, signerRoot, storage } = fixture()
  for (let index = 0; index < 510; index += 1) {
    fs.writeFileSync(path.join(signerRoot, `extra-${index}.json`), signerRecord(`extra-${index}`))
  }

  expect(() => storage.status()).toThrow('Wren profile contains too many signer files')
  expect(safeStorage.encryptCalls).toBe(0)
})

test('fails closed on a corrupt policy marker and permits an explicit recovery choice', () => {
  const { records, signerRoot, storage } = fixture()
  storage.enable()
  fs.writeFileSync(path.join(signerRoot, '.os-signer-protection.json'), '{"format":"tampered"}')

  expect(storage.status()).toMatchObject({ enabled: true, state: 'recovery-required' })
  expect(() => storage.readAllSignerFiles()).toThrow('Signer protection marker is invalid')

  expect(storage.disable()).toMatchObject({ enabled: false, state: 'disabled' })
  expect(Object.fromEntries(storage.readAllSignerFiles().map(({ name, bytes }) => [name, bytes]))).toEqual(
    records
  )
})
