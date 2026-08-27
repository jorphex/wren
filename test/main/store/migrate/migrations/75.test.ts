import migrations from '../../../../../main/store/migrate'
import migration from '../../../../../main/store/migrate/migrations/75'
import { createState } from '../setup'

const ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

test('restores canonical account identity from historical address keys', () => {
  const state = createState(74)
  state.main.accounts = {
    [ADDRESS.toUpperCase().replace('0X', '0x')]: {
      name: 'Historical account',
      lastSignerType: 'ring',
      signer: 'preserved-signer'
    }
  }

  const migrated = migrations.apply(state)

  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.accounts).toEqual({
    [ADDRESS]: {
      id: ADDRESS,
      address: ADDRESS,
      name: 'Historical account',
      lastSignerType: 'ring',
      signer: 'preserved-signer'
    }
  })
})

test('prefers an existing canonical record when duplicate address casing exists', () => {
  const state = createState(74)
  state.main.accounts = {
    [ADDRESS.toUpperCase().replace('0X', '0x')]: { name: 'Legacy duplicate', legacy: true },
    [ADDRESS]: { name: 'Canonical account', active: true }
  }

  const migrated = migrations.apply(state)

  expect(migrated.main.accounts).toEqual({
    [ADDRESS]: {
      id: ADDRESS,
      address: ADDRESS,
      name: 'Canonical account',
      active: true,
      legacy: true
    }
  })
})

test('leaves malformed envelopes and non-address account keys available for validation', () => {
  expect(migration.migrate(null)).toBeNull()

  const state = createState(74)
  state.main.accounts = { fixture: { name: 'Preserved fixture' } }
  expect(migration.migrate(state)).toMatchObject({
    main: { accounts: { fixture: { name: 'Preserved fixture' } } }
  })
})
