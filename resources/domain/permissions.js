import { matchFilter } from '../utils'
import { FRAME_SEND_ORIGIN } from './origin'

export const isManagedPermission = (permission) => permission?.origin === FRAME_SEND_ORIGIN

export const getPermissionIds = (permissions, filter = '') =>
  Object.keys(permissions)
    .filter((id) => !isManagedPermission(permissions[id]))
    .filter((id) => matchFilter(filter, [permissions[id].origin]))
    .sort((left, right) => permissions[left].origin.localeCompare(permissions[right].origin))
