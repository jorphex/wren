import migration from '../../../../../main/store/migrate/migrations/62'
import { DesktopAuthIdentitySchema } from '../../../../../main/api/desktopAuthIdentity'
import { createState } from '../setup'

it('creates a fresh desktop identity and clears native and v2 extension credentials for re-pairing', () => {
  const state = createState(61) as ReturnType<typeof createState> & {
    main: Record<string, unknown>
  }
  state.main.instanceId = '11111111-1111-4111-8111-111111111111'
  state.main.nativePeerCredentials = { unsafe: { publicKey: 'unvalidated' } }
  state.main.extensionCredentials = { unsafe: { publicKey: 'single-v2-key' } }
  state.main.origins = {
    companion: { provenance: 'companion', sourceId: 'legacy-v2-fingerprint' },
    direct: { provenance: 'direct' }
  }
  state.main.permissions = {
    '0x1111111111111111111111111111111111111111': {
      companion: { handlerId: 'companion' },
      direct: { handlerId: 'direct' }
    }
  }

  const migrated = migration.migrate(state) as { main: Record<string, unknown> }
  expect(DesktopAuthIdentitySchema.safeParse(migrated.main.desktopAuthIdentity).success).toBe(true)
  expect(DesktopAuthIdentitySchema.parse(migrated.main.desktopAuthIdentity).installationId).not.toBe(
    state.main.instanceId
  )
  expect(migrated.main.nativePeerCredentials).toEqual({})
  expect(migrated.main.extensionCredentials).toEqual({})
  expect(migrated.main.origins).toEqual({ direct: { provenance: 'direct' } })
  expect(migrated.main.permissions).toEqual({
    '0x1111111111111111111111111111111111111111': { direct: { handlerId: 'direct' } }
  })
})

it('preserves an existing valid desktop identity', () => {
  const state = createState(61) as ReturnType<typeof createState> & {
    main: Record<string, unknown>
  }
  state.main.instanceId = '11111111-1111-4111-8111-111111111111'
  const first = migration.migrate(state) as { main: Record<string, unknown> }
  const second = migration.migrate(first) as { main: Record<string, unknown> }

  expect(second.main.desktopAuthIdentity).toEqual(first.main.desktopAuthIdentity)
})

it('preserves malformed input for framework rejection', () => {
  expect(migration.migrate(null)).toBeNull()
})
