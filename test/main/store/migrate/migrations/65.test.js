import migration from '../../../../../main/store/migrate/migrations/65'
import migrations from '../../../../../main/store/migrate'
import { createState } from '../setup'

const address = '0x0000000000000000000000000000000000000001'
const legacy = {
  address,
  name: 'Treasury',
  note: '',
  createdAt: 1,
  updatedAt: 2
}

it('upgrades valid v1 contacts to saved provenance without changing contact data', () => {
  const state = createState(64)
  state.main.addressBook = { [address]: legacy }

  expect(migration.migrate(state).main.addressBook).toEqual({
    [address]: { ...legacy, provenance: { status: 'saved' } }
  })
})

it('preserves already-current contacts and sanitizes malformed legacy entries independently', () => {
  const current = { ...legacy, provenance: { status: 'verified-out-of-band', verifiedAt: 2, note: 'Phone' } }
  const currentState = createState(64)
  currentState.main.addressBook = { [address]: current }
  expect(migration.migrate(currentState).main.addressBook).toEqual({ [address]: current })

  const mixed = createState(64)
  const secondAddress = '0x0000000000000000000000000000000000000002'
  mixed.main.addressBook = {
    [address]: legacy,
    [secondAddress]: { ...current, address: secondAddress },
    '0x0000000000000000000000000000000000000003': { ...legacy, address: 'invalid' }
  }
  expect(migration.migrate(mixed).main.addressBook).toEqual({
    [address]: { ...legacy, provenance: { status: 'saved' } },
    [secondAddress]: { ...current, address: secondAddress }
  })
})

it('replays frozen v1 migrations before upgrading instead of deleting legacy contacts', () => {
  const state = createState(49)
  state.main.addressBook = { [address]: legacy }

  const migrated = migrations.apply(state)
  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.dappGuardrails).toEqual({})
  expect(migrated.main.addressBook).toEqual({
    [address]: { ...legacy, provenance: { status: 'saved' } }
  })
})

it('initializes missing state and preserves malformed envelopes', () => {
  expect(migration.migrate(createState(64)).main.addressBook).toEqual({})
  expect(migration.migrate(null)).toBeNull()
})

it('drops contacts with timestamps outside the supported date range', () => {
  const state = createState(64)
  state.main.addressBook = {
    [address]: {
      ...legacy,
      updatedAt: Number.MAX_SAFE_INTEGER,
      provenance: {
        status: 'verified-out-of-band',
        verifiedAt: Number.MAX_SAFE_INTEGER,
        note: 'Legacy record'
      }
    }
  }

  expect(migration.migrate(state).main.addressBook).toEqual({})
})
