import fs from 'fs'
import os from 'os'
import path from 'path'

import migrations from '../../../../main/store/migrate'
import { assertSafeMigrationFixture } from './fixtureValidation'
import {
  FRAME_SEND_ORIGIN,
  WREN_EXTENSION_ORIGIN,
  originIdForName
} from '../../../../resources/domain/origin'

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
    const reloadedPath = writePersistedVersion(directory, { main: reloaded.main })
    const secondReload = await loadApplicationState(reloadedPath)
    const mode = fs.statSync(migratedPath).mode & 0o777

    return { migrated, mode, reloaded, secondReload }
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
    account: clone(fixture.state.main.accounts[fixtureAccount])
  }
  const { migrated, mode, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.accounts[fixtureAccount]).toMatchObject(preserved.account)
  expect(migrated.main.accounts[fixtureAccount]).toMatchObject({
    lastSignerType: 'trezor',
    signer: 'fixture-safe7'
  })
  expect(migrated.main.permissions).toEqual({})
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

it('migrates a representative version 3 profile across raw and application boundaries', async () => {
  const fixture = loadFixture('v3-pre-cross-chain-state.json')
  const address = fixtureAccount

  const afterFour = migrations.apply(clone(fixture.state), 4)
  expect(afterFour.main.networks.ethereum[1]).toMatchObject({
    symbol: 'ETH',
    gas: { price: { selected: 'standard', levels: { custom: '0x2a' } } },
    connection: {
      primary: { on: true, current: 'local', custom: 'http://127.0.0.1:8545' },
      secondary: { on: false, current: 'custom' }
    }
  })
  expect(afterFour.main).not.toHaveProperty('gasPrice')
  expect(afterFour.main).not.toHaveProperty('connection')

  const afterSeven = migrations.apply(clone(fixture.state), 7)
  expect(afterSeven.main.accounts[address]).toMatchObject({
    id: address,
    address,
    name: 'Fixture Early Hardware Account',
    lastSignerType: 'trezor',
    tokens: { 'fixture-token': true }
  })
  expect(afterSeven.main).not.toHaveProperty('addresses')

  const afterTwelve = migrations.apply(clone(fixture.state), 12)
  expect(afterTwelve.main.accounts[address].created).toBe('256:1700000000000')
  const afterThirtySeven = migrations.apply(clone(fixture.state), 37)
  expect(afterThirtySeven.main.shortcuts.summon).toEqual({
    modifierKeys: ['Alt'],
    shortcutKey: 'Slash',
    enabled: true,
    configuring: false
  })

  const { migrated, mode, reloaded, secondReload } = await migrateTemporaryProfile(fixture)
  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.accounts[address]).toMatchObject({
    id: address,
    address,
    lastSignerType: 'trezor',
    created: '256:1700000000000'
  })
  expect(Object.values(migrated.main.accountsMeta)).toContainEqual({
    name: 'Fixture Early Hardware Account',
    lastUpdated: 1700000000000
  })
  expect(migrated.main.ledger.derivation).toBe('testnet')
  expect(migrated.main.trezor.derivation).toBe('testnet')
  expect(migrated.main.networks.ethereum[1].connection.endpoints[0]).toMatchObject({
    current: 'local',
    custom: 'http://127.0.0.1:8545'
  })
  expect(migrated.main.permissions).toEqual({})
  expect(mode).toBe(0o600)
  expect(migrated.main.backup).toMatchObject({
    accounts: expect.any(Object),
    addresses: expect.any(Object)
  })
  expect(reloaded.main).not.toHaveProperty('backup')
  expect(secondReload.main).toEqual(reloaded.main)
  expect(migrations.apply(clone(migrated))).toEqual(migrated)
})

it('migrates the version 37 network boundary without losing custom state', async () => {
  const fixture = loadFixture('v37-network-state.json')
  const customChain = clone(fixture.state.main.networks.ethereum[31337])
  const { connection: customConnection, ...customChainIdentity } = customChain
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
  expect(migrated.main.permissions).toEqual({})
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
  const {
    networks: expectedNetworks,
    networksMeta: _legacyNetworksMeta,
    instanceId: _legacyInstanceId,
    ...expectedMain
  } = expected
  const expectedChain = expectedNetworks.ethereum[31337]
  const { connection: expectedConnection, ...expectedChainIdentity } = expectedChain

  expect(migrated.main).toMatchObject({
    ...expectedMain,
    permissions: {},
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

it('migrates the published version 68 release boundary through migrations 69 to 73', async () => {
  const fixture = loadFixture('v68-release-boundary-state.json')
  const source = clone(fixture.state)
  const accountId = '0x000000000000000000000000000000000000dead'
  const sendId = originIdForName(FRAME_SEND_ORIGIN)
  const extensionId = originIdForName(WREN_EXTENSION_ORIGIN)

  const after69 = migrations.apply(clone(source), 69)
  expect(after69.main._version).toBe(69)
  expect(after69.main.networks.ethereum[1].name).toBe('Ethereum')
  expect(after69.main.networksMeta).toEqual(source.main.networksMeta)
  expect(after69.main.accounts).toEqual(source.main.accounts)
  expect(after69.main.addressBook).toEqual(source.main.addressBook)

  const after70 = migrations.apply(clone(after69), 70)
  expect(after70.main._version).toBe(70)
  expect(after70.main.networksMeta.ethereum[1].nativeCurrency.usd).toEqual({
    price: 2345.67,
    change24hr: -1.25
  })

  const after71 = migrations.apply(clone(after70), 71)
  expect(after71.main._version).toBe(71)
  expect(after71.main.networksMeta.ethereum[1]).toMatchObject({
    blockHeight: 12345678,
    primaryColor: 'accent1',
    nativeCurrency: {
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      usd: { price: 2345.67, change24hr: -1.25 }
    }
  })

  const after72 = migrations.apply(clone(after71), 72)
  expect(after72.main._version).toBe(72)
  expect(after72.main.origins[sendId]).toBeUndefined()
  expect(after72.main.origins[extensionId]).toMatchObject({ provenance: 'legacy' })
  expect(after72.main.origins['fixture-direct-origin']).toEqual(source.main.origins['fixture-direct-origin'])

  const rawMigrated = migrations.apply(clone(after72), 73)
  expect(rawMigrated.main).toMatchObject({
    _version: migrations.latest,
    accounts: { [accountId]: source.main.accounts[accountId] },
    addressBook: source.main.addressBook,
    networks: { ethereum: { 1: { name: 'Ethereum' } } },
    networksMeta: {
      ethereum: {
        1: {
          blockHeight: 12345678,
          nativeCurrency: { usd: { price: 2345.67, change24hr: -1.25 } }
        }
      }
    },
    origins: {
      [extensionId]: expect.objectContaining({ name: WREN_EXTENSION_ORIGIN, provenance: 'internal' }),
      'fixture-direct-origin': source.main.origins['fixture-direct-origin']
    }
  })
  expect(rawMigrated.main.origins[sendId]).toBeUndefined()
  expect(migrations.apply(clone(rawMigrated))).toEqual(rawMigrated)

  const { migrated, mode, reloaded, secondReload } = await migrateTemporaryProfile(fixture)
  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.networks.ethereum[1].name).toBe('Ethereum')
  expect(migrated.main.networksMeta.ethereum[1]).toMatchObject({
    blockHeight: 12345678,
    nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18, usd: { price: 0, change24hr: 0 } }
  })
  expect(migrated.main.accounts[accountId]).toMatchObject(source.main.accounts[accountId])
  expect(migrated.main.addressBook).toEqual(source.main.addressBook)
  expect(migrated.main.origins[sendId]).toBeUndefined()
  expect(migrated.main.origins[extensionId]).toMatchObject({ provenance: 'internal' })
  expect(migrated.main.origins['fixture-direct-origin']).toMatchObject(
    source.main.origins['fixture-direct-origin']
  )
  expect(mode).toBe(0o600)
  expect(reloaded.main).toEqual(migrated.main)
  expect(secondReload.main).toEqual(reloaded.main)
})

it('migrates a previous safe profile and keeps it reload-stable', async () => {
  const fixture = loadFixture('v69-safe-current-state.json')
  const source = clone(fixture.state)

  expect(migrations.apply(clone(source))).toMatchObject({
    ...source,
    main: { ...source.main, _version: migrations.latest }
  })

  const { migrated, mode, reloaded } = await migrateTemporaryProfile(fixture)
  expect(migrated.main).toMatchObject({ ...source.main, _version: migrations.latest })
  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.instanceId).toBe(source.main.instanceId)
  expect(migrated.main.networks.ethereum[31337]).toMatchObject(source.main.networks.ethereum[31337])
  expect(migrated.main.accounts[fixtureAccount]).toMatchObject(source.main.accounts[fixtureAccount])
  expect(migrated.main.addressBook).toEqual(source.main.addressBook)
  expect(migrated.main.dappGuardrails).toEqual(source.main.dappGuardrails)
  expect(migrated.main.rememberRecentRecipients).toBe(true)
  expect(migrated.main.recentRecipientUses).toEqual(source.main.recentRecipientUses)
  expect(mode).toBe(0o600)
  expect(reloaded.main).toEqual(migrated.main)
})

it('recovers a current profile containing custom-network metadata without a USD rate', async () => {
  const fixture = loadFixture('v69-safe-current-state.json')
  fixture.state.main.networks.ethereum[4153] = {
    ...clone(fixture.state.main.networks.ethereum[31337]),
    id: 4153,
    name: 'Fixture Custom Chain'
  }
  fixture.state.main.networksMeta.ethereum[4153] = {
    ...clone(fixture.state.main.networksMeta.ethereum[31337]),
    nativeCurrency: {
      symbol: 'ETH',
      icon: '',
      name: 'Ether',
      decimals: 18
    }
  }

  const { migrated, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main.networksMeta.ethereum[4153].nativeCurrency).toEqual({
    symbol: 'ETH',
    icon: '',
    name: 'Ether',
    decimals: 18,
    usd: { price: 0, change24hr: 0 }
  })
  expect(reloaded.main).toEqual(migrated.main)
})

it('loads a valid profile when Ethereum metadata is missing or malformed', async () => {
  const fixture = loadFixture('v69-safe-current-state.json')
  fixture.state.main.networks.ethereum[4153] = {
    ...clone(fixture.state.main.networks.ethereum[31337]),
    id: 4153,
    name: 'Fixture Repaired Chain'
  }
  fixture.state.main.networksMeta.ethereum[31337] = null
  fixture.state.main.networksMeta.ethereum[4153] = {
    nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 'invalid' }
  }
  fixture.state.main.networksMeta.ethereum[999999] = { nativeCurrency: { symbol: 'ORPHAN' } }

  const { migrated, reloaded } = await migrateTemporaryProfile(fixture)

  expect(migrated.main.networksMeta.ethereum[31337]).toMatchObject({
    nativeCurrency: { symbol: 'ETH', decimals: 18, usd: { price: 0, change24hr: 0 } }
  })
  expect(migrated.main.networksMeta.ethereum[4153]).toMatchObject({
    nativeCurrency: { symbol: 'ETH', name: 'Ether', decimals: 18, usd: { price: 0, change24hr: 0 } }
  })
  expect(migrated.main.networksMeta.ethereum[999999]).toBeUndefined()
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
