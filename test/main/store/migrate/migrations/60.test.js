import migration from '../../../../../main/store/migrate/migrations/60'
import { createState } from '../setup'

it('enables privacy-safe terminal transaction notifications by default', () => {
  const state = createState(59)

  expect(migration.migrate(state).main.transactionNotifications).toBe(true)
})

it('preserves an explicit notification preference', () => {
  const state = createState(59)
  state.main.transactionNotifications = false

  expect(migration.migrate(state).main.transactionNotifications).toBe(false)
})

it('preserves malformed input for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
