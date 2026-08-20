import { isNetworkConnected } from '../../utils/chains'
import { isManagedPermission, isPermissionActive } from '../permissions'
import { isWrenOwnedOriginName } from '../origin'

export const RECENT_ORIGIN_TTL = 60 * 60 * 1000

const externalPermissionAccess = (permissionsByAccount = {}, now = Date.now()) => {
  const accessByOrigin = new Map()
  Object.values(permissionsByAccount).forEach((permissions = {}) => {
    Object.values(permissions).forEach((permission) => {
      if (
        isManagedPermission(permission) ||
        typeof permission?.origin !== 'string' ||
        isWrenOwnedOriginName(permission.origin) ||
        !isPermissionActive(permission, now)
      ) {
        return
      }

      accessByOrigin.set(permission.origin, true)
    })
  })
  return accessByOrigin
}

const sessionIsActive = (session = {}) => {
  return !session.endedAt || session.startedAt > session.endedAt
}

const bySessionStartTime = (left, right) => right.session.startedAt - left.session.startedAt
const byLastUpdated = (left, right) => right.session.lastUpdatedAt - left.session.lastUpdatedAt

export function selectConnectedAppGroups({
  networks = {},
  origins = {},
  permissions = {},
  now = Date.now()
}) {
  const permissionAccess = externalPermissionAccess(permissions, now)

  return Object.values(networks)
    .map((chain) => {
      const connected = []
      const disconnected = []

      Object.entries(origins).forEach(([id, origin]) => {
        if (origin?.chain?.id !== chain.id || isWrenOwnedOriginName(origin?.name)) return

        const durable = permissionAccess.get(origin.name) === true
        const connectedNow = chain.on === true && isNetworkConnected(chain) && sessionIsActive(origin.session)
        const expiresAt = origin.session.lastUpdatedAt + RECENT_ORIGIN_TTL
        if (!connectedNow && !durable && expiresAt <= now) return

        const entry = {
          ...origin,
          id,
          durable,
          expiresAt: !connectedNow && !durable ? expiresAt : undefined
        }
        const target = connectedNow ? connected : disconnected
        target.push(entry)
      })

      return {
        chain,
        connected: connected.sort(bySessionStartTime),
        disconnected: disconnected.sort(byLastUpdated)
      }
    })
    .filter(({ connected, disconnected }) => connected.length > 0 || disconnected.length > 0)
}

export function nextTransientConnectedAppExpiry(groups) {
  const expiries = groups.flatMap(({ disconnected }) =>
    disconnected.map(({ expiresAt }) => expiresAt).filter((expiry) => typeof expiry === 'number')
  )
  return expiries.length > 0 ? Math.min(...expiries) : undefined
}

export function requestsPerMinute(session, now = Date.now()) {
  const requests = Number.isFinite(session?.requests) ? Math.max(0, session.requests) : 0
  const startedAt = Number.isFinite(session?.startedAt) ? session.startedAt : now
  const endedAt = Number.isFinite(session?.endedAt) ? session.endedAt : now
  const elapsedMinutes = Math.max(endedAt - startedAt, 1_000) / 60_000
  return requests / elapsedMinutes
}
