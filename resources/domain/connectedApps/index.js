import { isNetworkConnected } from '../../utils/chains'
import { isManagedPermission, isPermissionActive } from '../permissions'
import { isWrenOwnedOriginName } from '../origin'

export const RECENT_ORIGIN_TTL = 60 * 60 * 1000
export const MAX_TIMER_DELAY = 2 ** 31 - 1

const isActiveExternalPermission = (permission, now) =>
  !isManagedPermission(permission) &&
  typeof permission?.origin === 'string' &&
  !isWrenOwnedOriginName(permission.origin) &&
  isPermissionActive(permission, now)

export function nextActiveExternalPermissionExpiry(permissionsByAccount = {}, now = Date.now()) {
  let nextExpiry

  Object.values(permissionsByAccount).forEach((permissions = {}) => {
    Object.values(permissions).forEach((permission) => {
      if (!isActiveExternalPermission(permission, now)) return

      const expiresAt = permission.caveats[0].value.expiresAt
      if (nextExpiry === undefined || expiresAt < nextExpiry) nextExpiry = expiresAt
    })
  })

  return nextExpiry
}

const externalPermissionAccess = (permissionsByAccount = {}, now = Date.now()) => {
  const accessByHandler = new Map()
  Object.entries(permissionsByAccount).forEach(([account, permissions = {}]) => {
    Object.values(permissions).forEach((permission) => {
      if (!isActiveExternalPermission(permission, now)) return

      // `origin` is display metadata. A handler id is the persisted principal
      // identity and includes Companion/native source provenance.
      const accounts = accessByHandler.get(permission.handlerId) || new Set()
      accounts.add(account.toLowerCase())
      accessByHandler.set(permission.handlerId, accounts)
    })
  })
  return accessByHandler
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

        const accessCount = permissionAccess.get(id)?.size || 0
        const durable = accessCount > 0
        const connectedNow = chain.on === true && isNetworkConnected(chain) && sessionIsActive(origin.session)
        const expiresAt = origin.session.lastUpdatedAt + RECENT_ORIGIN_TTL
        if (!connectedNow && !durable && expiresAt <= now) return

        const entry = {
          ...origin,
          id,
          durable,
          accessCount,
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

export function selectConnectedAppSummary(options = {}) {
  const now = options.now ?? Date.now()
  const groups = selectConnectedAppGroups({ ...options, now })
  const expiries = [
    nextTransientConnectedAppExpiry(groups),
    nextActiveExternalPermissionExpiry(options.permissions, now)
  ].filter((expiry) => expiry !== undefined)

  return {
    groups,
    count: groups.reduce(
      (total, { connected, disconnected }) => total + connected.length + disconnected.length,
      0
    ),
    nextExpiry: expiries.length ? Math.min(...expiries) : undefined
  }
}
