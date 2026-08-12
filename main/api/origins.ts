import { v4 as uuidv4 } from 'uuid'
import { IncomingMessage } from 'http'
import queryString from 'query-string'

import accounts, { AccessRequest } from '../accounts'
import store from '../store'
import { requireStoreAction } from '../store/action'

import type { Permission } from '../store/state'
import type { ExtensionBrowser } from '../store/state/types/extensionCredential'
import { originIdForInvoker, type InvokerContext } from '../../resources/domain/origin'
import { createAccountPermission, permissionCovers } from '../provider/permissions'

const dev = process.env.NODE_ENV === 'development'

interface ActivePermissionCheck {
  promise: Promise<Permission | undefined>
  request: AccessRequest
  settle(permission?: Permission): void
  waiters: number
}

const activePermissionChecks: Record<string, ActivePermissionCheck> = {}
const sessionOriginPrefix = 'Unknown/'
const MAX_ORIGIN_LENGTH = 2048
const internalOrigins = new Set(['frame-extension', 'frame-internal'])
const webProtocols = new Set(['http:', 'https:', 'ws:', 'wss:'])
const webOrigin = /^(?:https?|wss?):\/\/[^/?#\\]+\/?$/i
const extensionOrigin = /^(?:chrome-extension|moz-extension|safari-web-extension):\/\/[0-9a-z.-]+$/i

interface OriginUpdateResult {
  payload: RPCRequestPayload
  chainId: string
}

export interface OriginAccess {
  address: Address
  origin: string
  permission?: Permission
}

interface CapabilityCheck {
  account?: Address
  chainId?: number | bigint | string
  method?: string
  now?: number
  originId?: string
}

export interface FrameExtension {
  browser: ExtensionBrowser
  id: string
  role: 'control' | 'page'
}

// Allows Wren Companion to request specific methods.
const trustedInternalMethods = ['wallet_getEthereumChains']

const isTrustedOrigin = (origin: string) => origin === 'frame-extension' || origin === 'frame-internal'
const isInternalMethod = (method: string) => trustedInternalMethods.includes(method)

const storeApi = {
  getPermission: (address: Address, originId: string) => {
    const permissions: Record<string, Permission> = store('main.permissions', address) || {}
    return permissions[originId]
  }
}

const currentAccountAddress = () => {
  const currentAccount = accounts.current()
  return currentAccount?.address || currentAccount?.id
}

const accountIsCurrent = (address: Address) =>
  currentAccountAddress()?.toLowerCase() === address.toLowerCase()

function canonicalOrigin(origin: string | undefined) {
  if (!origin || origin.length > MAX_ORIGIN_LENGTH || origin !== origin.trim()) return
  if (internalOrigins.has(origin)) return origin
  if (extensionOrigin.test(origin)) return origin.toLowerCase()
  if (!webOrigin.test(origin)) return

  try {
    const parsed = new URL(origin)
    if (
      !webProtocols.has(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return
    }

    return parsed.origin
  } catch {
    return
  }
}

export function isCanonicalExternalOrigin(origin?: string) {
  const canonical = canonicalOrigin(origin)
  return !!canonical && !internalOrigins.has(canonical)
}

export function isSessionOnlyOrigin(origin: string) {
  return origin === 'Unknown' || origin.startsWith(sessionOriginPrefix)
}

export function requiresSessionOrigin(origin?: string) {
  return !origin || origin === 'null' || isSessionOnlyOrigin(origin) || !canonicalOrigin(origin)
}

export function createSessionOrigin() {
  return `${sessionOriginPrefix}${uuidv4()}`
}

export function parseOrigin(origin?: string, sessionOrigin = 'Unknown') {
  if (!origin || requiresSessionOrigin(origin)) return sessionOrigin

  return canonicalOrigin(origin) || sessionOrigin
}

function invalidOrigin(origin: string) {
  return origin !== origin.replace(/[^0-9a-z/:.[\]-]/gi, '')
}

function waitForPermission(permissionCheckId: string, check: ActivePermissionCheck, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve(undefined)

  check.waiters += 1
  return new Promise<Permission | undefined>((resolve) => {
    let waiting = true
    const finish = (permission?: Permission) => {
      if (!waiting) return
      waiting = false
      check.waiters -= 1
      signal?.removeEventListener('abort', abort)
      resolve(permission)
    }
    const abort = () => {
      finish()
      if (check.waiters > 0 || activePermissionChecks[permissionCheckId] !== check) return

      try {
        accounts.cancelUnapprovedRequestForAccount(check.request.account, check.request.handlerId, {
          code: 4900,
          message: 'Requesting client disconnected'
        })
      } finally {
        check.settle()
      }
    }

    signal?.addEventListener('abort', abort, { once: true })
    check.promise.then(finish)
  })
}

async function requestPermission(
  address: Address,
  fullPayload: RPCRequestPayload,
  permission: Permission,
  signal?: AbortSignal
) {
  const { _origin: originId, ...payload } = fullPayload
  const scope = permission.caveats[0].value
  const permissionCheckId = `${address.toLowerCase()}:${originId}:${scope.chains.join(',')}`

  if (permissionCheckId in activePermissionChecks) {
    const check = activePermissionChecks[permissionCheckId]
    if (check) return waitForPermission(permissionCheckId, check, signal)
  }

  let resolveCheck: (permission?: Permission) => void = () => {}
  const promise = new Promise<Permission | undefined>((resolve) => {
    resolveCheck = resolve
  })

  const request: AccessRequest = {
    payload,
    handlerId: originId,
    type: 'access',
    origin: originId,
    account: address,
    permission
  }
  const check: ActivePermissionCheck = {
    promise,
    request,
    waiters: 0,
    settle(permission) {
      if (activePermissionChecks[permissionCheckId] !== check) return
      delete activePermissionChecks[permissionCheckId]
      resolveCheck(permission)
    }
  }
  activePermissionChecks[permissionCheckId] = check

  if (!accountIsCurrent(address)) {
    check.settle()
    return waitForPermission(permissionCheckId, check, signal)
  }

  try {
    accounts.addRequest(request, () => {
      const origin = store('main.origins', originId)
      const permission = origin ? storeApi.getPermission(address, originId) : undefined

      check.settle(permission)
    })
  } catch {
    check.settle()
  }

  return waitForPermission(permissionCheckId, check, signal)
}

export function getOriginAccess(payload: RPCRequestPayload): OriginAccess | undefined {
  const origin = store('main.origins', payload._origin)
  const address = currentAccountAddress()

  if (!origin || typeof origin.name !== 'string' || invalidOrigin(origin.name) || !address) return

  const permission = storeApi.getPermission(address, payload._origin)
  return { address, origin: origin.name, ...(permission !== undefined && { permission }) }
}

export function hasOriginCapability(payload: RPCRequestPayload, check: CapabilityCheck = {}) {
  const originId = check.originId || payload._origin
  const origin = store('main.origins', originId)
  const address = check.account || currentAccountAddress()
  if (!origin || !address || (!check.account && !accountIsCurrent(address))) return false

  const permission = storeApi.getPermission(address, originId)
  return permissionCovers(permission, {
    account: address,
    ...(check.chainId !== undefined ? { chainId: check.chainId } : {}),
    handlerId: originId,
    method: check.method || payload.method,
    ...(check.now !== undefined ? { now: check.now } : {})
  })
}

export async function requestOriginAccess(
  payload: RPCRequestPayload,
  expectedAddress?: Address,
  signal?: AbortSignal
) {
  const access = getOriginAccess(payload)
  if (!access) return false
  if (expectedAddress && access.address.toLowerCase() !== expectedAddress.toLowerCase()) return false

  const origin = store('main.origins', payload._origin)
  const networks = (store('main.networks.ethereum') || {}) as Record<number, { id?: number; on?: boolean }>
  const chains = Object.values(networks)
    .filter((network) => network?.on !== false && Number.isSafeInteger(network?.id))
    .map((network) => network.id as number)
  if (origin?.chain?.id && !chains.includes(origin.chain.id)) chains.push(origin.chain.id)

  const proposedPermission = createAccountPermission({
    account: access.address,
    chains,
    handlerId: payload._origin,
    origin: access.origin
  })
  const proposedChains = proposedPermission.caveats[0].value.chains
  const existingPermissionCoversProposal =
    permissionCovers(access.permission, {
      account: access.address,
      handlerId: payload._origin,
      method: 'eth_accounts'
    }) &&
    proposedChains.every((chainId) =>
      permissionCovers(access.permission, {
        account: access.address,
        chainId,
        handlerId: payload._origin,
        method: 'eth_accounts'
      })
    )
  if (existingPermissionCoversProposal) return true

  const permission = await requestPermission(access.address, payload, proposedPermission, signal)
  if (signal?.aborted) return false
  return (
    accountIsCurrent(access.address) &&
    permissionCovers(permission, {
      account: access.address,
      handlerId: payload._origin,
      method: 'eth_accounts'
    })
  )
}

export function updateOrigin(
  requestPayload: JSONRPCRequestPayload,
  origin: string,
  connectionMessage = false,
  invoker: InvokerContext = { provenance: 'direct' }
): OriginUpdateResult {
  const originId = originIdForInvoker(origin, invoker)
  const existingOrigin = store('main.origins', originId)

  if (!connectionMessage) {
    // the extension will attempt to send messages (eth_chainId and net_version) in order
    // to connect. we don't want to store these origins as they'll come from every site
    // the user visits in their browser

    if (existingOrigin) {
      requireStoreAction('addOriginRequest')(originId)
    } else {
      requireStoreAction('initOrigin')(originId, {
        name: origin,
        ...invoker,
        ...(isSessionOnlyOrigin(origin) && { sessionOnly: true }),
        chain: {
          id: 1,
          type: 'ethereum'
        }
      })
    }
  }

  const chainId = requestPayload.chainId || `0x${(existingOrigin?.chain?.id || 1).toString(16)}`

  const payload = {
    ...requestPayload,
    _origin: originId
  }

  if (connectionMessage) {
    payload.chainId = chainId
  }

  return {
    payload,
    chainId
  }
}

export function parseFrameExtension(req: IncomingMessage): FrameExtension | undefined {
  const origin = req.headers.origin || ''
  const query = queryString.parse((req.url || '').replace('/', ''))
  if (query['identity'] !== 'frame-extension') return
  const role = query['role']
  if (role !== 'control' && role !== 'page') return

  const match = /^(chrome-extension|moz-extension|safari-web-extension):\/\/([^/?#]+)$/iu.exec(origin)
  if (!match) return
  const [, scheme, rawId] = match
  if (!scheme || !rawId) return
  const id = rawId.toLowerCase()

  if (scheme.toLowerCase() === 'chrome-extension' && /^[a-p]{32}$/u.test(id)) {
    return { browser: 'chrome', id, role }
  }
  if (
    scheme.toLowerCase() === 'moz-extension' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id)
  ) {
    return { browser: 'firefox', id, role }
  }
  if (dev && scheme.toLowerCase() === 'safari-web-extension' && /^[0-9a-z.-]{1,128}$/u.test(id)) {
    return { browser: 'safari', id, role }
  }

  return
}

export async function isTrusted(payload: RPCRequestPayload, signal?: AbortSignal) {
  // Permissions granted to unknown origins persist only until Wren closes.
  const origin = store('main.origins', payload._origin)
  if (!origin) return false

  const originName = origin.name

  if (origin.provenance === 'internal' && isTrustedOrigin(originName) && isInternalMethod(payload.method)) {
    return true
  }

  if (signal?.aborted) return false

  const params = Array.isArray(payload.params) ? payload.params : []
  const requestedChain = ['wallet_switchEthereumChain', 'wallet_sendCalls', 'eth_sendTransaction'].includes(
    payload.method
  )
    ? (params[0] as { chainId?: unknown } | undefined)?.chainId
    : undefined
  const chainId = requestedChain === undefined ? payload.chainId || origin.chain?.id : requestedChain
  return hasOriginCapability(payload, { chainId: chainId as number | bigint | string })
}
