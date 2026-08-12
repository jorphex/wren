import migration from '../../../../../main/store/migrate/migrations/64'

it('initializes empty outbound-address memory without changing other state', () => {
  const state = { main: { activity: [{ id: 'kept' }], other: true }, provider: { keep: true } }

  expect(migration.migrate(state)).toEqual({
    main: { activity: [{ id: 'kept' }], other: true, outboundAddressMemory: {} },
    provider: { keep: true }
  })
})

it('replaces untrusted pre-migration address-memory data', () => {
  expect(migration.migrate({ main: { outboundAddressMemory: { leaked: 'address' } } })).toEqual({
    main: { outboundAddressMemory: {} }
  })
  expect(migration.migrate(null)).toBeNull()
})
