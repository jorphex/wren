import migration from '../../../../../main/store/migrate/migrations/66'
import migrations from '../../../../../main/store/migrate'
import { createState } from '../setup'

test('initializes empty guardrails without changing unrelated state', () => {
  const state = createState(65)
  state.main['activity'] = [{ id: 'kept' }]

  expect(migration.migrate(state)).toEqual({
    ...state,
    main: { ...state.main, dappGuardrails: {} }
  })
})

test('replaces untrusted pre-migration guardrail data and migrates through the current version', () => {
  const state = createState(65)
  state.main['dappGuardrails'] = { injected: true }

  expect(migration.migrate(state).main['dappGuardrails']).toEqual({})
  expect(migrations.apply(state).main._version).toBe(migrations.latest)
  expect(migration.migrate(null)).toBeNull()
})
