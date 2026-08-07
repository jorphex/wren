import { FRAME_SEND_ORIGIN } from '../../../../resources/domain/origin'
import {
  RECENT_ORIGIN_TTL,
  nextTransientConnectedAppExpiry,
  requestsPerMinute,
  selectConnectedAppGroups
} from '../../../../resources/domain/connectedApps'

const now = 1_800_000
const chain = (id, on = true, connected = true) => ({
  id,
  name: `Chain ${id}`,
  on,
  connection: { primary: { connected }, secondary: { connected: false } }
})
const origin = (name, chainId, session = {}) => ({
  name,
  chain: { id: chainId, type: 'ethereum' },
  session: {
    requests: 3,
    startedAt: now - 120_000,
    lastUpdatedAt: now - 60_000,
    endedAt: now - 60_000,
    ...session
  }
})
const permission = (name, provider = true) => ({ handlerId: name, origin: name, provider })

it('retains expired origins with durable permissions across accounts and disabled networks', () => {
  const lastUpdatedAt = now - RECENT_ORIGIN_TTL - 1
  const durable = origin('durable.example', 10, {
    startedAt: lastUpdatedAt - 60_000,
    lastUpdatedAt,
    endedAt: lastUpdatedAt
  })

  const groups = selectConnectedAppGroups({
    networks: { 1: chain(1), 10: chain(10, false, true) },
    origins: { durable: durable, expired: origin('expired.example', 1, durable.session) },
    permissions: {
      accountA: { durable: permission('durable.example') },
      accountB: { duplicate: permission('durable.example', false) }
    },
    now
  })

  expect(groups).toHaveLength(1)
  expect(groups[0].chain.id).toBe(10)
  expect(groups[0].disconnected.map(({ id, durable }) => [id, durable])).toEqual([['durable', true]])
})

it('keeps recent transient activity until its exact expiry and exposes the next deadline', () => {
  const lastUpdatedAt = now - RECENT_ORIGIN_TTL + 5_000
  const groups = selectConnectedAppGroups({
    networks: { 1: chain(1, true, false) },
    origins: {
      recent: origin('recent.example', 1, { lastUpdatedAt, endedAt: lastUpdatedAt })
    },
    now
  })

  expect(groups[0].disconnected[0]).toMatchObject({ id: 'recent', durable: false })
  expect(nextTransientConnectedAppExpiry(groups)).toBe(lastUpdatedAt + RECENT_ORIGIN_TTL)
  expect(
    selectConnectedAppGroups({
      networks: { 1: chain(1, true, false) },
      origins: { recent: origin('recent.example', 1, { lastUpdatedAt, endedAt: lastUpdatedAt }) },
      now: lastUpdatedAt + RECENT_ORIGIN_TTL
    })
  ).toEqual([])
})

it('treats an explicit disabled permission as transient activity rather than a durable grant', () => {
  const groups = selectConnectedAppGroups({
    networks: { 1: chain(1, true, false) },
    origins: { denied: origin('denied.example', 1) },
    permissions: { account: { denied: permission('denied.example', false) } },
    now
  })

  expect(groups[0].disconnected[0]).toMatchObject({
    id: 'denied',
    durable: false,
    expiresAt: now - 60_000 + RECENT_ORIGIN_TTL
  })
})

it('hides managed and internal origins even when their sessions are recent', () => {
  const groups = selectConnectedAppGroups({
    networks: { 1: chain(1) },
    origins: {
      managed: origin(FRAME_SEND_ORIGIN, 1, { endedAt: undefined }),
      internal: origin('frame-internal', 1, { endedAt: undefined }),
      extension: origin('frame-extension', 1, { endedAt: undefined })
    },
    permissions: { account: { managed: permission(FRAME_SEND_ORIGIN) } },
    now
  })

  expect(groups).toEqual([])
})

it('calculates average requests per minute with a fixed ended-session duration', () => {
  expect(requestsPerMinute({ requests: 12, startedAt: 0, endedAt: 120_000 }, 999_999)).toBe(6)
  expect(requestsPerMinute({ requests: 3, startedAt: 0 }, 30_000)).toBe(6)
  expect(requestsPerMinute({ requests: -1, startedAt: 0, endedAt: 120_000 })).toBe(0)
})
