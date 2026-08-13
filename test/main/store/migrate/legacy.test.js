import log from 'electron-log'

import migrations from '../../../../main/store/migrate'
import { createState, initChainState } from './setup'

const clone = (value) => structuredClone(value)

beforeAll(() => {
  log.transports.console.level = false
})

afterAll(() => {
  log.transports.console.level = 'debug'
})

describe('legacy migrations 4–12', () => {
  it('migrates legacy gas, partial connection, symbol, and lock settings without losing a usable branch', () => {
    const state = createState(3)
    initChainState(state, 1)
    initChainState(state, 100)
    state.main.networks.ethereum[1] = {
      id: 1,
      symbol: 'Ξ',
      gas: { price: { selected: 'custom', lastLevel: 'fast', levels: { custom: '' } } },
      connection: {
        primary: { on: false, current: 'custom', custom: '' },
        secondary: { on: false, current: 'custom', custom: '' }
      }
    }
    state.main.networks.ethereum[100] = {
      id: 100,
      gas: { price: { selected: 'standard', levels: {} } },
      connection: {
        primary: { on: false, current: 'custom', custom: '' },
        secondary: { on: false, current: 'custom', custom: '' }
      }
    }
    state.main.gasPrice = {
      1: { default: 'normal', levels: { custom: '0x2a' } }
    }
    state.main.connection = {
      network: 1,
      local: {
        on: true,
        settings: { 1: { options: { custom: 'http://127.0.0.1:8545' }, current: 'direct' } }
      }
    }
    state.main.currentNetwork = { id: 5 }

    const migrated = migrations.apply(state, 4).main

    expect(migrated.networks.ethereum[1]).toMatchObject({
      symbol: 'ETH',
      gas: { price: { selected: 'standard', levels: { custom: '0x2a' } } },
      connection: {
        primary: { on: true, current: 'local', custom: 'http://127.0.0.1:8545' }
      }
    })
    // Preserve the exact old JavaScript outcome: Object.keys supplied a string,
    // so its numeric chain-100 branch was unreachable.
    expect(migrated.networks.ethereum[100].symbol).toBe('ETH')
    expect(migrated.currentNetwork.id).toBe(1)
    expect(migrated.accountCloseLock).toBe(true)

    const withoutMute = createState(3)
    delete withoutMute.main.mute
    expect(migrations.apply(withoutMute, 4).main).not.toHaveProperty('accountCloseLock')
  })

  it('preserves the legacy Polygon and Optimism overwrite behavior', () => {
    const state = createState(4)
    state.main.networks.ethereum[137] = { id: 137, name: 'Custom Polygon' }
    const polygon = migrations.apply(clone(state), 5).main.networks.ethereum[137]
    expect(polygon).toMatchObject({ id: 137, name: 'Polygon', connection: { primary: { current: 'matic' } } })

    state.main._version = 9
    state.main.networks.ethereum[10] = { id: 10, name: 'Custom Optimism' }
    const optimism = migrations.apply(state, 10).main.networks.ethereum[10]
    expect(optimism).toMatchObject({
      id: 10,
      name: 'Optimism',
      connection: { primary: { current: 'optimism' } }
    })
  })

  it('splits the legacy testnet hardware derivation', () => {
    const state = { main: { _version: 5, hardwareDerivation: 'testnet', ledger: {}, trezor: {} } }

    expect(migrations.apply(state, 6).main).toMatchObject({
      ledger: { derivation: 'testnet' },
      trezor: { derivation: 'testnet' }
    })
  })

  it('converts pre-cross-chain accounts without logging an address', () => {
    const address = '0x000000000000000000000000000000000000dEaD'
    const accountId = 'fixture-account-id'
    const info = jest.spyOn(log, 'info').mockImplementation(() => {})
    const state = {
      main: {
        _version: 6,
        accounts: {
          [accountId]: {
            name: 'Fixture Account',
            type: 'trezor',
            created: 42,
            addresses: [address]
          }
        },
        addresses: {
          [address]: {
            permissions: { 'fixture.example': { provider: true } },
            tokens: { fixture: true }
          },
          '0x000000000000000000000000000000000000beef': { permissions: {} }
        },
        permissions: {}
      }
    }

    const migrated = migrations.apply(state, 7).main
    const normalized = address.toLowerCase()

    expect(migrated.accounts[normalized]).toMatchObject({
      id: normalized,
      address: normalized,
      name: 'Fixture Account',
      lastSignerType: 'trezor',
      tokens: { fixture: true }
    })
    expect(migrated.permissions[normalized]).toEqual({ 'fixture.example': { provider: true } })
    expect(migrated.backup).toMatchObject({
      accounts: { [accountId]: expect.any(Object) },
      addresses: { [normalized]: expect.any(Object) }
    })
    expect(migrated).not.toHaveProperty('addresses')
    expect(info.mock.calls.flat().join(' ')).not.toContain(address.toLowerCase())
    info.mockRestore()
  })

  it('classifies and enables legacy networks', () => {
    const state = {
      main: {
        _version: 7,
        networks: { ethereum: { 1: { id: 1 }, 5: { id: 5 }, 31337: { id: 31337 } } },
        currentNetwork: { id: 5 }
      }
    }

    const enabled = migrations.apply(state, 8)
    expect(enabled.main.networks.ethereum[1].on).toBe(true)
    expect(enabled.main.networks.ethereum[5].on).toBe(true)
    expect(enabled.main.networks.ethereum[31337].on).toBe(false)

    const classified = migrations.apply(enabled, 9)
    expect(classified.main.networks.ethereum[1].layer).toBe('mainnet')
    expect(classified.main.networks.ethereum[5].layer).toBe('testnet')
    expect(classified.main.networks.ethereum[31337].layer).toBe('other')
  })

  it('normalizes account creation evidence deterministically', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const state = {
      main: {
        _version: 10,
        networks: { ethereum: { 1: { id: 1, symbol: 'Ξ' } } },
        accounts: {
          missing: { created: -1 },
          nullish: { created: null },
          block: { created: '0x100' },
          capped: { created: '20000000:1' }
        }
      }
    }

    const migrated = migrations.apply(state, 11).main

    expect(migrated.networks.ethereum[1].symbol).toBe('ETH')
    expect(migrated.accounts.missing.created).toBe('new:1700000000000')
    expect(migrated.accounts.nullish.created).toBe('new:1700000000000')
    expect(migrated.accounts.block.created).toBe('256:1700000000000')
    expect(migrated.accounts.capped.created).toBe('12726312:1')
    Date.now.mockRestore()
  })

  it('extracts an old smart actor address and preserves an already migrated actor', () => {
    const state = {
      main: {
        _version: 11,
        accounts: {
          old: { smart: { actor: { address: '0x0000000000000000000000000000000000000001' } } },
          current: { smart: { actor: '0x0000000000000000000000000000000000000002' } }
        }
      }
    }

    const migrated = migrations.apply(state, 12).main.accounts
    expect(migrated.old.smart.actor).toBe('0x0000000000000000000000000000000000000001')
    expect(migrated.current.smart.actor).toBe('0x0000000000000000000000000000000000000002')
  })
})

describe('legacy boundary hardening', () => {
  it.each([null, 'malformed'])('resets a recoverable pre-v18 token value %p', (tokens) => {
    expect(migrations.apply({ main: { _version: 17, tokens } }, 18).main.tokens).toEqual({
      custom: []
    })
  })

  it('preserves unrelated malformed Lattice entries while migrating usable settings', () => {
    const state = {
      main: {
        _version: 16,
        lattice: { usable: {}, malformed: 'keep-me' },
        latticeSettings: { suffix: 'fixture' }
      }
    }

    expect(migrations.apply(state, 17).main.lattice).toEqual({
      usable: { paired: true, tag: 'fixture', deviceName: 'GridPlus' },
      malformed: 'keep-me'
    })
  })

  it('resets both retired Goerli endpoints in one migration', () => {
    const state = createState(20)
    initChainState(state, 5)
    state.main.networks.ethereum[5].connection = {
      primary: { on: true, current: 'mudit' },
      secondary: { on: true, current: 'prylabs' }
    }

    const connection = migrations.apply(state, 21).main.networks.ethereum[5].connection
    expect(connection).toMatchObject({
      primary: { on: false, current: 'custom' },
      secondary: { on: false, current: 'custom' },
      on: false
    })
  })

  it('adds missing Base Goerli state without overwriting existing records', () => {
    const state = createState(32)
    const added = migrations.apply(clone(state), 33).main
    expect(added.networks.ethereum[84531]).toMatchObject({ id: 84531, name: 'Base Görli' })
    expect(added.networksMeta.ethereum[84531]).toMatchObject({
      nativeCurrency: { symbol: 'görETH', decimals: 18 }
    })

    state.main.networks.ethereum[84531] = { id: 84531, name: 'Custom Base' }
    state.main.networksMeta.ethereum[84531] = { icon: 'fixture.svg' }
    const preserved = migrations.apply(state, 33).main
    expect(preserved.networks.ethereum[84531]).toEqual({ id: 84531, name: 'Custom Base' })
    expect(preserved.networksMeta.ethereum[84531]).toEqual({ icon: 'fixture.svg' })
  })

  it('defaults only a missing shortcut enabled state', () => {
    const missing = {
      main: {
        _version: 35,
        shortcuts: { summon: { modifierKeys: ['Alt'], shortcutKey: 'Slash', configuring: false } }
      }
    }
    const disabled = clone(missing)
    disabled.main.shortcuts.summon.enabled = false

    expect(migrations.apply(missing, 36).main.shortcuts.summon.enabled).toBe(true)
    expect(migrations.apply(disabled, 36).main.shortcuts.summon.enabled).toBe(false)
  })

  it('derives only metadata that has enough historical account evidence', () => {
    const state = {
      main: {
        _version: 28,
        accounts: {
          complete: { name: 'Named Fixture', lastSignerType: 'address' },
          missingName: { lastSignerType: 'address' },
          missingType: { name: 'Incomplete Fixture' }
        }
      }
    }

    expect(Object.values(migrations.apply(state, 29).main.accountsMeta)).toEqual([
      expect.objectContaining({ name: 'Named Fixture' })
    ])
  })

  it('recovers null legacy shortcuts through the established default sequence', () => {
    const state = { main: { _version: 34, shortcuts: null } }

    expect(migrations.apply(state, 37).main.shortcuts.summon).toEqual({
      modifierKeys: ['Alt'],
      shortcutKey: 'Slash',
      enabled: true,
      configuring: false
    })
  })

  it('recovers malformed summon settings through migration 37 fallback', () => {
    const state = { main: { _version: 36, shortcuts: { summon: 'malformed' } } }

    expect(migrations.apply(state, 37).main.shortcuts.summon).toEqual({
      modifierKeys: ['Alt'],
      shortcutKey: 'Slash',
      enabled: true,
      configuring: false
    })
  })

  it.each([
    [15, 16, { currentNetwork: { id: 'not-a-chain' }, networks: { ethereum: {} } }, 'current network id'],
    [
      24,
      26,
      { networks: { ethereum: { 1: { id: 1 } } }, networksMeta: { ethereum: {} } },
      'network metadata'
    ],
    [31, 32, { tokens: { known: { fixture: {} } } }, 'invalid tokens']
  ])('rejects malformed migration %i input deterministically', (version, target, fields, expected) => {
    expect(() => migrations.apply({ main: { _version: version, ...fields } }, target)).toThrow(expected)
  })

  it('uses bounded field-only diagnostics for malformed historical values', () => {
    const canary = 'do-not-log-this-value.example'
    const malformed = {
      main: {
        _version: 30,
        balances: { [canary]: { address: canary } }
      }
    }

    expect(() => migrations.apply(malformed, 31)).toThrow('Migration 31: invalid state (main.balances')
    try {
      migrations.apply(malformed, 31)
    } catch (error) {
      expect(error.message).not.toContain(canary)
    }
  })
})
