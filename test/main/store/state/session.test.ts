import { v5 as uuidv5 } from 'uuid'

import { clearSessionOnlyOrigins } from '../../../../main/store/state/session'

const persistentId = 'persistent-origin'
const sessionOnlyId = 'session-only-origin'
const legacyUnknownId = uuidv5('Unknown', uuidv5.DNS)
const orphanedSessionOnlyId = 'orphaned-session-only-origin'

const origin = (name: string, sessionOnly: boolean) => ({
  name,
  sessionOnly,
  chain: { id: 1, type: 'ethereum' as const },
  session: { requests: 1, startedAt: 1, lastUpdatedAt: 1 }
})

it('removes session-only and legacy unknown origins with their permissions', () => {
  const main = {
    origins: {
      [persistentId]: origin('example.com', false),
      [sessionOnlyId]: origin('Unknown/generated', true),
      [legacyUnknownId]: origin('Unknown', false)
    },
    permissions: {
      '0xaccount': {
        [persistentId]: { handlerId: persistentId, origin: 'example.com', provider: true },
        [sessionOnlyId]: {
          handlerId: sessionOnlyId,
          origin: 'Unknown/generated',
          provider: true
        },
        [legacyUnknownId]: {
          handlerId: legacyUnknownId,
          origin: 'Unknown',
          provider: true
        },
        [orphanedSessionOnlyId]: {
          handlerId: orphanedSessionOnlyId,
          origin: 'Unknown/orphaned',
          provider: true
        }
      }
    },
    dappGuardrails: {
      '0xaccount': {
        [persistentId]: { '0x1': { originId: persistentId } },
        [sessionOnlyId]: { '0x1': { originId: sessionOnlyId } },
        [legacyUnknownId]: { '0x1': { originId: legacyUnknownId } },
        [orphanedSessionOnlyId]: { '0x1': { originId: orphanedSessionOnlyId } }
      }
    }
  }

  clearSessionOnlyOrigins(main)

  expect(main.origins).toEqual({ [persistentId]: origin('example.com', false) })
  expect(main.permissions['0xaccount']).toEqual({
    [persistentId]: { handlerId: persistentId, origin: 'example.com', provider: true }
  })
  expect(main.dappGuardrails['0xaccount']).toEqual({
    [persistentId]: { '0x1': { originId: persistentId } }
  })
})
