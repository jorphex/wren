import { createPrivateKey, sign } from 'crypto'
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
import { getActiveChains } from '../../../main/provider/chains'
import { extensionAuthPayload } from '../../../main/api/extensionAuth'
import { respondToExtensionPairing } from '../../../main/api/extensionPairing'
import {
  generatePeerAuthKeyPair,
  peerAuthClientBundleFingerprint,
  peerAuthFingerprint
} from '../../../main/api/peerAuth'
import { createDesktopAuthIdentity } from '../../../main/api/desktopAuthIdentity'

let socketConnection, mockSocket, authenticatedResponse

const extensionRequestFor = (role = 'control') => ({
  headers: {
    origin: 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
  },
  url: `/?identity=frame-extension&role=${role}`
})
const extensionRequest = extensionRequestFor()

const regularRequest = { headers: { origin: 'https://example.test' } }
const extensionKeyPair = generatePeerAuthKeyPair()
const extensionPageKeyPair = generatePeerAuthKeyPair()
const extensionPublicKeys = {
  control: extensionKeyPair.publicKey,
  page: extensionPageKeyPair.publicKey
}
const extensionFingerprint = peerAuthClientBundleFingerprint(extensionPublicKeys)
const extensionInstallationId = '7a86842f-7c01-4d0d-b0f7-fc04e0acfd8f'
const flushPromises = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

const extensionHello = (keys = extensionPublicKeys, channelRole = 'control') => ({
  type: 'frame-auth',
  version: 3,
  step: 'hello',
  peerKind: 'companion',
  channelRole,
  clientNonce: Buffer.alloc(32, 1).toString('base64url'),
  client: {
    installationId: extensionInstallationId,
    fingerprint: peerAuthClientBundleFingerprint(keys),
    roleFingerprint: peerAuthFingerprint(keys[channelRole]),
    publicKeys: keys
  }
})

const authenticateExtension = async (socket, channelRole = 'control') => {
  socket.emit('message', JSON.stringify(extensionHello(extensionPublicKeys, channelRole)))
  await flushPromises()
  const challenge = JSON.parse(socket.send.mock.calls.at(-1)[0])
  const signature = sign('sha256', extensionAuthPayload(challenge, 'client-response'), {
    key: createPrivateKey({
      key: channelRole === 'control' ? extensionKeyPair.privateKey : extensionPageKeyPair.privateKey,
      format: 'jwk'
    }),
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  socket.emit(
    'message',
    JSON.stringify({
      type: 'frame-auth',
      version: 3,
      step: 'response',
      peerKind: 'companion',
      channelRole,
      challengeId: challenge.challengeId,
      signature
    })
  )
  await flushPromises()
  return JSON.parse(socket.send.mock.calls.at(-1)[0])
}

const createAuthenticatedPageSocket = async () => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.close = jest.fn()
  socket.send = jest.fn()
  socketConnection.emit('connection', socket, extensionRequestFor('page'))
  await authenticateExtension(socket, 'page')
  socket.send.mockClear()
  return socket
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
  store.set('main.origins', {})
  store.notify = jest.fn((notification, data) => {
    store.set('view.notify', notification)
    store.set('view.notifyData', data)
  })
  store.setExtensionCredential = jest.fn()
  store.set('main.desktopAuthIdentity', createDesktopAuthIdentity('11111111-1111-4111-8111-111111111111'))
  store.set('main.extensionCredentials', {
    [extensionFingerprint]: {
      protocolVersion: 3,
      installationId: extensionInstallationId,
      publicKeys: extensionPublicKeys,
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
      req: {
        headers: { host: '127.0.0.1:1248', origin: 'https://example.test' },
        url: '/other',
        socket: { localPort: 1248 }
      }
    })
  ).toBe(false)
  expect(
    options.verifyClient({
      req: {
        headers: { host: '127.0.0.1:1248', origin: 'https://example.test' },
        url: '/?identity=unknown',
        socket: { localPort: 1248 }
      }
    })
  ).toBe(false)
  expect(
    options.verifyClient({
      req: {
        headers: {
          host: '127.0.0.1:1248',
          origin: 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
        },
        url: '/?identity=frame-extension&role=control&extra=true',
        socket: { localPort: 1248 }
      }
    })
  ).toBe(false)
  expect(
    options.verifyClient({
      req: {
        headers: {
          host: '127.0.0.1:1248',
          origin: 'chrome-extension://ldcoohedfbjoobcadoglnnmmfbdlmmhf'
        },
        url: '/?identity=frame-extension',
        socket: { localPort: 1248 }
      }
    })
  ).toBe(false)
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
  expect(authenticatedResponse).toMatchObject({
    type: 'frame-auth',
    version: 3,
    step: 'authenticated',
    client: { fingerprint: extensionFingerprint }
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
  const pair = generatePeerAuthKeyPair()
  const page = generatePeerAuthKeyPair()
  const publicKeys = { control: pair.publicKey, page: page.publicKey }
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.close = jest.fn()
  socket.send = jest.fn()
  socketConnection.emit('connection', socket, extensionRequest)
  socket.emit('message', JSON.stringify(extensionHello(publicKeys)))
  await flushPromises()
  const challenge = JSON.parse(socket.send.mock.calls[0][0])
  const signature = sign('sha256', extensionAuthPayload(challenge, 'client-response'), {
    key: createPrivateKey({ key: pair.privateKey, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  socket.emit(
    'message',
    JSON.stringify({
      type: 'frame-auth',
      version: 3,
      step: 'response',
      peerKind: 'companion',
      channelRole: 'control',
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
  const hello = JSON.stringify(extensionHello())

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
  const pageSocket = await createAuthenticatedPageSocket()

  pageSocket.emit(
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
  pageSocket.emit('close')
})

it('forwards a passive companion account probe without opening access UI', async () => {
  const pageSocket = await createAuthenticatedPageSocket()
  provider.send.mockImplementationOnce((payload, callback) =>
    callback({ id: payload.id, jsonrpc: payload.jsonrpc, result: [] })
  )

  pageSocket.emit(
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
  expect(JSON.parse(pageSocket.send.mock.calls[0][0])).toMatchObject({ result: [] })
  pageSocket.emit('close')
})

it('rejects non-canonical companion origins and extension metadata from local clients', async () => {
  const pageSocket = await createAuthenticatedPageSocket()
  pageSocket.emit(
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
  expect(JSON.parse(pageSocket.send.mock.calls[0][0])).toMatchObject({
    id: 9,
    error: { code: -32600, message: 'Invalid companion page origin' }
  })
  pageSocket.emit('close')

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

it('keeps Companion control and page authorization roles separate after authentication', async () => {
  mockSocket.emit(
    'message',
    JSON.stringify({
      id: 14,
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      __frameOrigin: 'https://example.test'
    })
  )
  await flushPromises()
  expect(JSON.parse(mockSocket.send.mock.calls[0][0])).toMatchObject({
    id: 14,
    error: {
      code: -32600,
      message: 'Companion page origin is not allowed on the control channel'
    }
  })

  const pageSocket = await createAuthenticatedPageSocket()
  pageSocket.emit(
    'message',
    JSON.stringify({ id: 15, jsonrpc: '2.0', method: 'wallet_getEthereumChains', params: [] })
  )
  await flushPromises()
  expect(JSON.parse(pageSocket.send.mock.calls[0][0])).toMatchObject({
    id: 15,
    error: {
      code: -32600,
      message: 'Companion page origin is required on the page channel'
    }
  })
  expect(provider.send).not.toHaveBeenCalled()
  pageSocket.emit('close')
})

it('returns a recovered network catalog through the authenticated Companion control channel', async () => {
  store.initOrigin.mockImplementationOnce((originId, origin) => store.set('main.origins', originId, origin))
  store.set('main.networks.ethereum', {
    1: {
      id: 1,
      name: 'Mainnet',
      explorer: 'https://etherscan.io',
      connection: { endpoints: [{ id: 'rpc-1', connected: true }] },
      on: true
    },
    8453: null
  })
  store.set('main.networksMeta.ethereum', {
    1: {
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      primaryColor: 'accent1'
    }
  })
  store.set('main.colorway', 'dark')
  provider.send.mockImplementationOnce((payload, response) =>
    response({ id: payload.id, jsonrpc: payload.jsonrpc, result: getActiveChains() })
  )

  mockSocket.emit(
    'message',
    JSON.stringify({ id: 16, jsonrpc: '2.0', method: 'wallet_getEthereumChains', params: [] })
  )
  await flushPromises()

  expect(JSON.parse(mockSocket.send.mock.calls[0][0])).toEqual({
    id: 16,
    jsonrpc: '2.0',
    result: [
      expect.objectContaining({
        chainId: 1,
        connected: true,
        name: 'Mainnet',
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' }
      })
    ]
  })
})

it.each([
  undefined,
  'null',
  'Unknown/caller-selected',
  'legacy.example',
  'frame-extension',
  'frame-internal'
])('requires native protocol 3 for a non-browser WebSocket Origin %s', (origin) => {
  const socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.close = jest.fn()
  socket.send = jest.fn()

  socketConnection.emit('connection', socket, { headers: origin === undefined ? {} : { origin } })
  const request = JSON.stringify({ id: 9, jsonrpc: '2.0', method: 'eth_chainId', params: [] })
  socket.emit('message', request)

  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
    id: 9,
    error: {
      code: 4100,
      message: 'Wren requires a paired native protocol 3 client for local requests.'
    }
  })
  expect(socket.close).toHaveBeenCalledWith(1008, 'Native protocol 3 pairing required')
  expect(store.initOrigin).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ provenance: 'direct' })
  )
  expect(provider.send).not.toHaveBeenCalled()
})

it.each(['caip_request', 'wallet_request'])(
  'returns the provider unsupported-method response for removed %s envelopes',
  (method, done) => {
    accounts.getSelectedAddresses.mockReturnValue(['0xc93452A74e596e81E4f73Ca1AcFF532089AD4c62'])
    provider.send.mockImplementationOnce((payload, response) =>
      response({
        id: payload.id,
        jsonrpc: '2.0',
        error: {
          code: 4200,
          message: `${method} is no longer supported. Send the inner EIP-1193 method directly and use a top-level hexadecimal chainId.`
        }
      })
    )
    mockSocket.send = (response) => {
      expect(JSON.parse(response)).toMatchObject({
        id: 9,
        jsonrpc: '2.0',
        error: { code: 4200 }
      })
      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({ method, _origin: expect.any(String) }),
        expect.any(Function)
      )
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
