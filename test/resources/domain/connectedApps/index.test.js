import {
  FRAME_SEND_ORIGIN,
  WREN_DEPLOY_ORIGIN,
  originIdForInvoker
} from '../../../../resources/domain/origin'
import { createAccountPermission } from '../../../../main/provider/permissions'
import {
  RECENT_ORIGIN_TTL,
  nextActiveExternalPermissionExpiry,
  nextTransientConnectedAppExpiry,
  selectConnectedAppGroups
} from '../../../../resources/domain/connectedApps'

const now = 1_800_000
const chain = (id, on = true, connected = true) => ({
  id,
  name: `Chain ${id}`,
  on,
  connection: { endpoints: [{ id: 'rpc-1', connected }] }
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
const account = '0x1111111111111111111111111111111111111111'
const permission = (handlerId, originName = handlerId, active = true) =>
  active
    ? createAccountPermission({ account, chains: [1, 10], handlerId, origin: originName, now: 1 })
    : { handlerId, origin: originName, provider: false }

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
      accountA: { durable: permission('durable', 'durable.example') },
      accountB: { duplicate: permission('durable', 'durable.example', false) }
    },
    now
  })

  expect(groups).toHaveLength(1)
  expect(groups[0].chain.id).toBe(10)
  expect(groups[0].disconnected.map(({ id, durable, accessCount }) => [id, durable, accessCount])).toEqual([
    ['durable', true, 1]
  ])
})

it('counts active access once per account for a source-bound origin', () => {
  const secondAccount = '0x2222222222222222222222222222222222222222'
  const groups = selectConnectedAppGroups({
    networks: { 1: chain(1) },
    origins: { shared: origin('shared.example', 1, { endedAt: undefined }) },
    permissions: {
      [account]: { shared: permission('shared', 'shared.example') },
      [secondAccount]: {
        shared: createAccountPermission({
          account: secondAccount,
          chains: [1],
          handlerId: 'shared',
          origin: 'shared.example',
          now: 1
        })
      }
    },
    now
  })

  expect(groups[0].connected[0]).toMatchObject({ id: 'shared', durable: true, accessCount: 2 })
})

it('exposes the earliest active external permission expiry across accounts', () => {
  const first = permission('first', 'first.example')
  const second = permission('second', 'second.example')
  first.caveats[0].value.expiresAt = now + 2_000
  second.caveats[0].value.expiresAt = now + 1_000

  expect(
    nextActiveExternalPermissionExpiry(
      {
        [account]: { first },
        other: {
          second,
          expired: { ...permission('expired', 'expired.example'), provider: false },
          internal: permission('internal', 'frame-extension')
        }
      },
      now
    )
  ).toBe(now + 1_000)
  expect(nextActiveExternalPermissionExpiry({ [account]: { second } }, now + 1_000)).toBeUndefined()
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
    permissions: { account: { denied: permission('denied', 'denied.example', false) } },
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
      deployment: origin(WREN_DEPLOY_ORIGIN, 1, { endedAt: undefined }),
      internal: origin('frame-internal', 1, { endedAt: undefined }),
      extension: origin('frame-extension', 1, { endedAt: undefined }),
      external: origin('https://app.example', 1, { endedAt: undefined })
    },
    permissions: {
      account: {
        managed: permission('managed', FRAME_SEND_ORIGIN),
        deployment: permission('deployment', WREN_DEPLOY_ORIGIN)
      }
    },
    now
  })

  expect(groups).toHaveLength(1)
  expect(groups[0].connected.map(({ id }) => id)).toEqual(['external'])
})

it('keeps durable Companion access bound to its source-specific origin id after another same-URL peer is revoked', () => {
  const displayUrl = 'https://same-url.example'
  const first = originIdForInvoker(displayUrl, {
    provenance: 'companion',
    sourceId: 'A'.repeat(43)
  })
  const second = originIdForInvoker(displayUrl, {
    provenance: 'companion',
    sourceId: 'B'.repeat(43)
  })
  const expiredAt = now - RECENT_ORIGIN_TTL - 1
  const companionOrigin = (sourceId) => ({
    ...origin(displayUrl, 1, { startedAt: expiredAt - 1, lastUpdatedAt: expiredAt, endedAt: expiredAt }),
    provenance: 'companion',
    sourceId
  })
  const permissions = {
    account: {
      [first]: permission(first, displayUrl),
      [second]: permission(second, displayUrl)
    }
  }

  expect(
    selectConnectedAppGroups({
      networks: { 1: chain(1, false, false) },
      origins: { [first]: companionOrigin('A'.repeat(43)), [second]: companionOrigin('B'.repeat(43)) },
      permissions,
      now
    })[0]
      .disconnected.map(({ id, durable }) => [id, durable])
      .sort()
  ).toEqual(
    [
      [first, true],
      [second, true]
    ].sort()
  )

  expect(
    selectConnectedAppGroups({
      networks: { 1: chain(1, false, false) },
      origins: { [first]: companionOrigin('A'.repeat(43)), [second]: companionOrigin('B'.repeat(43)) },
      permissions: { account: { [second]: permission(second, displayUrl) } },
      now
    })[0].disconnected.map(({ id, durable }) => [id, durable])
  ).toEqual([[second, true]])
})
