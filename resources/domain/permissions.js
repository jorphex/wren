import { matchFilter } from '../utils'
import { isManagedOriginName } from './origin'

export const isManagedPermission = (permission) => isManagedOriginName(permission?.origin)

export const isPermissionActive = (permission, now = Date.now()) =>
  permission?.version === 1 &&
  permission?.provider === true &&
  permission?.parentCapability === 'eth_accounts' &&
  permission?.caveats?.length === 1 &&
  permission.caveats[0]?.type === 'wren:permissionScope' &&
  Number.isInteger(permission.caveats[0]?.value?.expiresAt) &&
  permission.caveats[0].value.expiresAt > now

export const getPermissionIds = (permissions, filter = '', now = Date.now()) =>
  Object.keys(permissions)
    .filter((id) => !isManagedPermission(permissions[id]))
    .filter((id) => isPermissionActive(permissions[id], now))
    .filter((id) => matchFilter(filter, [permissions[id].origin]))
    .sort((left, right) => permissions[left].origin.localeCompare(permissions[right].origin))
