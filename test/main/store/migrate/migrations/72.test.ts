import migration from '../../../../../main/store/migrate/migrations/72'
import {
  FRAME_SEND_ORIGIN,
  WREN_DEPLOY_ORIGIN,
  originIdForName
} from '../../../../../resources/domain/origin'
import { createState } from '../setup'

const managedOrigin = (name: string) => ({
  chain: { type: 'ethereum', id: 1 },
  name,
  provenance: 'managed',
  sessionOnly: false,
  session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
})

test('removes untrusted legacy collisions at Wren-managed origin identities', () => {
  const state = createState(71)
  const sendId = originIdForName(FRAME_SEND_ORIGIN)
  const deployId = originIdForName(WREN_DEPLOY_ORIGIN)
  state.main.origins = {
    [sendId]: { ...managedOrigin(FRAME_SEND_ORIGIN), provenance: 'legacy' },
    [deployId]: { ...managedOrigin(WREN_DEPLOY_ORIGIN), sourceId: 'colliding-source' },
    direct: { name: 'https://example.test', provenance: 'direct' }
  }
  state.main.permissions = {
    account: {
      [sendId]: { handlerId: 'legacy-send' },
      [deployId]: { handlerId: 'colliding-deploy' },
      direct: { handlerId: 'direct' }
    }
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.origins).toEqual({
    direct: { name: 'https://example.test', provenance: 'direct' }
  })
  expect(migrated.main.permissions).toEqual({ account: { direct: { handlerId: 'direct' } } })
})

test('preserves exact managed origins and unrelated permission grants', () => {
  const state = createState(71)
  const sendId = originIdForName(FRAME_SEND_ORIGIN)
  const deployId = originIdForName(WREN_DEPLOY_ORIGIN)
  state.main.origins = {
    [sendId]: managedOrigin(FRAME_SEND_ORIGIN),
    [deployId]: managedOrigin(WREN_DEPLOY_ORIGIN)
  }
  state.main.permissions = { account: { [sendId]: { handlerId: 'send' } } }

  expect(migration.migrate(state).main).toMatchObject({
    origins: state.main.origins,
    permissions: state.main.permissions
  })
})

test('preserves malformed input for framework rejection', () => {
  expect(migration.migrate(null)).toBeNull()
})
