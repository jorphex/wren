import fs from 'fs'
import os from 'os'
import path from 'path'

import migrations from '../../../../main/store/migrate'
import { assertSafeMigrationFixture } from './fixtureValidation'

let mockPersistedMain

jest.mock('../../../../main/store/persist', () => ({
  get: (key) => (key === 'main' ? mockPersistedMain : undefined)
}))
jest.mock('electron-log', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}))

const fixtureDirectory = path.join(__dirname, 'fixtures')
const fixtureFiles = fs
  .readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort()
const fixtureAccount = '0x000000000000000000000000000000000000dead'

const clone = (value) => JSON.parse(JSON.stringify(value))
const loadFixture = (filename) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, filename), 'utf8'))
  return assertSafeMigrationFixture(fixture, filename)
}

const writePersistedVersion = (directory, state) => {
  const configPath = path.join(directory, 'config.json')
  const envelope = { main: { __: { [state.main._version]: state } } }

  fs.writeFileSync(configPath, JSON.stringify(envelope), { mode: 0o600 })
  return configPath
}

const loadApplicationState = async (configPath) => {
  mockPersistedMain = JSON.parse(fs.readFileSync(configPath, 'utf8')).main
  jest.resetModules()

  const { default: log } = await import('electron-log')
  const { default: createState } = await import('../../../../main/store/state')
  log.error.mockClear()
  log.warn.mockClear()

  const state = createState()
  const diagnostics = [...log.error.mock.calls, ...log.warn.mock.calls]

  if (diagnostics.length) {
    throw new Error(`State initialization logged diagnostics: ${JSON.stringify(diagnostics)}`)
  }

  return state
}

const migrateTemporaryProfile = async (fixture) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-migration-'))

  try {
    const sourcePath = writePersistedVersion(directory, clone(fixture.state))
    const migrated = await loadApplicationState(sourcePath)
    const migratedPath = writePersistedVersion(directory, { main: migrated.main })
    const reloaded = await loadApplicationState(migratedPath)
    const mode = fs.statSync(migratedPath).mode & 0o777

    return { migrated, mode, reloaded }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

beforeAll(() => {
  jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
})

afterAll(() => {
  Date.now.mockRestore()
})

it.each(fixtureFiles)('validates sanitized migration fixture %s', (filename) => {
  expect(() => loadFixture(filename)).not.toThrow()
})

it('rejects secret-shaped and malformed fixtures', () => {
  const fixture = loadFixture('v41-current-state.json')

  expect(() =>
    assertSafeMigrationFixture({
      ...clone(fixture),
      state: { main: { ...clone(fixture.state.main), privateKey: `0x${'1'.repeat(64)}` } }
    })
  ).toThrow('Forbidden secret-shaped key')

  expect(() =>
    assertSafeMigrationFixture({
      ...clone(fixture),
      state: { main: { ...clone(fixture.state.main), encryptedSeed: 'synthetic-value' } }
    })
  ).toThrow('Forbidden secret-shaped key')

  expect(() =>
    assertSafeMigrationFixture({
      ...clone(fixture),
      state: { main: { ...clone(fixture.state.main), unsafeValue: `0x${'1'.repeat(64)}` } }
    })
  ).toThrow('Raw private-key-shaped value')

  expect(() =>
    assertSafeMigrationFixture({
      ...clone(fixture),
      metadata: { ...fixture.metadata, sourceVersion: 40 }
    })
  ).toThrow('source version must match')

  expect(() =>
    assertSafeMigrationFixture({
      ...clone(fixture),
      metadata: { ...fixture.metadata, sourceVersion: migrations.latest + 1 },
      state: { main: { ...clone(fixture.state.main), _version: migrations.latest + 1 } }
    })
  ).toThrow('newer than the latest known migration')
})

it('migrates a representative version 12 profile through application state initialization', async () => {
  const fixture = loadFixture('v12-wallet-state.json')
  const preserved = {
    account: clone(fixture.state.main.accounts[fixtureAccount]),
    permission: clone(fixture.state.main.permissions[fixtureAccount])
  }
  const { migrated, mode, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.accounts[fixtureAccount]).toMatchObject(preserved.account)
  expect(migrated.main.accounts[fixtureAccount]).toMatchObject({
    lastSignerType: 'trezor',
    signer: 'fixture-safe7'
  })
  expect(migrated.main.permissions[fixtureAccount]).toEqual(preserved.permission)
  expect(Object.values(migrated.main.accountsMeta)).toContainEqual({
    name: 'Fixture Hardware Account',
    lastUpdated: 1700000000000
  })
  expect(migrated.main.shortcuts.summon).toEqual({
    modifierKeys: ['Alt'],
    shortcutKey: 'Slash',
    enabled: true,
    configuring: false
  })
  expect(migrated.main.tokens).toEqual({ custom: [], known: {} })
  expect(migrated.main.networks.ethereum[1].connection.endpoints[0]).toMatchObject({
    id: 'rpc-1',
    current: 'custom',
    custom: ''
  })
  expect(migrated.main.networks.ethereum[5].connection.endpoints[0]).toMatchObject({
    id: 'rpc-1',
    on: false,
    status: 'off',
    current: 'custom',
    custom: ''
  })
  expect(migrated.main.networks.ethereum[100].connection.endpoints[0]).toMatchObject({
    id: 'rpc-1',
    current: 'custom',
    custom: 'https://rpc.gnosischain.com'
  })
  expect(Object.keys(migrated.main.networks.ethereum)).toEqual(
    expect.arrayContaining(['8453', '84532', '11155420'])
  )
  expect(mode).toBe(0o600)
  expect(reloaded.main).toEqual(migrated.main)
  expect(migrations.apply(clone(migrated))).toEqual(migrated)
})

it('migrates the version 37 network boundary without losing custom state', async () => {
  const fixture = loadFixture('v37-network-state.json')
  const customChain = clone(fixture.state.main.networks.ethereum[31337])
  const { connection: customConnection, ...customChainIdentity } = customChain
  const permission = clone(fixture.state.main.permissions[fixtureAccount])
  const { migrated, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main.networks.ethereum[31337]).toMatchObject(customChainIdentity)
  expect(migrated.main.networks.ethereum[31337].connection.endpoints).toEqual([
    expect.objectContaining({ ...customConnection.primary, id: 'rpc-1' }),
    expect.objectContaining({ ...customConnection.secondary, id: 'rpc-2' })
  ])
  expect(migrated.main.accounts[fixtureAccount]).toMatchObject({
    lastSignerType: 'trezor',
    signer: 'fixture-safe7'
  })
  expect(migrated.main.permissions[fixtureAccount]).toEqual(permission)
  expect(migrated.main.networks.ethereum[84531].connection.endpoints[0]).toMatchObject({
    id: 'rpc-1',
    on: false,
    current: 'custom',
    custom: ''
  })
  expect(Object.keys(migrated.main.networks.ethereum)).toEqual(
    expect.arrayContaining(['8453', '84532', '11155420'])
  )
  expect(reloaded.main).toEqual(migrated.main)
  expect(migrations.apply(clone(migrated))).toEqual(migrated)
})

it('migrates the version 41 boundary and reloads it without another migration', async () => {
  const fixture = loadFixture('v41-current-state.json')
  const { migrated, reloaded } = await migrateTemporaryProfile(fixture)
  const expected = clone(fixture.state.main)
  const { networks: expectedNetworks, instanceId: _legacyInstanceId, ...expectedMain } = expected
  const expectedChain = expectedNetworks.ethereum[31337]
  const { connection: expectedConnection, ...expectedChainIdentity } = expectedChain

  expect(migrated.main).toMatchObject({
    ...expectedMain,
    _version: migrations.latest,
    walletCallBatches: {}
  })
  expect(migrated.main.networks.ethereum[31337]).toMatchObject(expectedChainIdentity)
  expect(migrated.main.networks.ethereum[31337].connection.endpoints).toEqual([
    expect.objectContaining({ ...expectedConnection.primary, id: 'rpc-1' }),
    expect.objectContaining({ ...expectedConnection.secondary, id: 'rpc-2' })
  ])
  expect(migrated.main.instanceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
  expect(migrated.main._version).toBe(migrations.latest)
  expect(reloaded.main).toEqual(migrated.main)
})

it('migrates version 52 Pylon presets through application state initialization', async () => {
  const fixture = loadFixture('v52-pylon-network-state.json')
  const { migrated, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main.networks.ethereum[1].connection.endpoints).toEqual([
    expect.objectContaining({
      id: 'rpc-1',
      current: 'publicnode',
      custom: 'https://dormant.example/mainnet'
    }),
    expect.objectContaining({
      id: 'rpc-2',
      current: 'custom',
      custom: 'wss://private.example/mainnet'
    })
  ])
  expect(migrated.main.networks.ethereum[5].connection.endpoints[0]).toMatchObject({
    id: 'rpc-1',
    on: false,
    status: 'off',
    current: 'custom',
    custom: ''
  })
  expect(migrated.main.networks.ethereum[1].icon).toBe('')
  expect(migrated.main.networksMeta.ethereum[1]).toMatchObject({
    icon: '',
    nativeCurrency: { icon: '' }
  })
  expect(migrated.main.networksMeta.ethereum[5]).toMatchObject({
    icon: 'https://icons.example/goerli.svg',
    nativeCurrency: { icon: 'https://icons.example/goerli-native.svg' }
  })
  expect(migrated.main.mute.migrateToPylon).toBe(false)
  expect(JSON.stringify(migrated)).not.toContain('pylon.link')
  expect(reloaded.main).toEqual(migrated.main)
})

it('recovers a persisted dapp missing lifecycle fields', async () => {
  const fixture = loadFixture('v41-current-state.json')
  const dappId = 'fixture-dapp'
  fixture.state.main.dapps = {
    [dappId]: { ens: 'example.eth', status: 'loading', config: {} }
  }

  const { migrated, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main.dapps[dappId]).toMatchObject({
    ens: 'example.eth',
    status: 'loading',
    openWhenReady: false,
    checkStatusRetryCount: 0
  })
  expect(reloaded.main.dapps[dappId]).toEqual(migrated.main.dapps[dappId])
})

it('rejects a newer persisted snapshot instead of loading an older fallback', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-future-state-'))
  const fixture = loadFixture('v41-current-state.json')
  const configPath = path.join(directory, 'config.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      main: {
        __: {
          [fixture.state.main._version]: fixture.state,
          [migrations.latest + 1]: { main: { _version: migrations.latest + 1 } }
        }
      }
    })
  )

  try {
    await expect(loadApplicationState(configPath)).rejects.toThrow(
      `Saved state version ${migrations.latest + 1} is newer than Wren supports`
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
