import { generateKeyPairSync, sign } from 'crypto'
import WebSocket from 'ws'
import { EventEmitter } from 'stream'

import store from '../../../main/store'
import provider from '../../../main/provider'
import accounts from '../../../main/accounts'
import ws, {
  disconnectExtensionCredential,
  handleWebSocketSubscription,
  WS_MAX_BUFFERED_SUBSCRIPTION_BYTES
} from '../../../main/api/ws'
import { MAX_REQUEST_BYTES } from '../../../main/api/validPayload'
import { getRequestSignal } from '../../../main/provider/requestSignal'
import { extensionAuthPayload, extensionKeyFingerprint } from '../../../main/api/extensionAuth'
import { respondToExtensionPairing } from '../../../main/api/extensionPairing'

let socketConnection, mockSocket, authenticatedResponse

const extensionRequest = {
  headers: {
    origin: 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
  },
  url: '/?identity=frame-extension&role=control'
}

const regularRequest = { headers: { origin: 'https://example.test' } }
const extensionKeyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const exportedExtensionKey = extensionKeyPair.publicKey.export({ format: 'jwk' })
const extensionPublicKey = {
  kty: 'EC',
  crv: 'P-256',
  x: exportedExtensionKey.x,
  y: exportedExtensionKey.y,
  ext: true,
  key_ops: ['verify']
}
const extensionFingerprint = extensionKeyFingerprint(extensionPublicKey)
const extensionInstallationId = '7a86842f-7c01-4d0d-b0f7-fc04e0acfd8f'
const flushPromises = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

const authenticateExtension = async (socket) => {
  socket.emit(
    'message',
    JSON.stringify({
      type: 'frame-auth',
      version: 2,
      step: 'hello',
      clientNonce: Buffer.alloc(32, 1).toString('base64url'),
      installationId: extensionInstallationId,
      publicKey: extensionPublicKey
    })
  )
  await flushPromises()
  const challenge = JSON.parse(socket.send.mock.calls.at(-1)[0])
  const signature = sign('sha256', extensionAuthPayload(challenge), {
    key: extensionKeyPair.privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  socket.emit(
    'message',
    JSON.stringify({
      type: 'frame-auth',
      version: 2,
      step: 'proof',
      challengeId: challenge.challengeId,
      signature
    })
  )
  await flushPromises()
  return JSON.parse(socket.send.mock.calls.at(-1)[0])
}

jest.mock('ws')
jest.mock('../../../main/store')
jest.mock('../../../main/provider', () => ({ on: jest.fn(), send: jest.fn() }))
jest.mock('../../../main/accounts', () => ({ getSelectedAddresses: jest.fn(() => []) }))
jest.mock('../../../main/windows', () => {})

beforeEach(async () => {
  provider.send.mockReset()
  provider.on.mockReset()
  store.initOrigin = jest.fn()
  store.notify = jest.fn((notification, data) => {
    store.set('view.notify', notification)
    store.set('view.notifyData', data)
  })
  store.setExtensionCredential = jest.fn()
  store.set('main.extensionCredentials', {
    [extensionFingerprint]: {
      protocolVersion: 2,
      installationId: extensionInstallationId,
      browser: 'chrome',
      extensionId: 'ldcoohedfbjoobcadoglnnmmfbdlmmhf',
      publicKey: extensionPublicKey,
      fingerprint: extensionFingerprint,
      pairedAt: 1_000
    }
  })
  accounts.getSelectedAddresses.mockReturnValue([])

  socketConnection = new EventEmitter()
  mockSocket = new EventEmitter()
  mockSocket.readyState = WebSocket.OPEN
  mockSocket.close = jest.fn()
  mockSocket.send = jest.fn()

  WebSocket.Server.mockReturnValueOnce(socketConnection)

  ws()
  const options = WebSocket.Server.mock.calls.at(-1)[0]
  expect(
    options.verifyClient({ req: { headers: { host: '127.0.0.1:1248' }, socket: { localPort: 1248 } } })
  ).toBe(true)
  expect(
    options.verifyClient({
      req: { headers: { host: 'wallet.attacker.example:1248' }, socket: { localPort: 1248 } }
    })
  ).toBe(false)
  socketConnection.emit('connection', mockSocket, extensionRequest)
  authenticatedResponse = await authenticateExtension(mockSocket)
  mockSocket.send.mockClear()
})

afterEach(() => mockSocket.emit('close'))

it('requires and accepts a signed companion authentication handshake', () => {
  expect(authenticatedResponse).toEqual({
    type: 'frame-auth',
    version: 2,
    step: 'authenticated',
    fingerprint: extensionFingerprint
  })
  expect(mockSocket.close).not.toHaveBeenCalled()
})

it('disconnects an authenticated companion when its credential is revoked', () => {
  let callback
  provider.send.mockImplementationOnce((_payload, response) => {
    callback = response
  })
  mockSocket.emit(
    'message',
    JSON.stringify({ id: 12, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] })
  )
  expect(getRequestSignal(callback).aborted).toBe(false)

  disconnectExtensionCredential(extensionFingerprint)

  expect(getRequestSignal(callback).aborted).toBe(true)
  expect(mockSocket.close).toHaveBeenCalledWith(1008, 'Extension credential revoked')
  provider.send.mockClear()
  mockSocket.emit(
    'message',
    JSON.stringify({ id: 13, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] })
  )
  expect(provider.send).not.toHaveBeenCalled()
})

it('rejects extension RPC before authentication', async () => {
  const unauthenticated = new EventEmitter()
  unauthenticated.readyState = WebSocket.OPEN
  unauthenticated.close = jest.fn()
  unauthenticated.send = jest.fn()
  socketConnection.emit('connection', unauthenticated, extensionRequest)

  unauthenticated.emit(
    'message',
    JSON.stringify({ id: 9, jsonrpc: '2.0', method: 'eth_chainId', params: [] })
  )
  await flushPromises()

  expect(JSON.parse(unauthenticated.send.mock.calls[0][0])).toMatchObject({
    type: 'frame-auth',
    step: 'error',
    code: 'invalid-message'
  })
  expect(unauthenticated.close).toHaveBeenCalledWith(1008, 'invalid-message')
  expect(provider.send).not.toHaveBeenCalled()
})

it('aborts pending consent when another authentication frame arrives', async () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const exported = pair.publicKey.export({ format: 'jwk' })
  const publicKey = {
    kty: 'EC',
    crv: 'P-256',
    x: exported.x,
    y: exported.y,
    ext: true,
    key_ops: ['verify']
  }
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.close = jest.fn()
  socket.send = jest.fn()
  socketConnection.emit('connection', socket, extensionRequest)
  socket.emit(
    'message',
    JSON.stringify({
      type: 'frame-auth',
      version: 2,
      step: 'hello',
      clientNonce: Buffer.alloc(32, 3).toString('base64url'),
      installationId: extensionInstallationId,
      publicKey
    })
  )
  await flushPromises()
  const challenge = JSON.parse(socket.send.mock.calls[0][0])
  const signature = sign('sha256', extensionAuthPayload(challenge), {
    key: pair.privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  socket.emit(
    'message',
    JSON.stringify({
      type: 'frame-auth',
      version: 2,
      step: 'proof',
      challengeId: challenge.challengeId,
      signature
    })
  )
  await flushPromises()
  const requestId = store.notify.mock.calls.at(-1)[1].requestId

  socket.emit('message', '{}')
  await flushPromises()

  expect(socket.close).toHaveBeenCalledWith(1008, 'Extension authentication already in progress')
  expect(respondToExtensionPairing(requestId, true)).toBe(false)
  expect(store.setExtensionCredential).not.toHaveBeenCalled()
  socket.emit('close')
})

it('rate-limits challenge issuance across extension connections', async () => {
  const limitedServer = new EventEmitter()
  WebSocket.Server.mockReturnValueOnce(limitedServer)
  ws(undefined, { extensionChallengeRateLimit: { maxRequests: 1, windowMs: 60_000 } })

  const first = new EventEmitter()
  first.readyState = WebSocket.OPEN
  first.close = jest.fn()
  first.send = jest.fn()
  const second = new EventEmitter()
  second.readyState = WebSocket.OPEN
  second.close = jest.fn()
  second.send = jest.fn()
  limitedServer.emit('connection', first, extensionRequest)
  limitedServer.emit('connection', second, extensionRequest)
  const hello = JSON.stringify({
    type: 'frame-auth',
    version: 2,
    step: 'hello',
    clientNonce: Buffer.alloc(32, 2).toString('base64url'),
    installationId: extensionInstallationId,
    publicKey: extensionPublicKey
  })

  first.emit('message', hello)
  second.emit('message', hello)
  await flushPromises()

  expect(JSON.parse(first.send.mock.calls[0][0])).toMatchObject({ step: 'challenge' })
  expect(second.send).not.toHaveBeenCalled()
  expect(second.close).toHaveBeenCalledWith(1013, 'Extension authentication rate limit exceeded')
  first.emit('close')
  second.emit('close')
})

it('configures the shared request size limit', () => {
  expect(WebSocket.Server).toHaveBeenCalledWith(
    expect.objectContaining({
      server: undefined,
      maxPayload: MAX_REQUEST_BYTES,
      perMessageDeflate: false,
      verifyClient: expect.any(Function)
    })
  )
})

it('closes a client that exceeds its message rate without processing the excess request', () => {
  const limitedServer = new EventEmitter()
  const limitedSocket = new EventEmitter()
  limitedSocket.readyState = WebSocket.OPEN
  limitedSocket.close = jest.fn()
  limitedSocket.send = jest.fn()
  WebSocket.Server.mockReturnValueOnce(limitedServer)
  ws(undefined, { messageRateLimit: { maxRequests: 1, windowMs: 1000 } })
  limitedServer.emit('connection', limitedSocket, regularRequest)

  limitedSocket.emit('message', '{')
  limitedSocket.emit('message', '{')

  expect(limitedSocket.send).toHaveBeenCalledTimes(1)
  expect(limitedSocket.close).toHaveBeenCalledWith(1013, 'Request rate limit exceeded')
})

it('closes clients beyond the configured connection limit', () => {
  const limitedServer = new EventEmitter()
  const firstSocket = new EventEmitter()
  const secondSocket = new EventEmitter()
  const replacementSocket = new EventEmitter()
  firstSocket.close = jest.fn()
  secondSocket.close = jest.fn()
  replacementSocket.close = jest.fn()
  WebSocket.Server.mockReturnValueOnce(limitedServer)
  ws(undefined, { maxClients: 1 })

  limitedServer.emit('connection', firstSocket, regularRequest)
  limitedServer.emit('connection', secondSocket, regularRequest)

  expect(firstSocket.close).not.toHaveBeenCalled()
  expect(secondSocket.close).toHaveBeenCalledWith(1013, 'Server capacity exceeded')

  firstSocket.emit('close')
  limitedServer.emit('connection', replacementSocket, regularRequest)
  expect(replacementSocket.close).not.toHaveBeenCalled()
})

it('does not deliver subscriptions to a closing socket', () => {
  const subscriptionId = 'subscription-closing-socket'
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: subscriptionId })
  )
  const regularSocket = new EventEmitter()
  regularSocket.readyState = WebSocket.OPEN
  regularSocket.close = jest.fn()
  regularSocket.send = jest.fn()
  socketConnection.emit('connection', regularSocket, { headers: { origin: 'https://example.com' } })
  regularSocket.emit(
    'message',
    JSON.stringify({ id: 9, jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'] })
  )
  regularSocket.send.mockClear()
  regularSocket.readyState = WebSocket.CLOSING

  const subscriptionListener = provider.on.mock.calls.at(-1)[1]
  subscriptionListener(
    {
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: { subscription: subscriptionId, result: {} }
    },
    { id: 1 }
  )

  expect(regularSocket.send).not.toHaveBeenCalled()
})

it('aliases subscriptions and denies unsubscribe from another socket', () => {
  const upstreamId = 'upstream-subscription'
  provider.send.mockImplementation((payload, callback) => {
    if (payload.method === 'eth_subscribe') {
      callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: upstreamId })
    } else if (payload.method === 'eth_unsubscribe') {
      callback?.({ id: payload.id, jsonrpc: payload.jsonrpc, result: true })
    }
  })
  const owner = new EventEmitter()
  owner.readyState = WebSocket.OPEN
  owner.close = jest.fn()
  owner.send = jest.fn()
  const intruder = new EventEmitter()
  intruder.readyState = WebSocket.OPEN
  intruder.close = jest.fn()
  intruder.send = jest.fn()
  socketConnection.emit('connection', owner, { headers: { origin: 'https://owner.test' } })
  socketConnection.emit('connection', intruder, { headers: { origin: 'https://intruder.test' } })

  owner.emit(
    'message',
    JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'] })
  )
  const alias = JSON.parse(owner.send.mock.calls[0][0]).result
  expect(alias).toMatch(/^0x[0-9a-f]{32}$/)
  expect(alias).not.toBe(upstreamId)

  owner.send.mockClear()
  handleWebSocketSubscription(
    {
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: { subscription: upstreamId, result: { number: '0x1' } }
    },
    { id: 1 }
  )
  expect(JSON.parse(owner.send.mock.calls[0][0]).params.subscription).toBe(alias)
  expect(intruder.send).not.toHaveBeenCalled()

  provider.send.mockClear()
  intruder.emit(
    'message',
    JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'eth_unsubscribe', params: [alias] })
  )
  expect(JSON.parse(intruder.send.mock.calls[0][0]).result).toBe(false)
  expect(provider.send).not.toHaveBeenCalled()

  owner.emit('message', JSON.stringify({ id: 3, jsonrpc: '2.0', method: 'eth_unsubscribe', params: [alias] }))
  expect(provider.send).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'eth_unsubscribe', params: [upstreamId], chainId: '0x1' }),
    expect.any(Function)
  )
  expect(JSON.parse(owner.send.mock.calls.at(-1)[0]).result).toBe(true)
})

it('cleans up a socket subscription on its original chain', () => {
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: 'upstream-cleanup' })
  )
  const owner = new EventEmitter()
  owner.readyState = WebSocket.OPEN
  owner.close = jest.fn()
  owner.send = jest.fn()
  socketConnection.emit('connection', owner, { headers: { origin: 'https://owner.test' } })
  owner.emit(
    'message',
    JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'] })
  )
  provider.send.mockClear()

  owner.emit('close')

  expect(provider.send).toHaveBeenCalledWith({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_unsubscribe',
    params: ['upstream-cleanup'],
    chainId: '0x1',
    _origin: expect.any(String)
  })
})

it('unsubscribes a late subscription result after its WebSocket closes', () => {
  let forwarded
  provider.send.mockImplementationOnce((_payload, callback) => {
    forwarded = callback
  })
  const owner = new EventEmitter()
  owner.readyState = WebSocket.OPEN
  owner.close = jest.fn()
  owner.send = jest.fn()
  socketConnection.emit('connection', owner, { headers: { origin: 'https://owner.test' } })
  owner.emit(
    'message',
    JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'] })
  )
  owner.emit('close')
  provider.send.mockClear()

  forwarded({ id: 1, jsonrpc: '2.0', result: 'late-websocket-subscription' })

  expect(provider.send).toHaveBeenCalledWith({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_unsubscribe',
    params: ['late-websocket-subscription'],
    chainId: '0x1',
    _origin: expect.any(String)
  })
  expect(owner.send).not.toHaveBeenCalled()
})

it('closes a slow WebSocket before buffering another subscription event', () => {
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: 'buffered-upstream' })
  )
  const owner = new EventEmitter()
  owner.readyState = WebSocket.OPEN
  owner.bufferedAmount = WS_MAX_BUFFERED_SUBSCRIPTION_BYTES
  owner.close = jest.fn()
  owner.send = jest.fn()
  socketConnection.emit('connection', owner, { headers: { origin: 'https://owner.test' } })
  owner.emit(
    'message',
    JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'] })
  )
  owner.send.mockClear()

  handleWebSocketSubscription(
    {
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: { subscription: 'buffered-upstream', result: { number: '0x1' } }
    },
    { id: 1 }
  )

  expect(owner.close).toHaveBeenCalledWith(1013, 'Subscription delivery limit exceeded')
  expect(owner.send).not.toHaveBeenCalled()
})

it('aborts only still-pending provider requests when a WebSocket closes', () => {
  const callbacks = []
  provider.send.mockImplementation((_payload, callback) => callbacks.push(callback))
  const regularSocket = new EventEmitter()
  regularSocket.readyState = WebSocket.OPEN
  regularSocket.close = jest.fn()
  regularSocket.send = jest.fn()
  socketConnection.emit('connection', regularSocket, { headers: { origin: 'https://example.com' } })
  const first = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] })
  const second = JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'eth_chainId', params: [] })

  regularSocket.emit('message', first)
  regularSocket.emit('message', second)
  callbacks[0]({ id: 1, jsonrpc: '2.0', result: '0x1' })

  expect(getRequestSignal(callbacks[0]).aborted).toBe(false)
  expect(getRequestSignal(callbacks[1]).aborted).toBe(false)

  regularSocket.emit('close')

  expect(getRequestSignal(callbacks[0]).aborted).toBe(false)
  expect(getRequestSignal(callbacks[1]).aborted).toBe(true)
  expect(regularSocket.send).toHaveBeenCalledTimes(1)

  callbacks[1]({ id: 2, jsonrpc: '2.0', result: '0x1' })
  expect(regularSocket.send).toHaveBeenCalledTimes(1)
})

it('responds to malformed JSON with a parse error', (done) => {
  mockSocket.send = (response) => {
    expect(JSON.parse(response)).toEqual({
      id: null,
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' }
    })
    done()
  }

  mockSocket.emit('message', '{')
})

it('responds to an invalid request with its valid id', (done) => {
  mockSocket.send = (response) => {
    expect(JSON.parse(response)).toEqual({
      id: 'request-9',
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' }
    })
    done()
  }

  mockSocket.emit('message', JSON.stringify({ id: 'request-9', jsonrpc: '1.0', method: 'eth_chainId' }))
})

it('preserves an exact canonical companion-proxied page origin', async () => {
  mockSocket.send = jest.fn()

  mockSocket.emit(
    'message',
    JSON.stringify({
      id: 9,
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      __frameOrigin: 'https://example.test'
    })
  )
  await Promise.resolve()
  await Promise.resolve()

  expect(store.initOrigin).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ name: 'https://example.test' })
  )
})

it('forwards a passive companion account probe without opening access UI', async () => {
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: [] })
  )

  mockSocket.emit(
    'message',
    JSON.stringify({
      id: 10,
      jsonrpc: '2.0',
      method: 'eth_accounts',
      params: [],
      __frameOrigin: 'https://example.test'
    })
  )
  await flushPromises()

  expect(provider.send).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'eth_accounts' }),
    expect.any(Function)
  )
  expect(store.notify).not.toHaveBeenCalled()
  expect(JSON.parse(mockSocket.send.mock.calls[0][0])).toMatchObject({ result: [] })
})

it('rejects non-canonical companion origins and extension metadata from local clients', async () => {
  mockSocket.send = jest.fn()
  mockSocket.emit(
    'message',
    JSON.stringify({
      id: 9,
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      __frameOrigin: 'HTTPS://Example.TEST:443'
    })
  )
  await flushPromises()
  expect(JSON.parse(mockSocket.send.mock.calls[0][0])).toMatchObject({
    id: 9,
    error: { code: -32600, message: 'Invalid companion page origin' }
  })

  const localSocket = new EventEmitter()
  localSocket.readyState = WebSocket.OPEN
  localSocket.close = jest.fn()
  localSocket.send = jest.fn()
  socketConnection.emit('connection', localSocket, regularRequest)
  localSocket.emit(
    'message',
    JSON.stringify({
      id: 10,
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      __frameOrigin: 'https://example.test'
    })
  )
  expect(JSON.parse(localSocket.send.mock.calls[0][0])).toMatchObject({
    id: 10,
    error: { code: -32600, message: 'Extension metadata is not allowed' }
  })
})

it('isolates originless, reserved, and schemeless local identities by WebSocket connection', () => {
  const firstSocket = new EventEmitter()
  const secondSocket = new EventEmitter()
  const thirdSocket = new EventEmitter()
  firstSocket.readyState = WebSocket.OPEN
  secondSocket.readyState = WebSocket.OPEN
  thirdSocket.readyState = WebSocket.OPEN
  firstSocket.send = jest.fn()
  secondSocket.send = jest.fn()
  thirdSocket.send = jest.fn()

  socketConnection.emit('connection', firstSocket, { headers: {} })
  socketConnection.emit('connection', secondSocket, {
    headers: { origin: 'Unknown/caller-selected' }
  })
  socketConnection.emit('connection', thirdSocket, {
    headers: { origin: 'legacy.example' }
  })
  const request = JSON.stringify({ id: 9, jsonrpc: '2.0', method: 'eth_chainId', params: [] })
  firstSocket.emit('message', request)
  secondSocket.emit('message', request)
  thirdSocket.emit('message', request)

  const origins = store.initOrigin.mock.calls.slice(-3).map((call) => call[1])
  expect(origins).toEqual([
    expect.objectContaining({ name: expect.stringMatching(/^Unknown\/[0-9a-f-]{36}$/), sessionOnly: true }),
    expect.objectContaining({ name: expect.stringMatching(/^Unknown\/[0-9a-f-]{36}$/), sessionOnly: true }),
    expect.objectContaining({ name: expect.stringMatching(/^Unknown\/[0-9a-f-]{36}$/), sessionOnly: true })
  ])
  expect(origins[1].name).not.toBe(origins[0].name)
  expect(origins[2].name).not.toBe(origins[1].name)
  expect(origins[1].name).not.toBe('Unknown/caller-selected')
  expect(origins[2].name).not.toBe('legacy.example')
})

it.each(['caip_request', 'wallet_request'])(
  'rejects unauthorized %s envelopes before nested method mapping',
  (method, done) => {
    accounts.getSelectedAddresses.mockReturnValue(['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'])
    mockSocket.send = (response) => {
      expect(JSON.parse(response)).toMatchObject({
        id: 9,
        jsonrpc: '2.0',
        error: { code: 4100 }
      })
      expect(provider.send).not.toHaveBeenCalled()
      done()
    }

    mockSocket.emit(
      'message',
      JSON.stringify({
        id: 9,
        jsonrpc: '2.0',
        method,
        params: {
          chainId: 'eip155:1',
          session: 'session',
          request: { method: 'personal_sign', params: ['message'] }
        }
      })
    )
  }
)

it('rejects a non-canonical target chain id', (done) => {
  mockSocket.send = (response) => {
    const payload = JSON.parse(response)
    expect(payload.id).toBe(9)
    expect(payload.error.code).toBe(-32602)
    expect(store.initOrigin).not.toHaveBeenCalled()
    done()
  }

  mockSocket.emit(
    'message',
    JSON.stringify({ id: 9, jsonrpc: '2.0', method: 'eth_chainId', params: [], chainId: '1' })
  )
})

it('always responds to an extension request for chain id with the requested chain id', (done) => {
  const rpcRequest = { id: 9, jsonrpc: '2.0', method: 'eth_chainId', params: [] }

  mockSocket.send = (response) => {
    const responsePayload = JSON.parse(response)
    expect(responsePayload.id).toBe(rpcRequest.id)
    expect(responsePayload.jsonrpc).toBe(rpcRequest.jsonrpc)
    expect(responsePayload.result).toBe('0x1')

    done()
  }

  mockSocket.emit('message', JSON.stringify(rpcRequest))
})

it('always responds to an extension request for net version with the requested chain', (done) => {
  const rpcRequest = { id: 9, jsonrpc: '2.0', method: 'net_version', params: [] }

  mockSocket.send = (response) => {
    const responsePayload = JSON.parse(response)
    expect(responsePayload.id).toBe(rpcRequest.id)
    expect(responsePayload.jsonrpc).toBe(rpcRequest.jsonrpc)
    expect(responsePayload.result).toBe('1')

    done()
  }

  mockSocket.emit('message', JSON.stringify(rpcRequest))
})
