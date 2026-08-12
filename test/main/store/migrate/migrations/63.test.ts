import migration from '../../../../../main/store/migrate/migrations/63'
import { createState } from '../setup'

const account = `0x${'a'.repeat(40)}`

test('normalizes legacy private activity without time-dependent pruning', () => {
  const state = createState(62)
  const main = state.main as Record<string, unknown>
  main['activity'] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      account,
      origin: 'app.example',
      type: 'transaction',
      outcome: 'dropped',
      createdAt: 1,
      completedAt: 2,
      chainId: 1,
      transactionHash: `0x${'b'.repeat(64)}`
    },
    { malformed: true }
  ]

  const migrated = migration.migrate(state) as { main: Record<string, unknown> }
  expect(migrated.main['activity']).toEqual([
    {
      id: '00000000-0000-4000-8000-000000000001',
      account,
      origin: 'app.example',
      type: 'transaction',
      outcome: 'replaced',
      createdAt: 1,
      completedAt: 2,
      chainId: 1
    }
  ])
})

test('preserves malformed roots for the migration framework to reject', () => {
  expect(migration.migrate(null)).toBeNull()
})
