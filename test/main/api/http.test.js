import { Agent, request } from 'http'

import createHttpServer, {
  handleHttpSubscription,
  HTTP_MAX_QUEUED_SUBSCRIPTION_EVENTS
} from '../../../main/api/http'
import {
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  HTTP_MAX_CONNECTIONS,
  HTTP_NATIVE_AUTH_MAX_REQUEST_BYTES,
  HTTP_MAX_REQUESTS_PER_SOCKET,
  HTTP_REQUEST_TIMEOUT_MS
} from '../../../main/api/http'
import { MAX_REQUEST_BYTES } from '../../../main/api/validPayload'
import provider from '../../../main/provider'
import accounts from '../../../main/accounts'
import { isTrusted, updateOrigin } from '../../../main/api/origins'
import { getRequestSignal } from '../../../main/provider/requestSignal'
import {
  NativeRequestProofSchema,
  authenticateNativeRequest,
  issueNativeChallenge,
  proveNativeChallenge
} from '../../../main/api/nativeAuth'
import { disconnectPeer, resetPeerConnectionsForTests } from '../../../main/api/peerConnections'

jest.mock('../../../main/provider', () => ({ send: jest.fn(), on: jest.fn() }))
jest.mock('../../../main/accounts', () => ({ getSelectedAddresses: jest.fn(() => []) }))
jest.mock('../../../main/store')
jest.mock('../../../main/api/nativeAuth', () => ({
  NativeRequestProofSchema: { parse: jest.fn() },
  authenticateNativeRequest: jest.fn(),
  issueNativeChallenge: jest.fn(),
  proveNativeChallenge: jest.fn()
}))
jest.mock('../../../main/api/nativePairing', () => ({ authorizeNativePeer: jest.fn() }))
jest.mock('../../../main/api/origins', () => ({
  parseOrigin: jest.fn((origin, sessionOrigin = 'Unknown') =>
    !origin ||
    origin === 'null' ||
    origin === 'Unknown' ||
    origin.startsWith('Unknown/') ||
    origin.startsWith('https://Unknown/') ||
    !/^(?:https?|wss?):\/\//.test(origin)
      ? sessionOrigin
      : origin
  ),
  isCanonicalExternalOrigin: jest.fn(
    (origin) =>
      typeof origin === 'string' &&
      /^(?:https?|wss?):\/\//.test(origin) &&
      !origin.startsWith('https://Unknown/')
  ),
  updateOrigin: jest.fn((payload) => ({
    payload: { ...payload, _origin: 'test-origin' },
    chainId: payload.chainId || '0x1'
  })),
  isTrusted: jest.fn()
}))

jest.setTimeout(2000)

let server
let port

beforeEach((done) => {
  resetPeerConnectionsForTests()
  NativeRequestProofSchema.parse.mockReset()
  authenticateNativeRequest.mockReset()
  issueNativeChallenge.mockReset()
  proveNativeChallenge.mockReset()
  provider.send.mockImplementation((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: 'forwarded' })
  )
  accounts.getSelectedAddresses.mockReturnValue([])
  isTrusted.mockResolvedValue(false)

  server = createHttpServer()
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port
    done()
  })
})

beforeAll(() => {
  jest.useRealTimers()
})

afterEach((done) => {
  server.close(done)
})

const send = ({ body = '', method = 'POST', headers, agent, path } = {}) =>
  new Promise((resolve, reject) => {
    const requestHeaders = headers ?? (path?.startsWith('/native/') ? {} : { origin: 'https://example.test' })
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: requestHeaders,
        agent
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks)) })
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })

const sendChunked = (chunks) =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        headers: { origin: 'https://example.test' }
      },
      (res) => {
        const responseChunks = []
        res.on('data', (chunk) => responseChunks.push(chunk))
        res.on('end', () => {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(responseChunks)) })
        })
      }
    )
    req.on('error', reject)
    chunks.forEach((chunk) => req.write(chunk))
    req.end()
  })

const restartServer = (options) =>
  new Promise((resolve) => {
    server.close(() => {
      server = createHttpServer(options)
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port
        resolve()
      })
    })
  })

it('configures explicit connection and timeout limits', () => {
  expect(server.maxConnections).toBe(HTTP_MAX_CONNECTIONS)
  expect(server.headersTimeout).toBe(HTTP_HEADERS_TIMEOUT_MS)
  expect(server.requestTimeout).toBe(HTTP_REQUEST_TIMEOUT_MS)
  expect(server.keepAliveTimeout).toBe(HTTP_KEEP_ALIVE_TIMEOUT_MS)
  expect(server.maxRequestsPerSocket).toBe(HTTP_MAX_REQUESTS_PER_SOCKET)
  expect(server.requestTimeout).toBeGreaterThan(15 * 1000)
})

it('rejects a non-loopback Host header before parsing or forwarding', async () => {
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }

  await expect(
    send({ body: JSON.stringify(payload), headers: { host: 'wallet.attacker.example:1248' } })
  ).resolves.toMatchObject({
    status: 421,
    body: {
      id: null,
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid local RPC host' }
    }
  })
  expect(updateOrigin).not.toHaveBeenCalled()
  expect(provider.send).not.toHaveBeenCalled()
})

it('keeps native challenge routes outside browser CORS', async () => {
  const challenge = { step: 'challenge', expiresAt: 2_000 }
  issueNativeChallenge.mockReturnValue(challenge)
  const body = JSON.stringify({
    installationId: '11111111-1111-4111-8111-111111111111',
    publicKey: {},
    clientNonce: 'nonce'
  })
  const accepted = await send({ path: '/native/v3/challenge', body })
  expect(accepted).toMatchObject({
    status: 200,
    body: challenge
  })
  expect(accepted.headers).not.toHaveProperty('access-control-allow-origin')
  const rejected = await send({
    path: '/native/v3/challenge',
    body,
    headers: { origin: 'https://example.test' }
  })
  expect(rejected).toMatchObject({
    status: 403,
    body: { error: { code: 4100 } }
  })
  expect(rejected.headers).not.toHaveProperty('access-control-allow-origin')
  const preflight = await send({ path: '/native/v3/challenge', method: 'OPTIONS' })
  expect(preflight).toMatchObject({ status: 405 })
  expect(preflight.headers).not.toHaveProperty('access-control-allow-origin')
  expect(issueNativeChallenge).toHaveBeenCalledWith(expect.any(Object), 'http')

  issueNativeChallenge.mockClear()
  const labelled = await send({
    path: '/native/v3/challenge',
    body: JSON.stringify({ ...JSON.parse(body), label: 'untrusted' })
  })
  expect(labelled).toMatchObject({ status: 400, body: { error: { code: -32600 } } })
  expect(issueNativeChallenge).not.toHaveBeenCalled()
})

it('bounds native handshake bodies below the general RPC limit', async () => {
  await expect(
    send({
      path: '/native/v3/challenge',
      body: Buffer.alloc(HTTP_NATIVE_AUTH_MAX_REQUEST_BYTES + 1),
      headers: { 'content-length': HTTP_NATIVE_AUTH_MAX_REQUEST_BYTES + 1 }
    })
  ).resolves.toMatchObject({
    status: 413,
    headers: expect.not.objectContaining({ 'access-control-allow-origin': expect.anything() }),
    body: {
      error: {
        message: `Request exceeds ${HTTP_NATIVE_AUTH_MAX_REQUEST_BYTES} byte limit`
      }
    }
  })
})

it('binds native proofs to the HTTP transport context', async () => {
  proveNativeChallenge.mockResolvedValue({ step: 'authenticated' })
  const response = await send({ path: '/native/v3/prove', body: '{}' })
  expect(response).toMatchObject({ status: 200, body: { step: 'authenticated' } })
  expect(proveNativeChallenge).toHaveBeenCalledWith({}, expect.any(Function), 'http')
})

it('authenticates native HTTP RPC before creating a fingerprint-scoped origin', async () => {
  const body = JSON.stringify({ id: 41, jsonrpc: '2.0', method: 'eth_chainId', params: [] })
  const proof = { sessionId: 'session', nonce: 'nonce' }
  const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64url')
  NativeRequestProofSchema.parse.mockReturnValue(proof)
  authenticateNativeRequest.mockReturnValue({ fingerprint: 'a'.repeat(43) })

  await expect(
    send({
      path: '/native/v3/rpc',
      body,
      headers: { 'x-wren-native-proof': proofHeader }
    })
  ).resolves.toMatchObject({
    status: 200,
    body: { id: 41, result: 'forwarded' }
  })

  expect(authenticateNativeRequest).toHaveBeenCalledWith(proof, '/native/v3/rpc', Buffer.from(body))
  expect(updateOrigin).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'eth_chainId' }),
    'Local app',
    false,
    { provenance: 'native', sourceId: 'a'.repeat(43) }
  )
})

it('rejects missing native HTTP proof without provider or origin work', async () => {
  const body = JSON.stringify({ id: 42, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] })

  await expect(send({ path: '/native/v3/rpc', body })).resolves.toMatchObject({
    status: 401,
    body: { error: { code: 4100, message: 'Native request proof is required' } }
  })
  expect(authenticateNativeRequest).not.toHaveBeenCalled()
  expect(updateOrigin).not.toHaveBeenCalled()
  expect(provider.send).not.toHaveBeenCalled()
})

it('rejects an invalid native HTTP proof without provider or origin work', async () => {
  const body = JSON.stringify({ id: 43, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] })
  const proofHeader = Buffer.from(JSON.stringify({ sessionId: 'invalid' })).toString('base64url')
  NativeRequestProofSchema.parse.mockImplementation(() => {
    throw new Error('invalid proof')
  })

  await expect(
    send({
      path: '/native/v3/rpc',
      body,
      headers: { 'x-wren-native-proof': proofHeader }
    })
  ).resolves.toMatchObject({
    status: 401,
    body: { error: { code: 4100, message: 'Native request proof is required' } }
  })
  expect(authenticateNativeRequest).not.toHaveBeenCalled()
  expect(updateOrigin).not.toHaveBeenCalled()
  expect(provider.send).not.toHaveBeenCalled()
})

it('removes a native HTTP subscription when its exact peer is disconnected', async () => {
  const fingerprint = 'b'.repeat(43)
  const proof = { sessionId: 'session', nonce: 'nonce' }
  const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64url')
  const body = JSON.stringify({
    id: 44,
    jsonrpc: '2.0',
    method: 'eth_subscribe',
    params: ['newHeads'],
    pollId: 'native-owner'
  })
  NativeRequestProofSchema.parse.mockReturnValue(proof)
  authenticateNativeRequest.mockReturnValue({ fingerprint })
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: 'native-upstream-subscription' })
  )

  await expect(
    send({
      path: '/native/v3/rpc',
      body,
      headers: { 'x-wren-native-proof': proofHeader }
    })
  ).resolves.toMatchObject({
    status: 200,
    body: { id: 44, result: expect.stringMatching(/^0x[0-9a-f]{32}$/) }
  })

  provider.send.mockReset()
  disconnectPeer(fingerprint)

  expect(provider.send).toHaveBeenCalledWith({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_unsubscribe',
    params: ['native-upstream-subscription'],
    chainId: '0x1',
    _origin: 'test-origin'
  })
})

it('rejects excess requests before provider forwarding', async () => {
  await restartServer({
    requestRateLimit: { maxRequests: 1, windowMs: 1000 },
    socketRateLimit: { maxRequests: 10, windowMs: 1000 }
  })
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({ status: 200 })
  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 429,
    headers: { 'access-control-allow-origin': '*', connection: 'close' },
    body: {
      id: null,
      jsonrpc: '2.0',
      error: { code: -32005, message: 'Request rate limit exceeded' }
    }
  })
  expect(provider.send).toHaveBeenCalledTimes(1)
})

it('applies the per-socket request rate to reused connections', async () => {
  await restartServer({
    requestRateLimit: { maxRequests: 10, windowMs: 1000 },
    socketRateLimit: { maxRequests: 1, windowMs: 1000 }
  })
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }

  try {
    await expect(send({ body: JSON.stringify(payload), agent })).resolves.toMatchObject({ status: 200 })
    await expect(send({ body: JSON.stringify(payload), agent })).resolves.toMatchObject({
      status: 429,
      body: { error: { code: -32005 } }
    })
  } finally {
    agent.destroy()
  }
  expect(provider.send).toHaveBeenCalledTimes(1)
})

it('returns a JSON-RPC parse error for malformed JSON', async () => {
  await expect(send({ body: '{' })).resolves.toMatchObject({
    status: 400,
    body: { id: null, jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }
  })
})

it('returns an invalid-request error with a valid correlation id', async () => {
  const body = JSON.stringify({ id: 'request-7', jsonrpc: '1.0', method: 'eth_chainId' })

  await expect(send({ body })).resolves.toMatchObject({
    status: 400,
    body: { id: 'request-7', jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' } }
  })
})

it('rejects an oversized declared body before buffering it', async () => {
  await expect(
    send({
      body: Buffer.alloc(MAX_REQUEST_BYTES + 1),
      headers: {
        'content-length': MAX_REQUEST_BYTES + 1,
        origin: 'https://example.test'
      }
    })
  ).resolves.toMatchObject({
    status: 413,
    body: {
      id: null,
      jsonrpc: '2.0',
      error: { code: -32600, message: `Request exceeds ${MAX_REQUEST_BYTES} byte limit` }
    }
  })
})

it('stops buffering an oversized chunked body', async () => {
  await expect(sendChunked([Buffer.alloc(MAX_REQUEST_BYTES), Buffer.alloc(1)])).resolves.toMatchObject({
    status: 413,
    body: {
      id: null,
      jsonrpc: '2.0',
      error: { code: -32600, message: `Request exceeds ${MAX_REQUEST_BYTES} byte limit` }
    }
  })
})

it('returns method-not-allowed for non-JSON-RPC HTTP methods', async () => {
  await expect(send({ method: 'GET' })).resolves.toMatchObject({
    status: 405,
    headers: { allow: 'POST, OPTIONS' },
    body: { id: null, jsonrpc: '2.0', error: { code: -32600, message: 'Method Not Allowed' } }
  })
})

it('forwards a valid request and returns the provider response', async () => {
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 200,
    body: { id: 7, jsonrpc: '2.0', result: 'forwarded' }
  })
  expect(provider.send).toHaveBeenCalledWith({ ...payload, _origin: 'test-origin' }, expect.any(Function))
})

it('does not abort transport ownership after a response completes', async () => {
  let forwarded
  provider.send.mockImplementationOnce((payload, callback) => {
    forwarded = callback
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: 'forwarded' })
  })

  await send({ body: JSON.stringify({ id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }) })
  await new Promise((resolve) => setImmediate(resolve))

  expect(getRequestSignal(forwarded).aborted).toBe(false)
})

it('aborts only the unfinished provider request when its HTTP client disconnects', async () => {
  let forwarded
  let markForwarded
  const requestForwarded = new Promise((resolve) => {
    markForwarded = resolve
  })
  provider.send.mockImplementationOnce((_payload, callback) => {
    forwarded = callback
    markForwarded()
  })

  const client = request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    headers: { origin: 'https://example.test' }
  })
  client.on('error', () => {})
  client.end(JSON.stringify({ id: 8, jsonrpc: '2.0', method: 'eth_chainId', params: [] }))

  await requestForwarded
  const signal = getRequestSignal(forwarded)
  expect(signal.aborted).toBe(false)

  const aborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  const closed = new Promise((resolve) => client.socket.once('close', resolve))
  client.socket.destroy()
  await Promise.all([closed, aborted])

  expect(signal.aborted).toBe(true)
  expect(() => forwarded({ id: 8, jsonrpc: '2.0', result: 'late' })).not.toThrow()
})

it.each([undefined, 'null', 'Unknown/caller-selected', 'https://Unknown/caller-selected', 'legacy.example'])(
  'requires native protocol 3 for a non-browser local Origin %s',
  async (origin) => {
    const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }
    const headers = origin === undefined ? {} : { origin }

    await expect(send({ body: JSON.stringify(payload), headers })).resolves.toMatchObject({
      status: 401,
      body: {
        id: null,
        error: {
          code: 4100,
          message: 'Wren requires a paired native protocol 3 client for local requests.'
        }
      }
    })
    expect(updateOrigin).not.toHaveBeenCalled()
    expect(provider.send).not.toHaveBeenCalled()
  }
)

it.each([
  ['/native/v2/rpc', 401, 4100],
  ['/native/v3/typo', 401, 4100],
  ['/other', 404, -32601]
])('rejects unsupported local RPC route %s without forwarding', async (path, status, code) => {
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [] }

  await expect(send({ path, body: JSON.stringify(payload), headers: {} })).resolves.toMatchObject({
    status,
    body: { error: { code } }
  })
  expect(updateOrigin).not.toHaveBeenCalled()
  expect(provider.send).not.toHaveBeenCalled()
})

it('rejects a non-canonical target chain before provider forwarding', async () => {
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_chainId', params: [], chainId: '0x01' }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 200,
    body: { id: 7, jsonrpc: '2.0', error: { code: -32602 } }
  })
  expect(provider.send).not.toHaveBeenCalled()
  expect(updateOrigin).not.toHaveBeenCalled()
})

it('forwards passive account probes without opening origin access', async () => {
  accounts.getSelectedAddresses.mockReturnValue(['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'])
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_accounts', params: [] }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 200,
    body: { id: 7, jsonrpc: '2.0', result: 'forwarded' }
  })
  expect(isTrusted).not.toHaveBeenCalled()
  expect(provider.send).toHaveBeenCalled()
})

it('forwards explicit account consent without a standing capability check', async () => {
  accounts.getSelectedAddresses.mockReturnValue(['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'])
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_requestAccounts', params: [] }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 200,
    body: { id: 7, jsonrpc: '2.0', result: 'forwarded' }
  })
  expect(isTrusted).not.toHaveBeenCalled()
  expect(provider.send).toHaveBeenCalled()
})

it('uses unauthorized rather than user-rejected when a chain switch lacks permission', async () => {
  accounts.getSelectedAddresses.mockReturnValue(['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'])
  const payload = {
    id: 7,
    jsonrpc: '2.0',
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x1' }]
  }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 200,
    body: { id: 7, jsonrpc: '2.0', error: { code: 4100 } }
  })
  expect(provider.send).not.toHaveBeenCalled()
})

it.each(['caip_request', 'wallet_request'])(
  'returns the provider unsupported-method response for removed %s envelopes',
  async (method) => {
    accounts.getSelectedAddresses.mockReturnValue(['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'])
    const payload = {
      id: 7,
      jsonrpc: '2.0',
      method,
      params: {
        chainId: 'eip155:1',
        session: 'session',
        request: { method: 'personal_sign', params: ['message'] }
      }
    }

    provider.send.mockImplementationOnce((requestPayload, response) =>
      response({
        id: requestPayload.id,
        jsonrpc: '2.0',
        error: {
          code: 4200,
          message: `${method} is no longer supported. Send the inner EIP-1193 method directly and use a top-level hexadecimal chainId.`
        }
      })
    )

    await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
      status: 200,
      body: { id: 7, error: { code: 4200 } }
    })
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ method, _origin: 'test-origin' }),
      expect.any(Function)
    )
  }
)

it('returns after rejecting an invalid polling client id', async () => {
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_pollSubscriptions', params: [7] }

  await expect(send({ body: JSON.stringify(payload) })).resolves.toMatchObject({
    status: 200,
    body: { id: 7, jsonrpc: '2.0', error: { code: -32602, message: 'Invalid Client ID' } }
  })
  expect(provider.send).not.toHaveBeenCalled()
})

it('isolates aliased subscription events and unsubscribe by canonical origin', async () => {
  const pollId = 'owner-client'
  const upstreamId = 'upstream-http-subscription'
  provider.send.mockImplementation((payload, callback) => {
    if (payload.method === 'eth_subscribe') {
      callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: upstreamId })
    } else if (payload.method === 'eth_unsubscribe') {
      callback?.({ id: payload.id, jsonrpc: payload.jsonrpc, result: true })
    }
  })

  const subscribeResponse = await send({
    body: JSON.stringify({
      id: 10,
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: ['newHeads'],
      pollId
    })
  })
  const alias = subscribeResponse.body.result
  expect(alias).toMatch(/^0x[0-9a-f]{32}$/)
  expect(alias).not.toBe(upstreamId)

  handleHttpSubscription(
    {
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: { subscription: upstreamId, result: { number: '0x1' } }
    },
    { id: 1 }
  )

  updateOrigin.mockImplementationOnce((payload) => ({
    payload: { ...payload, _origin: 'other-origin' },
    chainId: payload.chainId || '0x1'
  }))
  const otherPoll = await send({
    body: JSON.stringify({
      id: 11,
      jsonrpc: '2.0',
      method: 'eth_pollSubscriptions',
      params: [pollId, 'immediate']
    })
  })
  expect(otherPoll.body.result).toEqual([])

  const ownerPoll = await send({
    body: JSON.stringify({
      id: 12,
      jsonrpc: '2.0',
      method: 'eth_pollSubscriptions',
      params: [pollId, 'immediate']
    })
  })
  expect(ownerPoll.body.result).toHaveLength(1)
  expect(JSON.parse(ownerPoll.body.result[0]).params.subscription).toBe(alias)

  provider.send.mockClear()
  updateOrigin.mockImplementationOnce((payload) => ({
    payload: { ...payload, _origin: 'other-origin' },
    chainId: payload.chainId || '0x1'
  }))
  const denied = await send({
    body: JSON.stringify({ id: 13, jsonrpc: '2.0', method: 'eth_unsubscribe', params: [alias] })
  })
  expect(denied.body.result).toBe(false)
  expect(provider.send).not.toHaveBeenCalled()

  const removed = await send({
    body: JSON.stringify({ id: 14, jsonrpc: '2.0', method: 'eth_unsubscribe', params: [alias] })
  })
  expect(removed.body.result).toBe(true)
  expect(provider.send).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'eth_unsubscribe', params: [upstreamId], chainId: '0x1' }),
    expect.any(Function)
  )
})

it('fails closed and unsubscribes when an HTTP subscription queue overflows', async () => {
  const pollId = 'overflow-client'
  const upstreamId = 'upstream-overflow'
  provider.send.mockImplementation((payload, callback) => {
    if (payload.method === 'eth_subscribe') {
      callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: upstreamId })
    }
  })
  const subscribeResponse = await send({
    body: JSON.stringify({
      id: 20,
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: ['newHeads'],
      pollId
    })
  })
  expect(subscribeResponse.body.result).toMatch(/^0x[0-9a-f]{32}$/)
  provider.send.mockClear()

  for (let index = 0; index <= HTTP_MAX_QUEUED_SUBSCRIPTION_EVENTS; index += 1) {
    handleHttpSubscription(
      {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: { subscription: upstreamId, result: { number: `0x${index.toString(16)}` } }
      },
      { id: 1 }
    )
  }

  expect(provider.send).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'eth_unsubscribe', params: [upstreamId], chainId: '0x1' })
  )
  const poll = await send({
    body: JSON.stringify({
      id: 21,
      jsonrpc: '2.0',
      method: 'eth_pollSubscriptions',
      params: [pollId, 'immediate']
    })
  })
  expect(poll.body.error).toEqual({ code: -32005, message: 'Subscription queue limit exceeded' })
})

it('unsubscribes a late subscription result after its HTTP client disconnects', async () => {
  let forwarded
  let markForwarded
  const requestForwarded = new Promise((resolve) => {
    markForwarded = resolve
  })
  provider.send.mockImplementation((payload, callback) => {
    if (payload.method === 'eth_subscribe') {
      forwarded = callback
      markForwarded()
    }
  })
  const client = request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    headers: { origin: 'https://example.test' }
  })
  client.on('error', () => {})
  client.end(
    JSON.stringify({
      id: 30,
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: ['newHeads'],
      pollId: 'late-client'
    })
  )

  await requestForwarded
  const signal = getRequestSignal(forwarded)
  const aborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  client.socket.destroy()
  await aborted
  provider.send.mockClear()

  forwarded({ id: 30, jsonrpc: '2.0', result: 'late-upstream-subscription' })

  expect(provider.send).toHaveBeenCalledWith({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_unsubscribe',
    params: ['late-upstream-subscription'],
    chainId: '0x1',
    _origin: 'test-origin'
  })
})

it('rejects a malformed upstream HTTP subscription result', async () => {
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: true })
  )

  await expect(
    send({
      body: JSON.stringify({
        id: 31,
        jsonrpc: '2.0',
        method: 'eth_subscribe',
        params: ['newHeads'],
        pollId: 'malformed-client'
      })
    })
  ).resolves.toMatchObject({
    body: { error: { code: -32603, message: 'Invalid subscription response' } }
  })
})
