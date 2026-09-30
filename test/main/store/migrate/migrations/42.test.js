import migration from '../../../../../main/store/migrate/migrations/42'
import { createState } from '../setup'

it('initializes an empty wallet-call ledger without changing existing state', () => {
  const state = createState(41)
  state.main.accounts = { fixture: { name: 'preserved' } }
  state.main.permissions = { fixture: { origin: { provider: true } } }

  expect(migration.migrate(state)).toEqual({
    ...state,
    main: {
      ...state.main,
      walletCallBatches: {}
    }
  })
})

it('returns malformed inputs unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: {} })).toEqual({ main: {} })
})
