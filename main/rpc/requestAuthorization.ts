import { originIdForName } from '../../resources/domain/origin'

type RequestOrigin = {
  origin: string
  type: string
}

type ApprovableRequest = RequestOrigin & {
  account: string
  handlerId: string
}

type OriginPermission = {
  origin: string
  provider?: boolean
}

export function isRequestOriginAuthorized(
  request: RequestOrigin,
  permissions: Record<string, OriginPermission>
) {
  if (request.type === 'access') return true

  return Object.values(permissions).some(
    (permission) => permission.provider === true && originIdForName(permission.origin) === request.origin
  )
}

export function enforceRequestOriginAuthorization(
  request: ApprovableRequest,
  permissions: Record<string, OriginPermission>,
  reject: (account: string, handlerId: string, error: { code: number; message: string }) => void
) {
  if (isRequestOriginAuthorized(request, permissions)) return undefined

  const rejection = { code: 4100, message: 'Request origin is no longer authorized' }
  reject(request.account, request.handlerId, rejection)
  return Object.assign(new Error(rejection.message), { code: rejection.code })
}
