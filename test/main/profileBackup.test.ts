import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  createEncryptedProfileBackup,
  readAndInspectEncryptedProfileBackup,
  inspectEncryptedProfileBackup,
  inspectEncryptedProfileBackupFile,
  runPendingProfileRestore,
  stageEncryptedProfileRestore,
  stageInspectedProfileRestore,
  writeEncryptedProfileBackup
} from '../../main/profileBackup'

const roots: string[] = []
const password = 'correct horse battery staple'

afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
})

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-profile-backup-'))
  roots.push(root)
  const profile = path.join(root, 'profile')
  fs.mkdirSync(path.join(profile, 'signers'), { recursive: true })
  const migrationFixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'store/migrate/fixtures/v41-current-state.json'), 'utf8')
  ).state
  fs.writeFileSync(
    path.join(profile, 'config.json'),
    `${JSON.stringify({ main: { __: { 41: migrationFixture } } })}\n`
  )
  const config = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'))
  const fixtureMain = config.main.__[41].main
  fixtureMain.accounts[`0x${'d'.repeat(40)}`] = {
    requests: { pending: { payload: { params: ['transient-request-secret'] } } },
    activeRequestId: 'pending',
    status: 'pending',
    balances: { privateRuntimeObservation: true }
  }
  fixtureMain.balances = { transient: [] }
  fixtureMain.activity = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      account: `0x${'d'.repeat(40)}`,
      origin: 'history.example',
      type: 'transaction',
      outcome: 'confirmed',
      createdAt: 1,
      completedAt: 2,
      transactionHash: `0x${'f'.repeat(64)}`
    }
  ]
  fixtureMain.walletCallBatches = { execution: 'private-call-history' }
  fixtureMain.operationLifecycles = { pending: { evidence: 'private-operation-lifecycle' } }
  fixtureMain.yearn = { catalogCache: { private: true }, workflows: { pending: 'private-workflow' } }
  fixtureMain.updater = { dontRemind: ['runtime-update-id'] }
  fixtureMain.dapps = {
    privateDapp: {
      ens: 'private.eth',
      status: 'ready',
      config: { private: 'private-installed-content' },
      content: 'private-installed-content',
      openWhenReady: false,
      checkStatusRetryCount: 0
    }
  }
  fixtureMain.tokens = {
    custom: [{ address: `0x${'c'.repeat(40)}`, chainId: 1 }],
    known: { cached: 'private-token-cache' }
  }
  config.main.__[41].provider = { events: [{ payload: 'private-provider-evidence' }] }
  config.main.__[41].view = { notifyData: { payload: 'private-notification-data' } }
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config))
  fs.writeFileSync(
    path.join(profile, 'signers', 'seed.json'),
    JSON.stringify({
      id: 'seed',
      addresses: [`0x${'a'.repeat(40)}`],
      type: 'seed',
      encryptedSeed: { version: 2, ciphertext: 'secret-shaped-but-encrypted' }
    })
  )
  return { root, profile }
}

const decryptTestPayload = (backup: Buffer, backupPassword: string) => {
  const envelope = JSON.parse(backup.toString('utf8'))
  const key = crypto.scryptSync(backupPassword, Buffer.from(envelope.kdf.salt, 'base64'), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  })
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'))
  decipher.setAAD(Buffer.from('wren-profile-backup:v1'))
  decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'))
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString(
      'utf8'
    )
  )
}

const encryptTestPayload = (payload: object, backupPassword: string) => {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(backupPassword, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  })
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('wren-profile-backup:v1'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()])
  return Buffer.from(
    JSON.stringify({
      format: 'wren-profile-backup',
      version: 1,
      kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
      ciphertext: ciphertext.toString('base64')
    })
  )
}

const restoreFixture = () => {
  const source = fixture()
  const target = path.join(source.root, 'target')
  fs.cpSync(source.profile, target, { recursive: true })
  const backup = path.join(source.root, 'profile.wrenbackup')
  writeEncryptedProfileBackup(source.profile, backup, password, new Date('2026-08-12T00:00:00.000Z'))
  return { ...source, target, backup }
}

const pendingIntent = (target: string) => {
  const parent = path.dirname(target)
  const name = fs.readdirSync(parent).find((entry) => entry.endsWith('-intent.json'))
  if (!name) throw new Error('Restore intent was not written')
  const file = path.join(parent, name)
  return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) }
}

const simulateInstalledRestore = (target: string, removeIntent: boolean) => {
  const intent = pendingIntent(target)
  const parent = path.dirname(target)
  fs.renameSync(target, path.join(parent, intent.value.previousName))
  fs.renameSync(path.join(parent, intent.value.stageName), target)
  const receipt = {
    schemaVersion: 1,
    restoreId: intent.value.restoreId,
    targetFingerprint: intent.value.targetFingerprint,
    previousName: intent.value.previousName,
    stagedAt: intent.value.stagedAt,
    restoredAt: '2026-08-12T00:01:00.000Z',
    signerCount: intent.value.signerCount,
    files: intent.value.files
  }
  fs.writeFileSync(path.join(target, 'wren-profile-restore.json'), `${JSON.stringify(receipt)}\n`, {
    mode: 0o600
  })
  if (removeIntent) fs.rmSync(intent.file)
  return { ...intent, receipt, previousRoot: path.join(parent, intent.value.previousName) }
}

it('packages sanitized configuration and encrypted signers in an authenticated envelope', () => {
  const { profile } = fixture()
  const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'))

  expect(backup.toString('utf8')).toContain('wren-profile-backup')
  expect(backup.toString('utf8')).not.toMatch(/accounts|secret-shaped|encryptedSeed/)
  expect(inspectEncryptedProfileBackup(backup, password)).toEqual({
    formatVersion: 1,
    createdAt: '2026-08-12T00:00:00.000Z',
    signerCount: 1
  })
  const payload = decryptTestPayload(backup, password)
  expect(payload.files.signers.map(({ name }: { name: string }) => name)).toEqual(['seed.json'])
  const configurationText = Buffer.from(payload.files.config, 'base64').toString('utf8')
  const configuration = JSON.parse(configurationText)
  const [version] = Object.keys(configuration.main.__)
  const recoveryState = configuration.main.__[version]
  const recoveryMain = recoveryState.main
  expect(Object.keys(recoveryState)).toEqual(['main'])
  expect(recoveryMain).toMatchObject({
    accounts: expect.any(Object),
    permissions: expect.any(Object),
    networks: expect.any(Object),
    networksMeta: expect.any(Object),
    tokens: { custom: [{ address: `0x${'c'.repeat(40)}`, chainId: 1 }], known: {} }
  })
  expect(recoveryMain).not.toHaveProperty('activity')
  expect(recoveryMain).not.toHaveProperty('walletCallBatches')
  expect(recoveryMain).not.toHaveProperty('operationLifecycles')
  expect(recoveryMain).not.toHaveProperty('yearn')
  expect(recoveryMain).not.toHaveProperty('updater')
  expect(recoveryMain).not.toHaveProperty('extensionCredentials')
  expect(recoveryMain).not.toHaveProperty('desktopAuthIdentity')
  expect(recoveryMain).not.toHaveProperty('nativePeerCredentials')
  expect(recoveryMain).not.toHaveProperty('dapps')
  expect(recoveryMain).not.toHaveProperty('balances')
  expect(configurationText).not.toMatch(
    /transient-request-secret|privateRuntimeObservation|activeRequestId|private-call-history|private-operation-lifecycle|private-workflow|private-provider-evidence|private-notification-data|private-token-cache|private-installed-content|runtime-update-id/
  )
  expect(Buffer.from(payload.files.signers[0].bytes, 'base64').toString('utf8')).toContain(
    'secret-shaped-but-encrypted'
  )
})

it('rejects wrong passwords and authenticated tampering without creating a profile', () => {
  const { profile, root } = fixture()
  const backup = createEncryptedProfileBackup(profile, password)
  const source = path.join(root, 'backup.wrenbackup')
  const target = path.join(root, 'target')
  fs.cpSync(profile, target, { recursive: true })
  fs.writeFileSync(source, backup)

  expect(() => inspectEncryptedProfileBackup(backup, 'this password is wrong')).toThrow(
    'Invalid Wren profile backup'
  )
  expect(() => stageEncryptedProfileRestore(source, 'this password is wrong', target)).toThrow(
    'Invalid Wren profile backup'
  )
  const envelope = JSON.parse(backup.toString('utf8'))
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`
  expect(() => inspectEncryptedProfileBackup(Buffer.from(JSON.stringify(envelope)), password)).toThrow(
    'Invalid Wren profile backup'
  )
  fs.writeFileSync(source, JSON.stringify(envelope))
  expect(() => stageEncryptedProfileRestore(source, password, target)).toThrow('Invalid Wren profile backup')
  expect(() => pendingIntent(target)).toThrow('Restore intent was not written')
})

it('writes private backup files and restores them through bounded regular-file reads', () => {
  const { root, profile } = fixture()
  const destination = path.join(root, 'profile.wren-backup')

  expect(writeEncryptedProfileBackup(profile, destination, password).bytes).toBeGreaterThan(0)
  expect(readAndInspectEncryptedProfileBackup(destination, password)).toEqual({
    formatVersion: 1,
    createdAt: expect.any(String),
    signerCount: 1
  })
  if (process.platform !== 'win32') expect(fs.statSync(destination).mode & 0o777).toBe(0o600)
})

it('binds restore staging to the exact regular backup file that was inspected', () => {
  const { target, backup } = restoreFixture()
  const binding = inspectEncryptedProfileBackupFile(backup, password)
  const replacement = `${backup}.replacement`
  fs.copyFileSync(backup, replacement)
  fs.renameSync(replacement, backup)

  expect(() => stageInspectedProfileRestore(backup, password, binding, target)).toThrow(
    'The inspected Wren profile backup changed before restore'
  )
  expect(() => pendingIntent(target)).toThrow('Restore intent was not written')

  const currentBinding = inspectEncryptedProfileBackupFile(backup, password)
  expect(stageInspectedProfileRestore(backup, password, currentBinding, target)).toMatchObject({
    signerCount: 1,
    relaunchRequired: true
  })
})

it('rejects symlinked profile and backup files', () => {
  const { root, profile } = fixture()
  const config = path.join(profile, 'config.json')
  fs.renameSync(config, `${config}.target`)
  fs.symlinkSync('config.json.target', config)

  expect(() => createEncryptedProfileBackup(profile, password)).toThrow(
    'Wren configuration is not a regular file'
  )

  fs.rmSync(config)
  fs.renameSync(`${config}.target`, config)
  const backup = path.join(root, 'backup.wrenbackup')
  writeEncryptedProfileBackup(profile, backup, password)
  const link = path.join(root, 'backup-link.wrenbackup')
  fs.symlinkSync(path.basename(backup), link)
  expect(() => readAndInspectEncryptedProfileBackup(link, password)).toThrow(
    'Wren profile backup is not a regular file'
  )
})

it('rejects oversized backup files before reading their contents', () => {
  const { root } = fixture()
  const oversized = path.join(root, 'oversized.wrenbackup')
  fs.closeSync(fs.openSync(oversized, 'w'))
  fs.truncateSync(oversized, 96 * 1024 * 1024 + 1)

  expect(() => readAndInspectEncryptedProfileBackup(oversized, password)).toThrow(
    'Wren profile backup is not a regular bounded file'
  )
})

it('rejects a validly encrypted backup from a future state version before staging', () => {
  const { target, backup } = restoreFixture()
  const payload = decryptTestPayload(fs.readFileSync(backup), password)
  payload.files.config = Buffer.from(
    JSON.stringify({ main: { __: { 999: { main: { _version: 999 } } } } })
  ).toString('base64')
  fs.writeFileSync(backup, encryptTestPayload(payload, password))

  expect(() => stageEncryptedProfileRestore(backup, password, target)).toThrow(
    'Frame profile version 999 is newer than Wren supports'
  )
  expect(() => pendingIntent(target)).toThrow('Restore intent was not written')
})

it('stages and atomically replaces a profile only during the early bootstrap', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'existing-only'), 'old profile')

  const staged = stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:01:00.000Z'))
  expect(staged).toMatchObject({ signerCount: 1, relaunchRequired: true })
  expect(fs.readFileSync(path.join(target, 'existing-only'), 'utf8')).toBe('old profile')

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toEqual({
    status: 'applied',
    restoreId: staged.restoreId,
    signerCount: 1,
    restoredAt: '2026-08-12T00:02:00.000Z'
  })
  expect(fs.existsSync(path.join(target, 'existing-only'))).toBe(false)
  expect(fs.readFileSync(path.join(target, 'config.json'), 'utf8')).toContain('accounts')
  expect(fs.readFileSync(path.join(target, 'signers', 'seed.json'), 'utf8')).toContain(
    'secret-shaped-but-encrypted'
  )
  expect(JSON.parse(fs.readFileSync(path.join(target, 'wren-profile-restore.json'), 'utf8'))).toMatchObject({
    schemaVersion: 1,
    restoreId: staged.restoreId,
    signerCount: 1
  })
  expect(runPendingProfileRestore(target)).toEqual({ status: 'not-requested' })
})

it('cancels stale restore intent and preserves the current profile', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'keep'), 'old profile')
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:11:00.000Z'))).toEqual({
    status: 'canceled',
    reason: 'expired'
  })
  expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('old profile')
  expect(pendingIntent.bind(null, target)).toThrow('Restore intent was not written')
})

it('restores a displaced profile when an interrupted intent expires', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'keep'), 'old profile')
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const { value } = pendingIntent(target)
  const previousRoot = path.join(path.dirname(target), value.previousName)
  fs.renameSync(target, previousRoot)

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:11:00.000Z'))).toEqual({
    status: 'canceled',
    reason: 'expired'
  })
  expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('old profile')
  expect(fs.existsSync(previousRoot)).toBe(false)
  expect(fs.existsSync(path.join(path.dirname(target), value.stageName))).toBe(false)
})

it('rejects a future-dated intent and removes interrupted staging without touching the profile', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'keep'), 'old profile')
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T01:00:00.000Z'))
  const intent = pendingIntent(target)
  fs.rmSync(path.join(path.dirname(target), intent.value.stageName, 'config.json'))

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:00:00.000Z'))).toEqual({
    status: 'canceled',
    reason: 'invalid'
  })
  expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('old profile')
  expect(fs.existsSync(path.join(path.dirname(target), intent.value.stageName))).toBe(false)
})

it('rolls back the original profile when the staged install rename fails', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'keep'), 'old profile')
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const { value } = pendingIntent(target)
  const stageRoot = path.join(path.dirname(target), value.stageName)
  const originalRename = fs.renameSync
  const rename = jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (source === stageRoot && destination === target) throw new Error('synthetic swap failure')
    return originalRename(source, destination)
  })
  try {
    expect(runPendingProfileRestore(target, new Date('2026-08-12T00:01:00.000Z'))).toEqual({
      status: 'canceled',
      reason: 'failed'
    })
  } finally {
    rename.mockRestore()
  }
  expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('old profile')
  expect(() => pendingIntent(target)).toThrow('Restore intent was not written')
})

it('cancels a corrupted interrupted stage and preserves the original profile', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'keep'), 'old profile')
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const { value } = pendingIntent(target)
  fs.writeFileSync(path.join(path.dirname(target), value.stageName, 'config.json'), 'interrupted')

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:01:00.000Z'))).toEqual({
    status: 'canceled',
    reason: 'failed'
  })
  expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('old profile')
})

it('recovers an interrupted swap after the current profile was displaced', () => {
  const { target, backup } = restoreFixture()
  fs.writeFileSync(path.join(target, 'keep'), 'old profile')
  const staged = stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const { value } = pendingIntent(target)
  fs.renameSync(target, path.join(path.dirname(target), value.previousName))

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:01:00.000Z'))).toMatchObject({
    status: 'applied',
    restoreId: staged.restoreId
  })
  expect(fs.existsSync(path.join(target, 'keep'))).toBe(false)
  expect(fs.existsSync(path.join(target, 'config.json'))).toBe(true)
})

it('finalizes cleanup after a crash following receipt creation', () => {
  const { target, backup } = restoreFixture()
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const crash = simulateInstalledRestore(target, false)

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toEqual({
    status: 'applied',
    restoreId: crash.receipt.restoreId,
    signerCount: 1,
    restoredAt: '2026-08-12T00:01:00.000Z'
  })
  expect(fs.existsSync(crash.file)).toBe(false)
  expect(fs.existsSync(crash.previousRoot)).toBe(false)
})

it('cleans the displaced profile after a crash following intent deletion', () => {
  const { target, backup } = restoreFixture()
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const crash = simulateInstalledRestore(target, true)

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toEqual({
    status: 'not-requested'
  })
  expect(fs.existsSync(crash.previousRoot)).toBe(false)
  expect(fs.existsSync(path.join(target, 'config.json'))).toBe(true)
})

it('never deletes the only recoverable previous profile for an invalid receipt', () => {
  const { target, backup } = restoreFixture()
  stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const crash = simulateInstalledRestore(target, true)
  const receiptPath = path.join(target, 'wren-profile-restore.json')
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  receipt.files[0].sha256 = '0'.repeat(64)
  fs.writeFileSync(receiptPath, JSON.stringify(receipt))

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toEqual({
    status: 'not-requested'
  })
  expect(fs.existsSync(crash.previousRoot)).toBe(true)
})

it('keeps the committed restored profile when previous-profile cleanup is interrupted', () => {
  const { target, backup } = restoreFixture()
  const staged = stageEncryptedProfileRestore(backup, password, target, new Date('2026-08-12T00:00:00.000Z'))
  const { value } = pendingIntent(target)
  const previousRoot = path.join(path.dirname(target), value.previousName)
  const originalRemove = fs.rmSync
  const remove = jest.spyOn(fs, 'rmSync').mockImplementation((destination, options) => {
    if (destination === previousRoot) throw new Error('synthetic cleanup interruption')
    return originalRemove(destination, options)
  })
  try {
    expect(runPendingProfileRestore(target, new Date('2026-08-12T00:01:00.000Z'))).toMatchObject({
      status: 'applied',
      restoreId: staged.restoreId
    })
  } finally {
    remove.mockRestore()
  }
  expect(fs.existsSync(path.join(target, 'config.json'))).toBe(true)
  expect(fs.existsSync(previousRoot)).toBe(true)

  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toEqual({
    status: 'not-requested'
  })
  expect(fs.existsSync(previousRoot)).toBe(false)
})
