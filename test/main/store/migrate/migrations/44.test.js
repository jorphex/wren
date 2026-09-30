import migration from '../../../../../main/store/migrate/migrations/44'
import { createState } from '../setup'

it('removes legacy boolean trust and starts an empty authenticated credential store', () => {
  const state = createState(43)
  state.main.accounts = { fixture: { name: 'preserved' } }
  state.main.knownExtensions = { legacy: true, denied: false }
  state.main.extensionCredentials = { unsafe: { publicKey: 'unvalidated' } }

  expect(migration.migrate(state).main).toMatchObject({
    accounts: state.main.accounts,
    extensionCredentials: {}
  })
  expect(migration.migrate(state).main).not.toHaveProperty('knownExtensions')
})

it('returns malformed inputs unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: {} })).toEqual({ main: {} })
})
