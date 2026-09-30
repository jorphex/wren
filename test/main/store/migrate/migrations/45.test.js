import migration from '../../../../../main/store/migrate/migrations/45'
import { createState } from '../setup'

it('clears protocol-one credentials while preserving unrelated state', () => {
  const state = createState(44)
  state.main.accounts = { fixture: { name: 'preserved' } }
  state.main.extensionCredentials = {
    legacy: { protocolVersion: 1, fingerprint: 'incompatible' }
  }

  expect(migration.migrate(state).main).toMatchObject({
    accounts: state.main.accounts,
    extensionCredentials: {}
  })
})

it('returns malformed inputs unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: {} })).toEqual({ main: {} })
})
