import migration from '../../../../../main/store/migrate/migrations/50'
import { createState } from '../setup'

it('initializes a missing address book', () => {
  const state = createState(49)
  expect(migration.migrate(state).main.addressBook).toEqual({})
})

it('preserves a valid address book and replaces malformed data', () => {
  const state = createState(49)
  const entry = {
    address: '0x0000000000000000000000000000000000000001',
    name: 'Treasury',
    note: '',
    createdAt: 1,
    updatedAt: 1
  }
  state.main.addressBook = { [entry.address.toLowerCase()]: entry }
  expect(migration.migrate(state).main.addressBook).toEqual(state.main.addressBook)

  state.main.addressBook = []
  expect(migration.migrate(state).main.addressBook).toEqual({})
})
