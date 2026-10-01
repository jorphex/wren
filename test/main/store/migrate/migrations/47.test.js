import migration from '../../../../../main/store/migrate/migrations/47'
import { createState } from '../setup'

it('adds disabled Katana defaults and an empty Yearn cache', () => {
  const state = createState(46)

  const migrated = migration.migrate(state)

  expect(migrated.main.networks.ethereum['747474']).toMatchObject({
    id: 747474,
    name: 'Katana',
    explorer: 'https://katanascan.com',
    on: false,
    connection: { primary: { custom: 'https://rpc.katana.network/' } }
  })
  expect(migrated.main.networksMeta.ethereum['747474']).toMatchObject({
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
  })
  expect(migrated.main.yearn).toEqual({ catalogCache: null })
})

it('preserves an existing Katana network and metadata', () => {
  const state = createState(46)
  state.main.networks.ethereum['747474'] = { custom: 'network' }
  state.main.networksMeta.ethereum['747474'] = { custom: 'metadata' }
  state.main.yearn = { catalogCache: { existing: true } }

  const migrated = migration.migrate(state)

  expect(migrated.main.networks.ethereum['747474']).toEqual({ custom: 'network' })
  expect(migrated.main.networksMeta.ethereum['747474']).toEqual({ custom: 'metadata' })
  expect(migrated.main.yearn).toEqual({ catalogCache: { existing: true } })
})

it('returns malformed inputs unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: {} })).toEqual({ main: {} })
})
