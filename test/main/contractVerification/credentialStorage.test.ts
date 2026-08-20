import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  createEtherscanApiKeyStore,
  type SafeStorageBackend,
  type SafeStorageLike
} from '../../../main/contractVerification/credentialStorage'

const API_KEY = 'AbCdEf0123456789_etherscan_v2_key'
const STORED_ERROR = 'Explorer API key credential is unavailable or invalid'

class FakeSafeStorage implements SafeStorageLike {
  available = true
  backend: SafeStorageBackend = 'gnome_libsecret'
  backendCalls = 0
  decryptCalls = 0
  encryptCalls = 0
  failDecrypt = false
  failEncrypt = false
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
    if (this.failEncrypt) throw new Error(`injected failure for ${plaintext}`)
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  }

  decryptString(encrypted: Buffer) {
    this.decryptCalls += 1
    if (this.failDecrypt) throw new Error('injected decrypt failure')
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, encrypted.subarray(0, 12))
    decipher.setAuthTag(encrypted.subarray(12, 28))
    return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8')
  }
}

const roots: string[] = []
const consoleSpies: jest.SpyInstance[] = []

beforeEach(() => {
  consoleSpies.push(
    jest.spyOn(console, 'debug').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
    jest.spyOn(console, 'info').mockImplementation(() => {}),
    jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  )
})

afterEach(() => {
  for (const spy of consoleSpies.splice(0)) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

const fixture = (
  safeStorage = new FakeSafeStorage(),
  platform: NodeJS.Platform = 'linux',
  fileSystem: typeof fs = fs
) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-verification-credential-'))
  roots.push(root)
  return {
    root,
    safeStorage,
    store: createEtherscanApiKeyStore(root, { fileSystem, platform, safeStorage })
  }
}

const readWrapper = (credentialPath: string) => JSON.parse(fs.readFileSync(credentialPath, 'utf8'))

const writeWrapper = (credentialPath: string, wrapper: unknown) => {
  fs.writeFileSync(credentialPath, JSON.stringify(wrapper), { mode: 0o600 })
  fs.chmodSync(credentialPath, 0o600)
}

test('stores one Etherscan V2 key as a strict encrypted 0600 wrapper and never reports it in status', () => {
  const { store } = fixture()

  expect(store.status()).toEqual({ available: true, backend: 'secret_service', configured: false })
  expect(store.save(API_KEY)).toEqual({
    available: true,
    backend: 'secret_service',
    configured: true
  })
  expect(store.load()).toBe(API_KEY)
  expect(Object.keys(store.status()).sort()).toEqual(['available', 'backend', 'configured'])

  const stored = fs.readFileSync(store.credentialPath)
  expect(stored.includes(Buffer.from(API_KEY))).toBe(false)
  expect(JSON.parse(stored.toString('utf8'))).toEqual({
    backend: 'secret_service',
    ciphertext: expect.stringMatching(/^[A-Za-z0-9+/]+={0,2}$/u),
    format: 'wren-contract-verification-credential',
    name: 'etherscan-v2-api-key',
    platform: 'linux',
    version: 1
  })
  expect(fs.statSync(store.credentialPath).mode & 0o777).toBe(0o600)
})

test.each(['gnome_libsecret', 'secret_service', 'kwallet', 'kwallet5', 'kwallet6'] as const)(
  'accepts secure Linux backend %s',
  (backend) => {
    const safeStorage = new FakeSafeStorage()
    safeStorage.backend = backend
    const { store } = fixture(safeStorage)

    expect(store.save(API_KEY)).toMatchObject({ available: true, configured: true })
    expect(store.load()).toBe(API_KEY)
    expect(store.status().backend).toBe(backend === 'gnome_libsecret' ? 'secret_service' : backend)
  }
)

test('uses Windows DPAPI without calling the Linux-only backend selector', () => {
  const safeStorage = new FakeSafeStorage()
  safeStorage.backend = 'basic_text'
  const { store } = fixture(safeStorage, 'win32')

  expect(store.status()).toEqual({ available: true, backend: 'windows_dpapi', configured: false })
  expect(store.save(API_KEY)).toEqual({
    available: true,
    backend: 'windows_dpapi',
    configured: true
  })
  expect(store.load()).toBe(API_KEY)
  expect(readWrapper(store.credentialPath)).toMatchObject({
    backend: 'windows_dpapi',
    platform: 'windows'
  })
  expect(safeStorage.backendCalls).toBe(0)
})

test.each(['basic_text', 'unknown', 'windows_dpapi'] as const)(
  'rejects insecure or inapplicable Linux backend %s without writing',
  (backend) => {
    const safeStorage = new FakeSafeStorage()
    safeStorage.backend = backend
    const { store } = fixture(safeStorage)

    expect(store.status()).toEqual({ available: false, backend: 'unsupported', configured: false })
    expect(() => store.save(API_KEY)).toThrow('Secure OS credential storage is unavailable')
    expect(fs.existsSync(store.credentialPath)).toBe(false)
    expect(safeStorage.encryptCalls).toBe(0)
  }
)

test('fails closed when encryption is unavailable', () => {
  const safeStorage = new FakeSafeStorage()
  safeStorage.available = false
  const { store } = fixture(safeStorage)

  expect(store.status()).toEqual({ available: false, backend: 'unsupported', configured: false })
  expect(() => store.save(API_KEY)).toThrow('Secure OS credential storage is unavailable')
  expect(store.load()).toBeUndefined()
  expect(fs.existsSync(store.credentialPath)).toBe(false)
})

test('bounds SafeStorage encryption and decryption failures without persisting plaintext', () => {
  const safeStorage = new FakeSafeStorage()
  const { store } = fixture(safeStorage)
  safeStorage.failEncrypt = true

  expect(() => store.save(API_KEY)).toThrow('Secure OS credential storage is unavailable')
  expect(fs.existsSync(store.credentialPath)).toBe(false)

  safeStorage.failEncrypt = false
  store.save(API_KEY)
  safeStorage.failDecrypt = true
  expect(() => store.load()).toThrow(STORED_ERROR)
})

test('rejects unsupported platforms without touching SafeStorage', () => {
  const safeStorage = new FakeSafeStorage()
  const { store } = fixture(safeStorage, 'darwin')

  expect(store.status()).toEqual({ available: false, backend: 'unsupported', configured: false })
  expect(() => store.save(API_KEY)).toThrow('Secure OS credential storage is unavailable')
  expect(safeStorage.backendCalls).toBe(0)
  expect(safeStorage.encryptCalls).toBe(0)
  expect(safeStorage.decryptCalls).toBe(0)
})

test.each([
  '',
  'short',
  'contains whitespace 123456',
  'contains.period.123456',
  'contains/slash/123456',
  'a'.repeat(129)
])('rejects a malformed API key without persisting it', (apiKey) => {
  const { safeStorage, store } = fixture()

  expect(() => store.save(apiKey)).toThrow('Explorer API key is invalid')
  expect(fs.existsSync(store.credentialPath)).toBe(false)
  expect(safeStorage.encryptCalls).toBe(0)
})

test('atomically replaces the one named key without leaving temporary files', () => {
  const { root, store } = fixture()
  const replacement = 'ReplacementKey_0123456789abcdef'
  store.save(API_KEY)

  expect(store.save(replacement)).toMatchObject({ configured: true })
  expect(store.load()).toBe(replacement)
  expect(fs.readdirSync(root)).toEqual(['.etherscan-v2-api-key.json'])
  expect(fs.readFileSync(store.credentialPath, 'utf8')).not.toContain(API_KEY)
  expect(fs.readFileSync(store.credentialPath, 'utf8')).not.toContain(replacement)
})

test('keeps the existing credential and cleans its temporary file when atomic replacement fails', () => {
  const initial = fixture()
  initial.store.save(API_KEY)
  const original = fs.readFileSync(initial.store.credentialPath)
  const injectedFs = Object.create(fs) as typeof fs
  injectedFs.renameSync = () => {
    throw new Error('injected rename failure')
  }
  const failing = createEtherscanApiKeyStore(initial.root, {
    fileSystem: injectedFs,
    platform: 'linux',
    safeStorage: initial.safeStorage
  })

  expect(() => failing.save('ReplacementKey_0123456789abcdef')).toThrow('Explorer API key could not be saved')
  expect(fs.readFileSync(initial.store.credentialPath)).toEqual(original)
  expect(fs.readdirSync(initial.root)).toEqual(['.etherscan-v2-api-key.json'])
})

test.each([
  ['invalid JSON', () => Buffer.from('{')],
  ['wrong version', (wrapper: Record<string, unknown>) => ({ ...wrapper, version: 2 })],
  ['wrong name', (wrapper: Record<string, unknown>) => ({ ...wrapper, name: 'another-key' })],
  ['wrong platform', (wrapper: Record<string, unknown>) => ({ ...wrapper, platform: 'windows' })],
  ['extra property', (wrapper: Record<string, unknown>) => ({ ...wrapper, apiKey: API_KEY })],
  ['wrong backend', (wrapper: Record<string, unknown>) => ({ ...wrapper, backend: 'basic_text' })],
  ['noncanonical ciphertext', (wrapper: Record<string, unknown>) => ({ ...wrapper, ciphertext: 'AAAA\n' })]
] as const)('rejects a stored wrapper with %s using one bounded error', (_label, mutate) => {
  const { store } = fixture()
  store.save(API_KEY)
  const wrapper = readWrapper(store.credentialPath) as Record<string, unknown>
  const mutated = mutate(wrapper)
  if (Buffer.isBuffer(mutated)) {
    fs.writeFileSync(store.credentialPath, mutated)
    fs.chmodSync(store.credentialPath, 0o600)
  } else {
    writeWrapper(store.credentialPath, mutated)
  }

  expect(() => store.status()).toThrow(STORED_ERROR)
  expect(() => store.load()).toThrow(STORED_ERROR)
  expect(() => store.save('ReplacementKey_0123456789abcdef')).toThrow(STORED_ERROR)
})

test.each([
  ['wrong payload version', { version: 2 }],
  ['wrong payload name', { name: 'another-key' }],
  ['invalid payload key', { apiKey: 'bad key' }],
  ['extra payload property', { unexpected: true }]
] as const)('rejects %s after decryption without exposing its details', (_label, change) => {
  const { safeStorage, store } = fixture()
  store.save(API_KEY)
  const wrapper = readWrapper(store.credentialPath)
  const payload = {
    format: 'wren-contract-verification-credential-payload',
    version: 1,
    name: 'etherscan-v2-api-key',
    apiKey: API_KEY,
    ...change
  }
  wrapper.ciphertext = safeStorage.encryptString(JSON.stringify(payload)).toString('base64')
  writeWrapper(store.credentialPath, wrapper)

  expect(() => store.load()).toThrow(STORED_ERROR)
})

test('rejects ciphertext encrypted under another OS identity with the bounded stored error', () => {
  const first = fixture()
  first.store.save(API_KEY)
  const otherIdentity = createEtherscanApiKeyStore(first.root, {
    fileSystem: fs,
    platform: 'linux',
    safeStorage: new FakeSafeStorage()
  })

  expect(otherIdentity.status()).toEqual({
    available: true,
    backend: 'secret_service',
    configured: true
  })
  expect(() => otherIdentity.load()).toThrow(STORED_ERROR)
})

test('rejects a credential copied across operating systems', () => {
  const { root, safeStorage, store } = fixture()
  store.save(API_KEY)
  const windows = createEtherscanApiKeyStore(root, {
    fileSystem: fs,
    platform: 'win32',
    safeStorage
  })

  expect(() => windows.status()).toThrow(STORED_ERROR)
  expect(() => windows.load()).toThrow(STORED_ERROR)
})

test('rejects symbolic-link credentials and never reads or removes their target', () => {
  const { root, store } = fixture()
  const target = path.join(root, 'outside.json')
  fs.writeFileSync(target, API_KEY, { mode: 0o600 })
  fs.symlinkSync(target, store.credentialPath)

  expect(() => store.status()).toThrow(STORED_ERROR)
  expect(() => store.load()).toThrow(STORED_ERROR)
  expect(() => store.remove()).toThrow(STORED_ERROR)
  expect(fs.readFileSync(target, 'utf8')).toBe(API_KEY)
})

test('opens the credential with the platform no-follow flag', () => {
  const { store } = fixture()
  store.save(API_KEY)
  const openSpy = jest.spyOn(fs, 'openSync')

  try {
    expect(store.load()).toBe(API_KEY)
    const readCall = openSpy.mock.calls.find(
      ([target, flags]) => target === store.credentialPath && typeof flags === 'number'
    )
    expect(readCall).toBeDefined()
    expect((readCall?.[1] as number) & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW)
  } finally {
    openSpy.mockRestore()
  }
})

test('rejects group- or world-accessible credential files on Unix', () => {
  const { store } = fixture()
  store.save(API_KEY)
  fs.chmodSync(store.credentialPath, 0o644)

  expect(() => store.status()).toThrow(STORED_ERROR)
  expect(() => store.load()).toThrow(STORED_ERROR)
  expect(() => store.remove()).toThrow(STORED_ERROR)
})

test('bounds oversized credential files before parsing', () => {
  const { store } = fixture()
  fs.writeFileSync(store.credentialPath, Buffer.alloc(32 * 1024 + 1, 0x61), { mode: 0o600 })

  expect(() => store.status()).toThrow(STORED_ERROR)
  expect(() => store.load()).toThrow(STORED_ERROR)
})

test('removes only the exact encrypted credential and is idempotent', () => {
  const { root, store } = fixture()
  const neighbor = path.join(root, 'keep-me.json')
  fs.writeFileSync(neighbor, 'keep', { mode: 0o600 })
  store.save(API_KEY)

  expect(store.remove()).toEqual({ available: true, backend: 'secret_service', configured: false })
  expect(store.load()).toBeUndefined()
  expect(store.remove()).toEqual({ available: true, backend: 'secret_service', configured: false })
  expect(fs.readFileSync(neighbor, 'utf8')).toBe('keep')
})

test('keeps an unavailable stored credential removable after the secure backend changes', () => {
  const { safeStorage, store } = fixture()
  store.save(API_KEY)
  safeStorage.backend = 'basic_text'
  safeStorage.available = false

  expect(store.status()).toEqual({ available: false, backend: 'unsupported', configured: true })
  expect(store.remove()).toEqual({ available: false, backend: 'unsupported', configured: false })
})
