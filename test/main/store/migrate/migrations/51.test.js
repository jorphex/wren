import migration from '../../../../../main/store/migrate/migrations/51'
import { createState } from '../setup'

it('removes unsafe address-book entries while preserving valid contacts', () => {
  const state = createState(50)
  const valid = {
    address: '0x0000000000000000000000000000000000000001',
    name: 'Treasury',
    note: '',
    createdAt: 1,
    updatedAt: 1
  }
  const unsafe = {
    address: '0x0000000000000000000000000000000000000002',
    name: 'Spoofed\u202e account',
    note: '',
    createdAt: 1,
    updatedAt: 1
  }
  state.main.addressBook = {
    [valid.address]: valid,
    [unsafe.address]: unsafe
  }

  expect(migration.migrate(state).main.addressBook).toEqual({ [valid.address]: valid })
})

it('initializes missing address-book state', () => {
  const state = createState(50)
  expect(migration.migrate(state).main.addressBook).toEqual({})
})
