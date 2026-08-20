import migrations from '../../../../../main/store/migrate'
import migration from '../../../../../main/store/migrate/migrations/70'
import { createState } from '../setup'

const network = (id: number) => ({
  id,
  name: `Chain ${id}`,
  on: true,
  connection: {
    endpoints: [{ id: 'rpc-1', on: true, connected: false, current: 'custom', status: 'loading', custom: '' }]
  }
})

test('repairs missing and incomplete native-currency rates without replacing valid values', () => {
  const state = createState(69)
  state.main.networks.ethereum[4153] = network(4153)
  state.main.networksMeta = {
    ethereum: {
      1: { nativeCurrency: { symbol: 'ETH', usd: { price: 3200, change24hr: -1.5 } } },
      10: { nativeCurrency: { symbol: 'ETH', usd: { price: 3200 } } },
      4153: { nativeCurrency: { symbol: 'USDC', decimals: 6 } },
      malformed: { preserved: true }
    }
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.networksMeta.ethereum).toEqual({
    1: { nativeCurrency: { symbol: 'ETH', usd: { price: 3200, change24hr: -1.5 } } },
    10: { nativeCurrency: { symbol: 'ETH', usd: { price: 3200, change24hr: 0 } } },
    4153: {
      nativeCurrency: { symbol: 'USDC', decimals: 6, usd: { price: 0, change24hr: 0 } }
    },
    malformed: { preserved: true }
  })
})

test('migrates the reported current-version shape and is idempotent', () => {
  const state = createState(69)
  state.main.networks.ethereum[4153] = network(4153)
  state.main.networksMeta = {
    ethereum: {
      4153: {
        nativeCurrency: { symbol: 'ETH', icon: '', name: 'Ether', decimals: 18 }
      }
    }
  }

  const migrated = migrations.apply(state)

  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.networksMeta.ethereum[4153].nativeCurrency.usd).toEqual({
    price: 0,
    change24hr: 0
  })
  expect(migrations.apply(structuredClone(migrated))).toEqual(migrated)
})

test('leaves malformed migration envelopes unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: { networksMeta: [] } })).toEqual({ main: { networksMeta: [] } })
})
