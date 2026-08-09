import migration from '../../../../../main/store/migrate/migrations/54'
import { createState } from '../setup'

const endpoint = (overrides = {}) => ({
  on: false,
  connected: false,
  current: 'custom',
  status: 'off',
  custom: '',
  ...overrides
})

it('moves configured primary and secondary connections into stable ordered endpoints', () => {
  const state = createState(53)
  state.main.networks.ethereum = {
    1: {
      id: 1,
      connection: {
        presets: { local: 'direct' },
        primary: endpoint({ on: true, current: 'publicnode', status: 'connected' }),
        secondary: endpoint({ custom: 'https://fallback.example/rpc' })
      }
    }
  }

  const migrated = migration.migrate(state)
  const connection = migrated.main.networks.ethereum[1].connection

  expect(connection.primary).toBeUndefined()
  expect(connection.secondary).toBeUndefined()
  expect(connection.presets).toEqual({ local: 'direct' })
  expect(connection.endpoints).toEqual([
    expect.objectContaining({ id: 'rpc-1', current: 'publicnode', on: true }),
    expect.objectContaining({
      id: 'rpc-2',
      current: 'custom',
      custom: 'https://fallback.example/rpc'
    })
  ])
})

it('drops only an untouched dormant secondary connection', () => {
  const state = createState(53)
  state.main.networks.ethereum = {
    10: {
      id: 10,
      connection: {
        primary: endpoint({ on: true, custom: 'https://primary.example/rpc' }),
        secondary: endpoint()
      }
    }
  }

  expect(migration.migrate(state).main.networks.ethereum[10].connection.endpoints).toEqual([
    expect.objectContaining({ id: 'rpc-1', custom: 'https://primary.example/rpc' })
  ])
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
