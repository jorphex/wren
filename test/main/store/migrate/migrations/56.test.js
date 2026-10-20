import migration from '../../../../../main/store/migrate/migrations/56'
import { createState } from '../setup'

it('removes the retired Activity placeholder from persisted account modules', () => {
  const state = createState(55)
  state.panel = {
    account: {
      moduleOrder: ['requests', 'activity', 'balances', 'activity', 'custom-module']
    }
  }

  expect(migration.migrate(state).panel.account.moduleOrder).toEqual([
    'requests',
    'balances',
    'custom-module'
  ])
})
