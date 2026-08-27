import migrations from '../../../../../main/store/migrate'
import migration from '../../../../../main/store/migrate/migrations/73'
import { WREN_EXTENSION_ORIGIN, originIdForName } from '../../../../../resources/domain/origin'
import { createState } from '../setup'

type MigratableTestState = {
  main: {
    _version: number
    origins: Record<string, unknown>
    permissions?: Record<string, unknown>
  }
}

const legacyExtensionOrigin = {
  chain: { type: 'ethereum', id: 1 },
  name: WREN_EXTENSION_ORIGIN,
  provenance: 'legacy',
  session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
}

test('upgrades only the deterministic legacy Companion control origin to internal provenance', () => {
  const state = createState(72) as MigratableTestState
  const extensionOriginId = originIdForName(WREN_EXTENSION_ORIGIN)
  state.main.origins = {
    [extensionOriginId]: legacyExtensionOrigin,
    lookalike: legacyExtensionOrigin,
    external: {
      chain: { type: 'ethereum', id: 1 },
      name: 'https://example.test',
      provenance: 'legacy',
      session: { requests: 2, startedAt: 2, lastUpdatedAt: 2 }
    }
  }
  state.main.permissions = { account: { [extensionOriginId]: { handlerId: extensionOriginId } } }

  const migrated = migrations.apply(state) as MigratableTestState

  expect(migrated.main._version).toBe(migrations.latest)
  expect(migrated.main.origins[extensionOriginId]).toEqual({
    ...legacyExtensionOrigin,
    provenance: 'internal'
  })
  expect(migrated.main.origins.lookalike).toEqual(legacyExtensionOrigin)
  expect(migrated.main.origins.external).toEqual(state.main.origins.external)
  expect(migrated.main.permissions).toEqual(state.main.permissions)
})

test.each([
  ['source-bound legacy collision', { ...legacyExtensionOrigin, sourceId: 'untrusted-source' }],
  ['wrong-name legacy collision', { ...legacyExtensionOrigin, name: 'https://untrusted.example' }],
  ['non-legacy collision', { ...legacyExtensionOrigin, provenance: 'direct' }]
])('does not elevate a %s at the deterministic identity', (_label, collision) => {
  const state = createState(72) as MigratableTestState
  const extensionOriginId = originIdForName(WREN_EXTENSION_ORIGIN)
  state.main.origins = { [extensionOriginId]: collision }

  expect((migration.migrate(state) as MigratableTestState).main.origins[extensionOriginId]).toEqual(collision)
})
