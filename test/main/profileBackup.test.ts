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
import { migratePersistedConfiguration } from '../../main/profileMigration'
import { OsSignerStorage } from '../../main/signers/hot/storage'
import { FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN, originIdForInvoker } from '../../resources/domain/origin'
import { createAccountPermission } from '../../main/provider/permissions'

const roots: string[] = []
const password = 'correct horse battery staple'

const fakeSafeStorage = () => {
  let available = true
  return {
    decryptString: (encrypted: Buffer) => {
      const value = encrypted.toString('utf8')
      if (!value.startsWith('device:')) throw new Error('wrong device')
      return value.slice('device:'.length)
    },
    encryptString: (plaintext: string) => Buffer.from(`device:${plaintext}`, 'utf8'),
    getSelectedStorageBackend: () => 'gnome_libsecret' as const,
    isEncryptionAvailable: () => available,
    setAvailable: (value: boolean) => {
      available = value
    }
  }
}

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
  fixtureMain.contractVerificationJobs = [
    {
      id: '00000000-0000-4000-8000-000000000009',
      target: {
        address: `0x${'a'.repeat(40)}`,
        chainId: 1,
        runtimeCodeHash: `0x${'b'.repeat(64)}`
      },
      language: 'Solidity',
      compilerVersion: '0.8.28+commit.7893614a',
      contractIdentifier: 'contracts/Private.sol:Private',
      sourceHash: 'a'.repeat(64),
      submissionHash: 'b'.repeat(64),
      status: 'published',
      destinations: [{ destination: 'sourcify', status: 'published' }],
      createdAt: 1,
      updatedAt: 2
    }
  ]
  fixtureMain.outboundAddressMemory = {
    ['a'.repeat(64)]: {
      digest: 'a'.repeat(64),
      prefix: '1234',
      suffix: 'abcd',
      lastSubmittedAt: 1
    }
  }
  fixtureMain.rememberRecentRecipients = true
  fixtureMain.recentRecipientUses = [
    {
      operationId: '00000000-0000-4000-8000-000000000002',
      address: `0x${'e'.repeat(40)}`,
      confirmedAt: 1
    }
  ]
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

const legacyMigrationFixture = () =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'store/migrate/fixtures/v3-pre-cross-chain-state.json'), 'utf8')
  ).state

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
  expect(recoveryMain).not.toHaveProperty('contractVerificationJobs')
  expect(recoveryMain).not.toHaveProperty('outboundAddressMemory')
  expect(recoveryMain).not.toHaveProperty('rememberRecentRecipients')
  expect(recoveryMain).not.toHaveProperty('recentRecipientUses')
  expect(recoveryMain).not.toHaveProperty('yearn')
  expect(recoveryMain).not.toHaveProperty('updater')
  expect(recoveryMain).not.toHaveProperty('extensionCredentials')
  expect(recoveryMain).not.toHaveProperty('desktopAuthIdentity')
  expect(recoveryMain).not.toHaveProperty('nativePeerCredentials')
  expect(recoveryMain).not.toHaveProperty('dapps')
  expect(recoveryMain).not.toHaveProperty('balances')
  expect(configurationText).not.toMatch(
    /transient-request-secret|privateRuntimeObservation|activeRequestId|private-call-history|private-operation-lifecycle|contracts\/Private\.sol|private-workflow|private-provider-evidence|private-notification-data|private-token-cache|private-installed-content|runtime-update-id/
  )
  expect(Buffer.from(payload.files.signers[0].bytes, 'base64').toString('utf8')).toContain(
    'secret-shaped-but-encrypted'
  )
})

it('preserves address-book provenance in encrypted profile recovery data', () => {
  const { profile } = fixture()
  const configPath = path.join(profile, 'config.json')
  const current = migratePersistedConfiguration(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const address = '0x0000000000000000000000000000000000000001'
  current.main.addressBook = {
    [address]: {
      address,
      name: 'Treasury',
      note: 'Operations',
      provenance: {
        status: 'verified-out-of-band',
        verifiedAt: 1_765_843_200_000,
        note: 'Confirmed in person'
      },
      createdAt: 1_765_843_100_000,
      updatedAt: 1_765_843_200_000
    }
  }
  fs.writeFileSync(configPath, JSON.stringify({ main: { __: { [current.main._version]: current } } }))

  const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'))
  const payload = decryptTestPayload(backup, password)
  const configuration = JSON.parse(Buffer.from(payload.files.config, 'base64').toString('utf8'))
  const [version] = Object.keys(configuration.main.__)

  expect(configuration.main.__[version].main.addressBook[address]).toEqual(current.main.addressBook[address])
})

it('excludes recent-recipient history and its opt-in preference from encrypted profile recovery data', () => {
  const { profile } = fixture()
  const configPath = path.join(profile, 'config.json')
  const current = migratePersistedConfiguration(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  current.main.rememberRecentRecipients = true
  current.main.recentRecipientUses = [
    {
      operationId: '00000000-0000-4000-8000-000000000003',
      address: '0x1111111111111111111111111111111111111111',
      confirmedAt: 1_786_752_000_000
    }
  ]
  fs.writeFileSync(configPath, JSON.stringify({ main: { __: { [current.main._version]: current } } }))

  const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'))
  const payload = decryptTestPayload(backup, password)
  const configuration = JSON.parse(Buffer.from(payload.files.config, 'base64').toString('utf8'))
  const [version] = Object.keys(configuration.main.__)
  const recoveryMain = configuration.main.__[version].main

  expect(recoveryMain).not.toHaveProperty('rememberRecentRecipients')
  expect(recoveryMain).not.toHaveProperty('recentRecipientUses')
})

it('excludes managed Wren principals and permissions while retaining unrelated direct origins', () => {
  const { profile } = fixture()
  const configPath = path.join(profile, 'config.json')
  const current = migratePersistedConfiguration(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const account = Object.keys(current.main.accounts)[0] as string
  const chainId = Number(Object.keys(current.main.networks.ethereum)[0])
  const session = { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
  const externalOrigin = 'https://app.example'
  const externalId = originIdForInvoker(externalOrigin, { provenance: 'direct' })
  const managedOrigins = [FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN]

  current.main.origins[externalId] = {
    name: externalOrigin,
    provenance: 'direct',
    sessionOnly: false,
    chain: { id: chainId, type: 'ethereum' },
    session
  }
  current.main.permissions[account] = {
    ...current.main.permissions[account],
    [externalId]: createAccountPermission({
      account,
      chains: [chainId],
      handlerId: externalId,
      origin: externalOrigin,
      now: 1
    })
  }
  managedOrigins.forEach((managedOrigin) => {
    const managedId = originIdForInvoker(managedOrigin, { provenance: 'managed' })
    current.main.origins[managedId] = {
      name: managedOrigin,
      provenance: 'managed',
      sessionOnly: false,
      chain: { id: chainId, type: 'ethereum' },
      session
    }
    current.main.permissions[account][managedId] = createAccountPermission({
      account,
      chains: [chainId],
      handlerId: managedId,
      origin: managedOrigin,
      now: 1
    })
  })
  const forgedDeployId = originIdForInvoker(WREN_DEPLOY_ORIGIN, { provenance: 'managed' })
  current.main.origins[forgedDeployId].name = 'https://forged-managed-id.example'
  current.main.origins[forgedDeployId].provenance = 'direct'
  current.main.permissions[account][forgedDeployId].origin = 'https://forged-managed-id.example'
  fs.writeFileSync(configPath, JSON.stringify({ main: { __: { [current.main._version]: current } } }))

  const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'))
  const payload = decryptTestPayload(backup, password)
  const configuration = JSON.parse(Buffer.from(payload.files.config, 'base64').toString('utf8'))
  const [version] = Object.keys(configuration.main.__)
  const recoveryMain = configuration.main.__[version].main

  expect(recoveryMain.origins).toHaveProperty(externalId)
  expect(recoveryMain.permissions[account]).toHaveProperty(externalId)
  managedOrigins.forEach((managedOrigin) => {
    const managedId = originIdForInvoker(managedOrigin, { provenance: 'managed' })
    expect(recoveryMain.origins).not.toHaveProperty(managedId)
    expect(recoveryMain.permissions[account]).not.toHaveProperty(managedId)
    expect(JSON.stringify(recoveryMain)).not.toContain(managedOrigin)
  })
})

it('backs up only valid guardrails belonging to retained direct principals', () => {
  const { profile } = fixture()
  const configPath = path.join(profile, 'config.json')
  const current = migratePersistedConfiguration(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const account = Object.keys(current.main.accounts)[0] as string
  const chainId = Object.keys(current.main.networks.ethereum)[0] as string
  const chainQuantity = `0x${BigInt(chainId).toString(16)}`
  const directName = 'https://direct.example'
  const directId = originIdForInvoker(directName, { provenance: 'direct' })
  const sessionName = 'Unknown/session'
  const sessionId = originIdForInvoker(sessionName, { provenance: 'direct' })
  const companionName = 'https://companion.example'
  const companionId = originIdForInvoker(companionName, {
    provenance: 'companion',
    sourceId: 'companion-principal'
  })
  const session = { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
  current.main.origins = {
    ...current.main.origins,
    [directId]: {
      name: directName,
      provenance: 'direct',
      sessionOnly: false,
      chain: { id: Number(chainId), type: 'ethereum' },
      session
    },
    [sessionId]: {
      name: sessionName,
      provenance: 'direct',
      sessionOnly: true,
      chain: { id: Number(chainId), type: 'ethereum' },
      session
    },
    [companionId]: {
      name: companionName,
      provenance: 'companion',
      sourceId: 'companion-principal',
      sessionOnly: false,
      chain: { id: Number(chainId), type: 'ethereum' },
      session
    }
  }
  current.main.permissions[account] = {
    ...current.main.permissions[account],
    [directId]: createAccountPermission({
      account,
      chains: [Number(chainId)],
      handlerId: directId,
      origin: directName,
      now: 1
    }),
    [sessionId]: createAccountPermission({
      account,
      chains: [Number(chainId)],
      handlerId: sessionId,
      origin: sessionName,
      now: 1
    }),
    [companionId]: createAccountPermission({
      account,
      chains: [Number(chainId)],
      handlerId: companionId,
      origin: companionName,
      now: 1
    })
  }
  const guardrail = (originId: string) => ({
    version: 1 as const,
    account,
    originId,
    chainId: chainQuantity,
    mode: 'block' as const,
    nativeValueCeiling: '0x1',
    createdAt: 1,
    updatedAt: 1,
    revision: 1
  })
  current.main.dappGuardrails = {
    [account]: {
      [directId]: { [chainQuantity]: guardrail(directId) },
      [sessionId]: { [chainQuantity]: guardrail(sessionId) },
      [companionId]: { [chainQuantity]: guardrail(companionId) }
    }
  }
  fs.writeFileSync(configPath, JSON.stringify({ main: { __: { [current.main._version]: current } } }))

  const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'))
  const payload = decryptTestPayload(backup, password)
  const configuration = JSON.parse(Buffer.from(payload.files.config, 'base64').toString('utf8'))
  const [version] = Object.keys(configuration.main.__)

  expect(configuration.main.__[version].main.dappGuardrails).toEqual({
    [account]: { [directId]: { [chainQuantity]: guardrail(directId) } }
  })
})

it('normalizes a version 3 profile before backup inspection and restore staging', () => {
  const { root, profile } = fixture()
  fs.writeFileSync(
    path.join(profile, 'config.json'),
    JSON.stringify({ main: { __: { 3: legacyMigrationFixture() } } })
  )

  const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'))
  expect(inspectEncryptedProfileBackup(backup, password)).toEqual({
    formatVersion: 1,
    createdAt: '2026-08-12T00:00:00.000Z',
    signerCount: 1
  })

  const payload = decryptTestPayload(backup, password)
  const configuration = JSON.parse(Buffer.from(payload.files.config, 'base64').toString('utf8'))
  const [version] = Object.keys(configuration.main.__)
  const recoveryMain = configuration.main.__[version].main
  expect(Number(version)).toBe(recoveryMain._version)
  expect(recoveryMain._version).toBeGreaterThan(37)
  expect(recoveryMain).not.toHaveProperty('gasPrice')
  expect(recoveryMain).not.toHaveProperty('connection')
  expect(recoveryMain).not.toHaveProperty('addresses')
  expect(recoveryMain.accounts).toHaveProperty('0x000000000000000000000000000000000000dead')

  const backupFile = path.join(root, 'legacy-profile.wrenbackup')
  const target = path.join(root, 'legacy-restored')
  fs.writeFileSync(backupFile, backup)
  fs.cpSync(profile, target, { recursive: true })
  const staged = stageEncryptedProfileRestore(
    backupFile,
    password,
    target,
    new Date('2026-08-12T00:01:00.000Z')
  )
  expect(staged).toMatchObject({
    signerCount: 1,
    relaunchRequired: true
  })
  expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toMatchObject({
    status: 'applied',
    restoreId: staged.restoreId,
    signerCount: 1
  })
  expect(
    migratePersistedConfiguration(JSON.parse(fs.readFileSync(path.join(target, 'config.json'), 'utf8'))).main
      ._version
  ).toBe(recoveryMain._version)
})

it('drops source-bound origins and grants when peer credentials are excluded', () => {
  const { profile } = fixture()
  const configPath = path.join(profile, 'config.json')
  const current = migratePersistedConfiguration(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const account = `0x${'d'.repeat(40)}`
  const sourceOrigin = (name: string, provenance: 'companion' | 'native', sourceId: string) => ({
    chain: { type: 'ethereum', id: 1 },
    name,
    provenance,
    sourceId,
    sessionOnly: false,
    session: { requests: 0, startedAt: 0, lastUpdatedAt: 0 }
  })
  const sourcePermission = (handlerId: string) => ({
    version: 1,
    origin: handlerId,
    provider: true,
    handlerId,
    parentCapability: 'eth_accounts',
    caveats: [
      {
        type: 'wren:permissionScope',
        value: { account, methods: ['eth_accounts'], chains: ['0x1'], expiresAt: 4_102_444_800_000 }
      }
    ],
    grantedAt: 1
  })
  current.main.origins = {
    ...(current.main.origins || {}),
    companionSource: sourceOrigin('https://companion.example', 'companion', 'companion-fingerprint'),
    nativeSource: sourceOrigin('Local app', 'native', 'native-fingerprint')
  }
  current.main.permissions = {
    ...(current.main.permissions || {}),
    [account]: {
      ...(current.main.permissions?.[account] || {}),
      companionSource: sourcePermission('companionSource'),
      nativeSource: sourcePermission('nativeSource')
    }
  }
  fs.writeFileSync(configPath, JSON.stringify({ main: { __: { [current.main._version]: current } } }))

  const payload = decryptTestPayload(createEncryptedProfileBackup(profile, password), password)
  const recovery = JSON.parse(Buffer.from(payload.files.config, 'base64').toString('utf8'))
  const recoveryMain = recovery.main.__[Object.keys(recovery.main.__)[0]].main
  expect(recoveryMain.origins).not.toHaveProperty('companionSource')
  expect(recoveryMain.origins).not.toHaveProperty('nativeSource')
  expect(recoveryMain.permissions[account]).not.toHaveProperty('companionSource')
  expect(recoveryMain.permissions[account]).not.toHaveProperty('nativeSource')
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

it.each(['linux', 'win32'] as const)(
  'exports portable password-encrypted signer records from an OS-protected %s profile',
  (platform) => {
    const { profile, root } = fixture()
    const original = fs.readFileSync(path.join(profile, 'signers', 'seed.json'))
    const keychain = fakeSafeStorage()
    const signerStorage = new OsSignerStorage(profile, { platform, safeStorage: keychain })
    signerStorage.enable()

    const local = fs.readFileSync(path.join(profile, 'signers', 'seed.json'))
    expect(JSON.parse(local.toString('utf8')).format).toBe('wren-os-protected-signer')
    const backup = createEncryptedProfileBackup(profile, password, new Date('2026-08-12T00:00:00.000Z'), {
      readSignerFiles: () => signerStorage.readAllSignerFiles()
    })
    const payload = decryptTestPayload(backup, password)

    expect(payload.files.signers).toHaveLength(1)
    expect(Buffer.from(payload.files.signers[0].bytes, 'base64')).toEqual(original)
    expect(JSON.stringify(payload)).not.toContain('wren-os-protected-signer')
    expect(JSON.stringify(payload)).not.toContain('.os-signer-protection.json')

    const source = path.join(root, 'portable.wrenbackup')
    const target = path.join(root, 'restored')
    fs.writeFileSync(source, backup)
    fs.cpSync(profile, target, { recursive: true })
    stageEncryptedProfileRestore(source, password, target, new Date('2026-08-12T00:01:00.000Z'))
    expect(runPendingProfileRestore(target, new Date('2026-08-12T00:02:00.000Z'))).toMatchObject({
      status: 'applied',
      signerCount: 1
    })
    expect(fs.existsSync(path.join(target, 'signers', '.os-signer-protection.json'))).toBe(false)
    expect(fs.readFileSync(path.join(target, 'signers', 'seed.json'))).toEqual(original)
  }
)

it.each(['linux', 'win32'] as const)(
  'refuses portable export when an enabled %s profile credential store is unavailable',
  (platform) => {
    const { profile } = fixture()
    const keychain = fakeSafeStorage()
    const signerStorage = new OsSignerStorage(profile, { platform, safeStorage: keychain })
    signerStorage.enable()
    keychain.setAvailable(false)

    expect(() =>
      createEncryptedProfileBackup(profile, password, new Date(), {
        readSignerFiles: () => signerStorage.readAllSignerFiles()
      })
    ).toThrow(
      platform === 'linux'
        ? 'secure Linux Secret Service or KWallet backend is unavailable'
        : 'Windows DPAPI encryption is unavailable'
    )
  }
)

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
