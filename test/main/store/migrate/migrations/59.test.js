import migration from '../../../../../main/store/migrate/migrations/59'
import { createState } from '../setup'

it('starts a bounded activity ledger without reviving transient requests', () => {
  const state = createState(58)
  state.main.activity = [{ id: 'untrusted-pre-feature-entry' }]
  state.main.accounts = { account: { requests: { pending: { type: 'transaction' } } } }
  state.panel = { account: { moduleOrder: ['requests', 'balances', 'permissions'] } }

  const migrated = migration.migrate(state)
  expect(migrated.main.activity).toEqual([])
  expect(migrated.main.accounts).toEqual(state.main.accounts)
  expect(migrated.panel.account.moduleOrder).toEqual(['requests', 'balances', 'activity', 'permissions'])
})

it('retains only valid recent activity in deterministic newest-first order', () => {
  const state = createState(58)
  const now = Date.now()
  const entry = (id, completedAt) => ({
    id,
    account: `0x${'a'.repeat(40)}`,
    origin: 'example.test',
    type: 'transaction',
    outcome: 'confirmed',
    createdAt: completedAt,
    completedAt
  })
  const recent = entry('00000000-0000-4000-8000-000000000001', now - 1000)
  const newer = entry('00000000-0000-4000-8000-000000000002', now)
  const expired = entry('00000000-0000-4000-8000-000000000003', now - 91 * 24 * 60 * 60 * 1000)
  state.main.activity = [recent, expired, newer, { malformed: true }]

  expect(migration.migrate(state).main.activity).toEqual([newer, recent])
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
