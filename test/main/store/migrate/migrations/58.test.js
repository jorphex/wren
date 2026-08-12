import migration58 from '../../../../../main/store/migrate/migrations/58'

it('revokes legacy boolean permissions and labels their origins as legacy contexts', () => {
  const state = {
    main: {
      permissions: {
        '0xaccount': {
          external: { handlerId: 'external', origin: 'https://example.test', provider: true },
          denied: { handlerId: 'denied', origin: 'https://denied.test', provider: false }
        }
      },
      origins: {
        external: {
          name: 'https://example.test',
          chain: { type: 'ethereum', id: 1 },
          session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
        }
      }
    }
  }

  const migrated = migration58.migrate(state)

  expect(migrated.main.permissions).toEqual({})
  expect(migrated.main.origins.external).toMatchObject({
    name: 'https://example.test',
    provenance: 'legacy'
  })
})

it('preserves unrelated state when permission containers are absent', () => {
  expect(migration58.migrate({ main: { accounts: { one: true } } })).toEqual({
    main: { accounts: { one: true }, origins: {}, permissions: {} }
  })
})
