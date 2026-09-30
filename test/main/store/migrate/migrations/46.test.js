import migration from '../../../../../main/store/migrate/migrations/46'
import { createState } from '../setup'

it('preserves legacy null gas fees and unrelated metadata', () => {
  const state = createState(45)
  const preservedMetadata = { customField: { preserved: true } }
  state.main.networksMeta.ethereum[1] = preservedMetadata
  state.main.networksMeta.ethereum[42161] = {
    gas: { price: { fees: null } },
    customField: 'preserved'
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.networksMeta.ethereum[1]).toBe(preservedMetadata)
  expect(migrated.main.networksMeta.ethereum[42161].gas.price.fees).toBeNull()
  expect(migrated.main.networksMeta.ethereum[42161].customField).toBe('preserved')
})

it('leaves malformed envelopes and unrelated legacy values unchanged', () => {
  expect(migration.migrate(null)).toBeNull()
  expect(migration.migrate({ main: {} })).toEqual({ main: {} })

  const state = createState(45)
  state.main.networksMeta.ethereum[42161] = { gas: { price: { fees: 'invalid' } } }
  expect(migration.migrate(state).main.networksMeta.ethereum[42161].gas.price.fees).toBe('invalid')
})
