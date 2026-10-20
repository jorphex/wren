import migration from '../../../../../main/store/migrate/migrations/49'
import { createState } from '../setup'

it('invalidates the prior Yearn catalog cache and pre-policy workflows', () => {
  const state = createState(48)
  state.main.yearn = {
    catalogCache: { version: 1, fetchedAt: 1, vaults: [] },
    workflows: { existing: true }
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.yearn).toEqual({ catalogCache: null, workflows: {} })
})
