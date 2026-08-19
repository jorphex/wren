import migration from '../../../../../main/store/migrate/migrations/67'
import migrations from '../../../../../main/store/migrate'
import { createState } from '../setup'

test('initializes recent recipients disabled and empty without changing unrelated state', () => {
  const state = createState(66)
  state.main['activity'] = [{ id: 'kept' }]

  expect(migration.migrate(state)).toEqual({
    ...state,
    main: { ...state.main, rememberRecentRecipients: false, recentRecipientUses: [] }
  })
})

test('replaces spoofed pre-migration preference and recipient data and migrates through version 68', () => {
  const state = createState(66)
  state.main['rememberRecentRecipients'] = true
  state.main['recentRecipientUses'] = [{ injected: true }]

  expect(migration.migrate(state).main).toMatchObject({
    rememberRecentRecipients: false,
    recentRecipientUses: []
  })
  expect(migrations.apply(state).main._version).toBe(68)
  expect(migration.migrate(null)).toBeNull()
})
