import migration from '../../../../../main/store/migrate/migrations/59'
import { createState } from '../setup'

it('starts a bounded activity ledger without reviving transient requests', () => {
  const state = createState(58)
  state.main.activity = [{ id: 'untrusted-pre-feature-entry' }]
  state.main.accounts = { account: { requests: { pending: { type: 'transaction' } } } }

  const migrated = migration.migrate(state)
  expect(migrated.main.activity).toEqual([])
  expect(migrated.main.accounts).toEqual(state.main.accounts)
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
