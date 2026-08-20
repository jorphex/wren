import { ChainMetadataSchema } from '../../../../../main/store/state/types/chain'
import migrations from '../../../../../main/store/migrate'
import migration from '../../../../../main/store/migrate/migrations/71'
import { createState } from '../setup'

type MigratedState = {
  main: {
    _version: number
    networksMeta: { ethereum: Record<string, unknown> }
  }
}

const network = (id: number, overrides = {}) => ({
  id,
  name: `Chain ${id}`,
  on: true,
  isTestnet: false,
  connection: {
    endpoints: [
      {
        id: 'rpc-1',
        on: true,
        connected: false,
        current: 'custom',
        status: 'loading',
        custom: 'https://rpc.example.test'
      }
    ]
  },
  ...overrides
})

test('reconciles metadata to valid networks, retaining valid values and repairing the rest', () => {
  const state = createState(70)
  state.main.networks.ethereum = {
    4153: { ...network(4153), symbol: 'USDC', nativeCurrencyName: 'USD Coin', nativeCurrencyDecimals: 6 },
    4154: network(4154, { isTestnet: true }),
    broken: { id: 'not-a-chain' }
  }
  state.main.networksMeta = {
    ethereum: {
      4153: {
        blockHeight: 41,
        icon: 'local-icon',
        primaryColor: 'accent6',
        gas: {
          samples: [],
          price: {
            selected: 'fast',
            levels: { fast: '0x1', custom: 7 },
            fees: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x00' }
          }
        },
        nativeCurrency: {
          symbol: 'USDC',
          icon: 'currency-icon',
          name: 'USD Coin',
          decimals: 6,
          usd: { price: 1, change24hr: -0.1 }
        }
      },
      4154: null,
      999999: { nativeCurrency: { symbol: 'ORPHAN' } },
      broken: { nativeCurrency: { symbol: 'BROKEN' } }
    }
  }

  const migrated = migration.migrate(state) as MigratedState
  const metadata = migrated.main.networksMeta.ethereum as Record<string, Record<string, unknown>>

  expect(Object.keys(metadata)).toEqual(['4153', '4154'])
  expect(metadata[4153]).toMatchObject({
    blockHeight: 41,
    icon: 'local-icon',
    primaryColor: 'accent6',
    gas: {
      samples: [],
      price: {
        selected: 'fast',
        levels: { slow: '', standard: '', fast: '0x1', asap: '', custom: '' }
      }
    },
    nativeCurrency: {
      symbol: 'USDC',
      icon: 'currency-icon',
      name: 'USD Coin',
      decimals: 6,
      usd: { price: 1, change24hr: -0.1 }
    }
  })
  expect(metadata['4153']?.['gas']).not.toHaveProperty('price.fees')
  expect(metadata[4154]).toMatchObject({
    primaryColor: 'accent2',
    nativeCurrency: { symbol: 'ETH', name: 'Chain 4154', decimals: 18, usd: { price: 0, change24hr: 0 } }
  })
  Object.values(metadata).forEach((value) => expect(ChainMetadataSchema.safeParse(value).success).toBe(true))
})

test('repairs a malformed metadata envelope and remains reload-idempotent', () => {
  const state = createState(70)
  state.main.networks.ethereum = { 4153: network(4153) }
  state.main.networksMeta = [] as unknown as { ethereum: Record<string, unknown> }

  const migrated = migrations.apply(state) as MigratedState

  expect(migrated.main._version).toBe(migrations.latest)
  expect(ChainMetadataSchema.safeParse(migrated.main.networksMeta.ethereum['4153']).success).toBe(true)
  expect(migrations.apply(structuredClone(migrated))).toEqual(migrated)
})
