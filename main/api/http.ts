import http, { IncomingMessage, ServerResponse } from 'http'
import log from 'electron-log'
import { z } from 'zod'

import provider from '../provider'
import accounts from '../accounts'
import type { Chain } from '../chains'

import { createSessionOrigin, isTrusted, parseOrigin, requiresSessionOrigin, updateOrigin } from './origins'
import parsePayload, { JsonRpcError, MAX_REQUEST_BYTES } from './validPayload'
import { requiresStandingCapability } from './protectedMethods'
import { parseChainId } from '../provider/chainRequests'
import originSessions from './originSessions'
import { FixedWindowRateLimiter, RateLimitOptions } from './requestLimiter'
import { bindRequestSignal } from '../provider/requestSignal'
import { isFrameSubscriptionType } from '../provider/subscriptions'
import { toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { isValidUpstreamSubscriptionId, TransportSubscriptionRegistry } from './subscriptionRegistry'
import { isAllowedLocalRpcHost } from './localHost'
import {
  NativeRequestProofSchema,
  authenticateNativeRequest,
  issueNativeChallenge,
  proveNativeChallenge,
  type NativeAuthSession
} from './nativeAuth'
import { authorizeNativePeer } from './nativePairing'
import { registerPeerCleanup } from './peerConnections'

const logTraffic = process.env['LOG_TRAFFIC']

interface PendingRequest {
  send: () => void
  timer: NodeJS.Timeout
}

interface PollClient {
  originId: string
  pollId: string
  events: string[]
  eventBytes: number
  overflowed: boolean
  pending?: PendingRequest
  cleanupTimer?: NodeJS.Timeout
  peerFingerprint?: string
  unregisterPeerCleanup?: () => void
}

interface HTTPPollingPayload extends JSONRPCRequestPayload {
  pollId?: string
}

const pollClients = new Map<string, PollClient>()
const subscriptions = new TransportSubscriptionRegistry<PollClient>()
const socketOrigins = new WeakMap<IncomingMessage['socket'], string>()
const nativePaths = new Set(['/native/v3/challenge', '/native/v3/prove', '/native/v3/rpc'])

export const HTTP_MAX_CONNECTIONS = 128
export const HTTP_HEADERS_TIMEOUT_MS = 10 * 1000
export const HTTP_REQUEST_TIMEOUT_MS = 30 * 1000
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5 * 1000
export const HTTP_MAX_REQUESTS_PER_SOCKET = 1000
export const HTTP_REQUEST_RATE_LIMIT: RateLimitOptions = { maxRequests: 3000, windowMs: 10 * 1000 }
export const HTTP_SOCKET_RATE_LIMIT: RateLimitOptions = { maxRequests: 300, windowMs: 10 * 1000 }
export const HTTP_MAX_POLL_CLIENTS = 256
export const HTTP_MAX_SUBSCRIPTIONS_PER_POLL_CLIENT = 128
export const HTTP_MAX_QUEUED_SUBSCRIPTION_EVENTS = 256
export const HTTP_MAX_QUEUED_SUBSCRIPTION_BYTES = 4 * 1024 * 1024
export const HTTP_POLL_IDLE_TIMEOUT_MS = 20 * 1000
export const HTTP_LONG_POLL_TIMEOUT_MS = 15 * 1000
export const HTTP_MAX_POLL_ID_BYTES = 128
export const HTTP_NATIVE_AUTH_MAX_REQUEST_BYTES = 16 * 1024

interface HTTPServerOptions {
  requestRateLimit?: RateLimitOptions
  socketRateLimit?: RateLimitOptions
}

const requestOrigin = (req: IncomingMessage) => {
  if (!requiresSessionOrigin(req.headers.origin)) return parseOrigin(req.headers.origin)

  let origin = socketOrigins.get(req.socket)
  if (!origin) {
    origin = createSessionOrigin()
    socketOrigins.set(req.socket, origin)
  }

  return parseOrigin(req.headers.origin, origin)
}

const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const NativeChallengeRequestSchema = z
  .object({
    installationId: z.unknown(),
    publicKey: z.unknown(),
    clientNonce: z.unknown()
  })
  .strict()

const parseJson = (body: Buffer) => {
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    return
  }
}

const nativeProofHeader = (req: IncomingMessage) => {
  const header = req.headers['x-wren-native-proof']
  if (typeof header !== 'string' || header.length > 16 * 1024) return
  try {
    const bytes = Buffer.from(header, 'base64url')
    if (bytes.toString('base64url') !== header) return
    return NativeRequestProofSchema.parse(JSON.parse(bytes.toString('utf8')))
  } catch {
    return
  }
}

const nativeOriginName = (_session: NativeAuthSession) => 'Local app'

const sendTransportError = (
  res: ServerResponse,
  status: number,
  id: string | number | null,
  error: JsonRpcError
) => sendJson(res, status, { id, jsonrpc: '2.0', error })

const rejectOversizedRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  maximumBytes = MAX_REQUEST_BYTES
) => {
  res.setHeader('Connection', 'close')
  res.once('finish', () => req.destroy())
  sendTransportError(res, 413, null, {
    code: -32600,
    message: `Request exceeds ${maximumBytes} byte limit`
  })
}

const rejectRateLimitedRequest = (req: IncomingMessage, res: ServerResponse) => {
  const requestPath = (req.url || '/').split('?')[0] || '/'
  if (!nativePaths.has(requestPath)) res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Connection', 'close')
  res.once('finish', () => req.destroy())
  sendTransportError(res, 429, null, { code: -32005, message: 'Request rate limit exceeded' })
}

const validPollId = (value: unknown): value is string =>
  typeof value === 'string' &&
  Buffer.byteLength(value, 'utf8') <= HTTP_MAX_POLL_ID_BYTES &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)

const pollClientKey = (originId: string, pollId: string) => `${originId}\u0000${pollId}`

const unsubscribe = (subscription: ReturnType<typeof subscriptions.forOwner>[number]) => {
  provider.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_unsubscribe',
    params: [subscription.upstreamId],
    chainId: subscription.chainId,
    _origin: subscription.originId
  })
}

const removePollClient = (client: PollClient) => {
  const key = pollClientKey(client.originId, client.pollId)
  if (pollClients.get(key) !== client) return

  clearTimeout(client.pending?.timer)
  clearTimeout(client.cleanupTimer)
  subscriptions.forOwner(client).forEach((subscription) => {
    unsubscribe(subscription)
    subscriptions.remove(subscription.id)
  })
  pollClients.delete(key)
  client.unregisterPeerCleanup?.()
}

const schedulePollCleanup = (client: PollClient) => {
  clearTimeout(client.cleanupTimer)
  client.cleanupTimer = setTimeout(() => removePollClient(client), HTTP_POLL_IDLE_TIMEOUT_MS)
  client.cleanupTimer.unref()
}

const getPollClient = (originId: string, pollId: string, create = false, peerFingerprint?: string) => {
  const key = pollClientKey(originId, pollId)
  const existing = pollClients.get(key)
  if (existing || !create || pollClients.size >= HTTP_MAX_POLL_CLIENTS) return existing

  const client: PollClient = {
    originId,
    pollId,
    events: [],
    eventBytes: 0,
    overflowed: false,
    ...(peerFingerprint && { peerFingerprint })
  }
  if (peerFingerprint) {
    client.unregisterPeerCleanup = registerPeerCleanup(peerFingerprint, () => removePollClient(client))
  }
  pollClients.set(key, client)
  schedulePollCleanup(client)
  return client
}

const overflowPollClient = (client: PollClient) => {
  if (client.overflowed) return
  client.overflowed = true
  client.events = []
  client.eventBytes = 0
  subscriptions.forOwner(client).forEach((subscription) => {
    unsubscribe(subscription)
    subscriptions.remove(subscription.id)
  })
  client.pending?.send()
}

const handler = (req: IncomingMessage, res: ServerResponse) => {
  if (!isAllowedLocalRpcHost(req.headers.host, req.socket.localPort)) {
    return sendTransportError(res, 421, null, {
      code: -32600,
      message: 'Invalid local RPC host'
    })
  }

  const requestPath = (req.url || '/').split('?')[0] || '/'
  const nativePath = nativePaths.has(requestPath)
  if (nativePath && req.headers.origin !== undefined) {
    return sendTransportError(res, 403, null, {
      code: 4100,
      message: 'Native authentication is not available to browser origins'
    })
  }
  if (!nativePath) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept'
    )
  }
  if (req.method === 'OPTIONS') {
    if (nativePath) {
      return sendTransportError(res, 405, null, { code: -32600, message: 'Method Not Allowed' })
    }
    res.writeHead(200)
    res.end()
  } else if (req.method === 'POST') {
    const maximumBytes =
      requestPath === '/native/v3/challenge' || requestPath === '/native/v3/prove'
        ? HTTP_NATIVE_AUTH_MAX_REQUEST_BYTES
        : MAX_REQUEST_BYTES
    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      return rejectOversizedRequest(req, res, maximumBytes)
    }

    const body: Buffer[] = []
    let bodySize = 0
    let rejected = false

    req
      .on('data', (chunk: Buffer) => {
        if (rejected) return

        bodySize += chunk.length
        if (bodySize > maximumBytes) {
          rejected = true
          body.length = 0
          rejectOversizedRequest(req, res, maximumBytes)
          return
        }

        body.push(chunk)
      })
      .on('end', async () => {
        if (rejected) return

        res.on('error', (err) => console.error('res err', err))
        const bodyBytes = Buffer.concat(body)
        if (requestPath === '/native/v3/challenge') {
          const challengeInput = NativeChallengeRequestSchema.safeParse(parseJson(bodyBytes))
          if (!challengeInput.success) {
            return sendTransportError(res, 400, null, {
              code: -32600,
              message: 'Invalid native challenge request'
            })
          }
          try {
            return sendJson(res, 200, issueNativeChallenge(challengeInput.data, 'http'))
          } catch {
            return sendTransportError(res, 400, null, {
              code: 4100,
              message: 'Native challenge request was rejected'
            })
          }
        }
        if (requestPath === '/native/v3/prove') {
          const controller = new AbortController()
          req.socket.once('close', () => controller.abort())
          try {
            const result = await proveNativeChallenge(
              parseJson(bodyBytes),
              (credential, code) => authorizeNativePeer(credential, code, controller.signal),
              'http'
            )
            if (controller.signal.aborted) return
            return sendJson(res, 200, result)
          } catch {
            if (controller.signal.aborted) return
            return sendTransportError(res, 401, null, {
              code: 4100,
              message: 'Native authentication failed'
            })
          }
        }

        let nativeSession: NativeAuthSession | undefined
        if (requestPath === '/native/v3/rpc') {
          const proof = nativeProofHeader(req)
          if (!proof) {
            return sendTransportError(res, 401, null, {
              code: 4100,
              message: 'Native request proof is required'
            })
          }
          try {
            nativeSession = authenticateNativeRequest(proof, requestPath, bodyBytes)
          } catch {
            return sendTransportError(res, 401, null, {
              code: 4100,
              message: 'Native request proof is invalid'
            })
          }
        }

        const data = bodyBytes.toString()
        const parsedPayload = parsePayload<HTTPPollingPayload>(data)
        if (!parsedPayload.success) {
          return sendTransportError(res, 400, parsedPayload.id, parsedPayload.error)
        }
        const rawPayload = parsedPayload.payload

        if (logTraffic)
          log.info(
            `req -> | http | ${req.headers.origin} | ${rawPayload.method} | -> | ${JSON.stringify(
              rawPayload.params
            )}`
          )

        if (rawPayload.chainId !== undefined) {
          try {
            parseChainId(rawPayload.chainId)
          } catch {
            return sendTransportError(res, 200, rawPayload.id, {
              message: `Invalid chain id (${rawPayload.chainId}), chain id must be a canonical hex quantity`,
              code: -32602
            })
          }
        }

        const origin = nativeSession ? nativeOriginName(nativeSession) : requestOrigin(req)
        const invoker = nativeSession
          ? { provenance: 'native' as const, sourceId: nativeSession.fingerprint }
          : { provenance: 'direct' as const }
        const { payload, chainId } = updateOrigin(rawPayload, origin, false, invoker)

        try {
          parseChainId(chainId)
        } catch {
          return sendTransportError(res, 200, payload.id, {
            message: `Invalid chain id (${rawPayload.chainId}), chain id must be a canonical hex quantity`,
            code: -32602
          })
        }

        originSessions.extend(payload._origin)

        const controller = new AbortController()
        const unregisterNativeCleanup = nativeSession
          ? registerPeerCleanup(nativeSession.fingerprint, () => controller.abort())
          : undefined
        const abortIfUnfinished = () => {
          if (!res.writableFinished) controller.abort()
        }
        req.socket.once('close', abortIfUnfinished)
        res.once('close', abortIfUnfinished)
        res.once('finish', () => {
          req.socket.removeListener('close', abortIfUnfinished)
          unregisterNativeCleanup?.()
        })
        const respond = bindRequestSignal((response: RPCResponsePayload) => {
          if (controller.signal.aborted || res.writableEnded) return
          if (logTraffic)
            log.info(
              `<- res | http | ${req.headers.origin} | ${payload.method} | <- | ${JSON.stringify(response)}`
            )
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response))
        }, controller.signal)

        const trusted =
          !requiresStandingCapability(payload.method) || (await isTrusted(payload, controller.signal))
        if (controller.signal.aborted) return

        if (!trusted) {
          let error = { message: 'Origin is not authorized', code: 4100 }
          if (!accounts.getSelectedAddresses()[0]) error = { message: 'No Wren account selected', code: 4100 }
          respond({ id: payload.id, jsonrpc: payload.jsonrpc, error })
        } else {
          if (payload.method === 'eth_pollSubscriptions') {
            const params = Array.isArray(payload.params) ? payload.params : []
            const pollId = params[0]
            if (!validPollId(pollId)) {
              return respond({
                id: payload.id,
                jsonrpc: payload.jsonrpc,
                error: { code: -32602, message: 'Invalid Client ID' }
              })
            }
            const client = getPollClient(payload._origin, pollId, true, nativeSession?.fingerprint)
            if (!client) {
              return respond({
                id: payload.id,
                jsonrpc: payload.jsonrpc,
                error: { code: -32005, message: 'Subscription client limit exceeded' }
              })
            }
            if (client.pending) {
              return respond({
                id: payload.id,
                jsonrpc: payload.jsonrpc,
                error: { code: -32000, message: 'Subscription poll already pending' }
              })
            }

            const immediate = params[1] === 'immediate'
            const send = (force: boolean) => {
              if (client.overflowed) {
                respond({
                  id: payload.id,
                  jsonrpc: payload.jsonrpc,
                  error: { code: -32005, message: 'Subscription queue limit exceeded' }
                })
                return removePollClient(client)
              }

              if (client.events.length || immediate || force) {
                const result = client.events
                client.events = []
                client.eventBytes = 0
                if (client.pending) {
                  clearTimeout(client.pending.timer)
                  delete client.pending
                }
                const response = { id: payload.id, jsonrpc: payload.jsonrpc, result }
                respond(response)
                schedulePollCleanup(client)
              } else {
                const sendResponse = () => {
                  if (client.pending !== pendingRequest) return
                  send(true)
                }

                const pendingRequest = {
                  send: sendResponse,
                  timer: setTimeout(sendResponse, HTTP_LONG_POLL_TIMEOUT_MS)
                }
                client.pending = pendingRequest
                controller.signal.addEventListener(
                  'abort',
                  () => {
                    if (client.pending !== pendingRequest) return
                    clearTimeout(pendingRequest.timer)
                    delete client.pending
                    schedulePollCleanup(client)
                  },
                  { once: true }
                )
              }
            }
            return send(false)
          }

          const params = Array.isArray(payload.params) ? payload.params : []
          const pollId = rawPayload.pollId
          if (payload.method === 'eth_subscribe' && !validPollId(pollId)) {
            return respond({
              id: payload.id,
              jsonrpc: payload.jsonrpc,
              error: { code: -32602, message: 'Invalid subscription client ID' }
            })
          }

          const requestedSubscriptionId = params[0]
          const ownedSubscription =
            payload.method === 'eth_unsubscribe' && typeof requestedSubscriptionId === 'string'
              ? subscriptions.getOwned(
                  requestedSubscriptionId,
                  (subscription) =>
                    subscription.originId === payload._origin && subscription.chainId === chainId
                )
              : undefined
          if (payload.method === 'eth_unsubscribe' && !ownedSubscription) {
            return respond({ id: payload.id, jsonrpc: payload.jsonrpc, result: false })
          }

          const forwardedPayload = ownedSubscription
            ? {
                ...payload,
                chainId: ownedSubscription.chainId,
                params: [ownedSubscription.upstreamId]
              }
            : payload

          provider.send(
            forwardedPayload,
            bindRequestSignal((response) => {
              let transportResponse = response
              if (payload.method === 'eth_subscribe') {
                if (response.error) {
                  transportResponse = response
                } else if (!isValidUpstreamSubscriptionId(response.result)) {
                  transportResponse = {
                    id: payload.id,
                    jsonrpc: payload.jsonrpc,
                    error: { code: -32603, message: 'Invalid subscription response' }
                  }
                } else if (controller.signal.aborted) {
                  provider.send({
                    id: 1,
                    jsonrpc: '2.0',
                    method: 'eth_unsubscribe',
                    params: [response.result],
                    chainId,
                    _origin: payload._origin
                  })
                  return
                } else {
                  const client = getPollClient(
                    payload._origin,
                    pollId as string,
                    true,
                    nativeSession?.fingerprint
                  )
                  const subscriptionCount = client ? subscriptions.forOwner(client).length : 0
                  const subscription =
                    client && subscriptionCount < HTTP_MAX_SUBSCRIPTIONS_PER_POLL_CLIENT
                      ? subscriptions.register({
                          upstreamId: response.result,
                          originId: payload._origin,
                          chainId,
                          internal: isFrameSubscriptionType(params[0]),
                          owner: client
                        })
                      : undefined
                  if (!client || subscriptionCount >= HTTP_MAX_SUBSCRIPTIONS_PER_POLL_CLIENT) {
                    provider.send({
                      id: 1,
                      jsonrpc: '2.0',
                      method: 'eth_unsubscribe',
                      params: [response.result],
                      chainId,
                      _origin: payload._origin
                    })
                    transportResponse = {
                      id: payload.id,
                      jsonrpc: payload.jsonrpc,
                      error: { code: -32005, message: 'Subscription client limit exceeded' }
                    }
                  } else if (!subscription) {
                    provider.send({
                      id: 1,
                      jsonrpc: '2.0',
                      method: 'eth_unsubscribe',
                      params: [response.result],
                      chainId,
                      _origin: payload._origin
                    })
                    transportResponse = {
                      id: payload.id,
                      jsonrpc: payload.jsonrpc,
                      error: { code: -32603, message: 'Invalid subscription response' }
                    }
                  } else {
                    schedulePollCleanup(client)
                    transportResponse = { ...response, result: subscription.id }
                  }
                }
              } else if (response && response.result && payload.method === 'eth_unsubscribe') {
                if (ownedSubscription) subscriptions.remove(ownedSubscription.id)
              }

              respond(transportResponse)
            }, controller.signal)
          )
        }
      })
      .on('error', (error) => {
        log.warn('HTTP request stream failed', error)
        if (!res.headersSent) {
          sendTransportError(res, 400, null, { code: -32603, message: 'Internal error' })
        }
      })
  } else {
    res.setHeader('Allow', 'POST, OPTIONS')
    sendTransportError(res, 405, null, { code: -32600, message: 'Method Not Allowed' })
  }
}

const withRateLimits = (
  requestHandler: typeof handler,
  requestRateLimit: RateLimitOptions,
  socketRateLimit: RateLimitOptions
) => {
  const requests = new FixedWindowRateLimiter(requestRateLimit)
  const socketRequests = new WeakMap<IncomingMessage['socket'], FixedWindowRateLimiter>()

  return (req: IncomingMessage, res: ServerResponse) => {
    let socketLimiter = socketRequests.get(req.socket)
    if (!socketLimiter) {
      socketLimiter = new FixedWindowRateLimiter(socketRateLimit)
      socketRequests.set(req.socket, socketLimiter)
    }

    if (!requests.allow() || !socketLimiter.allow()) {
      return rejectRateLimitedRequest(req, res)
    }
    return requestHandler(req, res)
  }
}

export const handleHttpSubscription = (payload: RPC.Susbcription.Response, chain?: Chain) => {
  const chainId = chain ? toRpcQuantity(BigInt(chain.id)) : undefined
  subscriptions.forEvent(payload.params.subscription, chainId).forEach((subscription) => {
    const client = subscription.owner
    const event = JSON.stringify({
      ...payload,
      params: { ...payload.params, subscription: subscription.id }
    })
    const eventBytes = Buffer.byteLength(event, 'utf8')
    if (
      client.events.length >= HTTP_MAX_QUEUED_SUBSCRIPTION_EVENTS ||
      eventBytes > HTTP_MAX_QUEUED_SUBSCRIPTION_BYTES ||
      client.eventBytes + eventBytes > HTTP_MAX_QUEUED_SUBSCRIPTION_BYTES
    ) {
      return overflowPollClient(client)
    }

    client.events.push(event)
    client.eventBytes += eventBytes
    client.pending?.send()
  })
}

provider.on('data:subscription', handleHttpSubscription)

export default function (options: HTTPServerOptions = {}) {
  const server = http.createServer(
    withRateLimits(
      handler,
      options.requestRateLimit ?? HTTP_REQUEST_RATE_LIMIT,
      options.socketRateLimit ?? HTTP_SOCKET_RATE_LIMIT
    )
  )
  server.maxConnections = HTTP_MAX_CONNECTIONS
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS
  server.maxRequestsPerSocket = HTTP_MAX_REQUESTS_PER_SOCKET
  return server
}
