import { permissionCovers } from '../provider/permissions'
import { FRAME_SEND_ORIGIN, originIdForInvoker } from '../../resources/domain/origin'

const managedSendOriginId = originIdForInvoker(FRAME_SEND_ORIGIN, { provenance: 'managed' })

type RequestOrigin = {
  account?: string
  chainId?: string
  data?: { chainId?: string }
  origin: string
  payload?: { chainId?: string; method?: string }
  type: string
}

type ApprovableRequest = RequestOrigin & {
  account: string
  handlerId: string
}

type OriginPermission = {
  [field: string]: unknown
}

export function isRequestOriginAuthorized(
  request: RequestOrigin,
  permissions: Record<string, OriginPermission>
) {
  if (request.type === 'access') return true
  if (request.origin === managedSendOriginId) return true

  if (!request.account || !request.payload?.method) return false
  const permission = permissions[request.origin]
  const chainId = request.data?.chainId || request.chainId || request.payload.chainId
  return permissionCovers(permission, {
    account: request.account,
    ...(chainId ? { chainId } : {}),
    handlerId: request.origin,
    method: request.payload.method
  })
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
