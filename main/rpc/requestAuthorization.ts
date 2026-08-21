import { permissionCovers } from '../provider/permissions'
import {
  WREN_DEPLOY_ORIGIN,
  getManagedOriginNameForId,
  originIdForInvoker
} from '../../resources/domain/origin'
import { parseRpcQuantity } from '../../resources/domain/transaction/quantity'
import { ExtensionCredentialSchema } from '../store/state/types/extensionCredential'
import { NativePeerCredentialSchema } from '../store/state/types/peerCredential'
import { OriginSchema } from '../store/state/types/origin'

type RequestOrigin = {
  account?: string
  chainId?: string
  data?: unknown
  deployment?: unknown
  context?: { requestChainId?: string | number }
  origin: string
  payload?: { chainId?: string; method?: string }
  replacement?: { kind?: string }
  type: string
}

type ApprovableRequest = RequestOrigin & {
  account: string
  handlerId: string
}

type OriginPermission = {
  [field: string]: unknown
}

type RequestPrincipalState = {
  origins: Record<string, unknown>
  extensionCredentials: Record<string, unknown>
  nativePeerCredentials: Record<string, unknown>
}

const requestChainId = (request: RequestOrigin) => {
  const data = request.data && typeof request.data === 'object' ? request.data : undefined
  const dataChainId = data && 'chainId' in data ? data.chainId : undefined
  const dataContext = data && 'context' in data && typeof data.context === 'object' ? data.context : undefined
  const contextChainId =
    dataContext && 'requestChainId' in dataContext
      ? dataContext.requestChainId
      : request.context?.requestChainId
  return typeof dataChainId === 'string' || typeof dataChainId === 'number'
    ? dataChainId
    : request.chainId ||
        (typeof contextChainId === 'string' || typeof contextChainId === 'number'
          ? contextChainId
          : request.payload?.chainId)
}

const isLocalCancelRecovery = (request: RequestOrigin) =>
  request.type === 'transaction' && request.replacement?.kind === 'cancel'

const isCanonicalExternalWebOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin
  } catch {
    return false
  }
}

const sourceBoundPrincipalMatches = (
  originId: string,
  principal: import('../store/state/types/origin').Origin,
  state: RequestPrincipalState
) => {
  if (principal.provenance === 'direct') {
    return !principal.sourceId && originIdForInvoker(principal.name, { provenance: 'direct' }) === originId
  }
  if (!principal.sourceId) return false
  if (principal.provenance === 'companion') {
    const credential = ExtensionCredentialSchema.safeParse(state.extensionCredentials[principal.sourceId])
    return !!(
      credential.success &&
      credential.data.fingerprint === principal.sourceId &&
      originIdForInvoker(principal.name, {
        provenance: 'companion',
        sourceId: principal.sourceId
      }) === originId
    )
  }
  if (principal.provenance === 'native') {
    const credential = NativePeerCredentialSchema.safeParse(state.nativePeerCredentials[principal.sourceId])
    return !!(
      credential.success &&
      credential.data.fingerprint === principal.sourceId &&
      originIdForInvoker(principal.name, {
        provenance: 'native',
        sourceId: principal.sourceId
      }) === originId
    )
  }
  return false
}

export function isCurrentPreAccessSwitchOriginAuthorized(
  request: RequestOrigin,
  state: RequestPrincipalState
) {
  if (
    request.type !== 'switchChain' ||
    request.payload?.method !== 'wallet_switchEthereumChain' ||
    !request.account
  ) {
    return false
  }
  const origin = OriginSchema.safeParse(state.origins[request.origin])
  return !!(
    origin.success &&
    isCanonicalExternalWebOrigin(origin.data.name) &&
    (origin.data.provenance === 'direct' || origin.data.provenance === 'companion') &&
    sourceBoundPrincipalMatches(request.origin, origin.data, state)
  )
}

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const deploymentRequestChain = (request: RequestOrigin) => {
  const deployment = recordValue(request.deployment)
  if (request.type !== 'transaction' || request.payload?.method !== 'eth_sendTransaction' || !deployment) {
    return
  }
  const requestChain = parseRpcQuantity(requestChainId(request))
  const evidenceChain = parseRpcQuantity(deployment['chainId'])
  if (requestChain === undefined || requestChain === 0n || requestChain !== evidenceChain) return
  return requestChain
}

const managedRequestAuthorized = (
  request: RequestOrigin,
  managedOriginName: string,
  principal?: { chain: { type: string; id: number } }
) => {
  if (managedOriginName !== WREN_DEPLOY_ORIGIN) return true
  const chainId = deploymentRequestChain(request)
  if (chainId === undefined) return false
  if (!principal) return true
  return (
    principal.chain.type === 'ethereum' &&
    Number.isSafeInteger(principal.chain.id) &&
    BigInt(principal.chain.id) === chainId
  )
}

export function isRequestOriginAuthorized(
  request: RequestOrigin,
  permissions: Record<string, OriginPermission>
) {
  if (request.type === 'access') return true
  if (request.type === 'switchChain') return request.payload?.method === 'wallet_switchEthereumChain'
  if (isLocalCancelRecovery(request)) return true
  const managedOriginName = getManagedOriginNameForId(request.origin)
  if (managedOriginName) return managedRequestAuthorized(request, managedOriginName)

  if (!request.account || !request.payload?.method) return false
  const permission = permissions[request.origin]
  const chainId = requestChainId(request)
  return permissionCovers(permission, {
    account: request.account,
    ...(chainId ? { chainId } : {}),
    handlerId: request.origin,
    method: request.payload.method
  })
}

export function isCurrentRequestOriginAuthorized(
  request: RequestOrigin,
  permissions: Record<string, OriginPermission>,
  state: RequestPrincipalState,
  now = Date.now()
) {
  if (request.type === 'access') return true
  if (isLocalCancelRecovery(request)) return true
  const managedOriginName = getManagedOriginNameForId(request.origin)
  if (managedOriginName) {
    const origin = OriginSchema.safeParse(state.origins[request.origin])
    return !!(
      origin.success &&
      origin.data.name === managedOriginName &&
      origin.data.provenance === 'managed' &&
      !origin.data.sourceId &&
      managedRequestAuthorized(request, managedOriginName, origin.data)
    )
  }

  if (!request.account || !request.payload?.method) return false
  const permission = permissions[request.origin]
  const chainId = requestChainId(request)
  if (
    !permissionCovers(permission, {
      account: request.account,
      ...(chainId ? { chainId } : {}),
      handlerId: request.origin,
      method: request.payload.method,
      now
    })
  ) {
    return false
  }

  const origin = OriginSchema.safeParse(state.origins[request.origin])
  if (!origin.success || !permission || origin.data.name !== permission['origin']) return false
  const principal = origin.data

  return sourceBoundPrincipalMatches(request.origin, principal, state)
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
