import migration from '../../../../../main/store/migrate/migrations/53'
import { createState } from '../setup'

const connection = (current, custom) => ({
  on: true,
  connected: false,
  current,
  status: 'loading',
  custom
})

const chain = (id, primary, secondary = connection('custom', '')) => ({
  id,
  connection: { primary, secondary }
})

it('moves supported Pylon presets to PublicNode without changing dormant custom URLs', () => {
  const state = createState(52)
  state.main.networks.ethereum = {
    1: chain(1, connection('pylon', 'https://user.example/mainnet')),
    84532: chain(84532, connection('pylon', 'https://user.example/base-sepolia')),
    10: chain(10, connection('pylon', 'wss://evm.pylon.link/optimism'))
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.networks.ethereum[1].connection.primary).toMatchObject({
    current: 'publicnode',
    custom: 'https://user.example/mainnet'
  })
  expect(migrated.main.networks.ethereum[84532].connection.primary).toMatchObject({
    current: 'publicnode',
    custom: 'https://user.example/base-sepolia'
  })
  expect(migrated.main.networks.ethereum[10].connection.primary).toMatchObject({
    current: 'publicnode',
    custom: ''
  })
  expect(JSON.stringify(migrated)).not.toContain('pylon.link')
})

it('preserves selected custom connections exactly', () => {
  const state = createState(52)
  const selected = connection('custom', 'wss://private.example/rpc?network=1')
  state.main.networks.ethereum = { 1: chain(1, selected) }

  expect(migration.migrate(state).main.networks.ethereum[1].connection.primary).toEqual(selected)
})

it('disables unsupported Pylon selections while preserving genuine dormant custom URLs', () => {
  const state = createState(52)
  state.main.networks.ethereum = {
    5: chain(5, connection('pylon', 'https://dormant.example/rpc')),
    84531: chain(84531, connection('pylon', '')),
    31337: chain(31337, connection('pylon', 'https://legacy.example/rpc'))
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.networks.ethereum[5].connection.primary).toMatchObject({
    on: false,
    connected: false,
    status: 'off',
    current: 'custom',
    custom: 'https://dormant.example/rpc'
  })
  expect(migrated.main.networks.ethereum[84531].connection.primary).toMatchObject({
    on: false,
    connected: false,
    status: 'off',
    current: 'custom',
    custom: ''
  })
  expect(migrated.main.networks.ethereum[31337].connection.primary).toMatchObject({
    on: false,
    connected: false,
    status: 'off',
    current: 'custom',
    custom: 'https://legacy.example/rpc'
  })
})

it('clears Pylon URLs converted to custom by an earlier migration', () => {
  const state = createState(52)
  state.main.networks.ethereum = {
    5: chain(5, connection('custom', 'wss://evm.pylon.link/goerli'))
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.networks.ethereum[5].connection.primary).toMatchObject({
    on: false,
    connected: false,
    status: 'off',
    current: 'custom',
    custom: ''
  })
  expect(JSON.stringify(migrated)).not.toContain('pylon.link')
})

it('clears only exact inherited Frame CDN network and native-currency icons', () => {
  const state = createState(52)
  state.main.networks.ethereum = {
    1: {
      ...chain(1, connection('pylon', '')),
      icon: 'https://frame.nyc3.cdn.digitaloceanspaces.com/icons/ethereum.svg'
    },
    10: {
      ...chain(10, connection('pylon', '')),
      icon: 'https://icons.example/optimism.svg'
    }
  }
  state.main.networksMeta = {
    ethereum: {
      1: {
        icon: 'http://frame.nyc3.cdn.digitaloceanspaces.com/network.png?size=2',
        nativeCurrency: {
          icon: 'https://frame.nyc3.cdn.digitaloceanspaces.com/native.png'
        }
      },
      10: {
        icon: 'https://icons.example/network.png',
        nativeCurrency: {
          icon: 'https://frame.nyc3.cdn.digitaloceanspaces.com.example/native.png'
        }
      }
    }
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.networks.ethereum[1].icon).toBe('')
  expect(migrated.main.networks.ethereum[10].icon).toBe('https://icons.example/optimism.svg')
  expect(migrated.main.networksMeta.ethereum[1]).toMatchObject({
    icon: '',
    nativeCurrency: { icon: '' }
  })
  expect(migrated.main.networksMeta.ethereum[10]).toMatchObject({
    icon: 'https://icons.example/network.png',
    nativeCurrency: { icon: 'https://frame.nyc3.cdn.digitaloceanspaces.com.example/native.png' }
  })
})

it('removes only inventory from persisted account module ordering', () => {
  const state = createState(52)
  state.panel = {
    account: {
      moduleOrder: ['requests', 'inventory', 'balances', 'inventory', 'custom-module']
    }
  }

  expect(migration.migrate(state).panel.account.moduleOrder).toEqual([
    'requests',
    'balances',
    'custom-module'
  ])
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
