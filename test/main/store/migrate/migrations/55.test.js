import migration from '../../../../../main/store/migrate/migrations/55'
import { createState } from '../setup'

it('retires the legacy Send dapp, origin, and managed permissions', () => {
  const state = createState(54)
  state.main.dapps = {
    send: { ens: 'send.frame.eth', status: 'ready' },
    example: { ens: 'example.eth', status: 'ready' }
  }
  state.main.origins = {
    send: { name: 'http://send.frame.eth.localhost:8421' },
    example: { name: 'https://example.test' }
  }
  state.main.permissions = {
    '0xaccount': {
      send: { origin: 'http://send.frame.eth.localhost:8421', provider: true },
      example: { origin: 'https://example.test', provider: true }
    }
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.dapps).toEqual({ example: state.main.dapps.example })
  expect(migrated.main.origins).toEqual({ example: state.main.origins.example })
  expect(migrated.main.permissions['0xaccount']).toEqual({
    example: state.main.permissions['0xaccount'].example
  })
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
