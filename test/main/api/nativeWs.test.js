import WebSocket from 'ws'
import { EventEmitter } from 'stream'

import ws from '../../../main/api/ws'
import {
  authenticateNativeRequest,
  issueNativeChallenge,
  proveNativeChallenge
} from '../../../main/api/nativeAuth'
import provider from '../../../main/provider'
import store from '../../../main/store'
import { revokeNativePeerAccess } from '../../../main/api/peerRevocation'

jest.mock('ws')
jest.mock('../../../main/store')
jest.mock('../../../main/provider', () => ({ on: jest.fn(), send: jest.fn() }))
jest.mock('../../../main/accounts', () => ({ getSelectedAddresses: jest.fn(() => []) }))
jest.mock('../../../main/windows', () => ({}))
jest.mock('../../../main/api/origins', () => ({
  createSessionOrigin: jest.fn(() => 'session'),
  isTrusted: jest.fn(() => true),
  parseFrameExtension: jest.fn(),
  parseOrigin: jest.fn((origin) => origin),
  updateOrigin: jest.fn((payload) => ({
    payload: { ...payload, _origin: 'native-origin' },
    chainId: '0x1'
  }))
}))
jest.mock('../../../main/api/extensionAuth', () => ({
  ExtensionAuthSession: jest.fn(),
  parseExtensionAuthMessage: jest.fn()
}))
jest.mock('../../../main/api/nativePairing', () => ({ authorizeNativePeer: jest.fn() }))
jest.mock('../../../main/api/nativeAuth', () => ({
  NativeRequestProofSchema: require('zod').z.any(),
  authenticateNativeRequest: jest.fn(),
  issueNativeChallenge: jest.fn(),
  proveNativeChallenge: jest.fn()
}))

const request = {
  headers: { host: '127.0.0.1:1248' },
  socket: { localPort: 1248 },
  url: '/?identity=wren-native&role=rpc&version=3'
}
const nativeFingerprint = Buffer.alloc(32, 1).toString('base64url')

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

let server
let socket

beforeEach(() => {
  jest.useFakeTimers()
  store.clear()
  store.set('main.origins', {
    'native-origin': { provenance: 'native', sourceId: nativeFingerprint }
  })
  store.set('main.accounts', {})
  store.set('main.permissions', {})
  store.removeNativePeerCredential = jest.fn()
  store.removeDappGuardrailsForPrincipalOrigins = jest.fn()
  server = new EventEmitter()
  socket = new EventEmitter()
  socket.readyState = WebSocket.OPEN
  socket.close = jest.fn()
  socket.send = jest.fn()
  WebSocket.Server.mockReturnValueOnce(server)
  issueNativeChallenge.mockReturnValue({
    step: 'challenge',
    transcript: {
      challengeId: '11111111-1111-4111-8111-111111111111',
      expiresAt: Date.now() + 60_000
    }
  })
  proveNativeChallenge.mockResolvedValue({
    step: 'authenticated',
    sessionId: '22222222-2222-4222-8222-222222222222',
    fingerprint: nativeFingerprint,
    expiresAt: Date.now() + 300_000
  })
  authenticateNativeRequest.mockReturnValue({
    id: '22222222-2222-4222-8222-222222222222',
    fingerprint: nativeFingerprint
  })
  ws()
  server.emit('connection', socket, request)
})

afterEach(() => {
  socket.emit('close')
  jest.useRealTimers()
})

it('rejects browser-origin and malformed native upgrade queries', () => {
  const verifyClient = WebSocket.Server.mock.calls.at(-1)[0].verifyClient
  expect(verifyClient({ req: request })).toBe(true)
  expect(
    verifyClient({ req: { ...request, headers: { ...request.headers, origin: 'https://example.test' } } })
  ).toBe(false)
  expect(verifyClient({ req: { ...request, url: '/?identity=wren-native&role=rpc&version=2' } })).toBe(false)
})

it('binds one challenge to its socket and rejects a second hello', () => {
  const hello = JSON.stringify({
    type: 'wren-native-auth',
    version: 3,
    step: 'hello',
    installationId: 'client',
    publicKey: {},
    clientNonce: 'nonce'
  })
  socket.emit('message', hello)
  expect(issueNativeChallenge).toHaveBeenCalledTimes(1)
  expect(issueNativeChallenge).toHaveBeenCalledWith(expect.any(Object), expect.stringMatching(/^ws:/u))
  socket.emit('message', hello)
  expect(socket.close).toHaveBeenCalledWith(1008, 'Native authentication challenge already issued')
})

it('rejects proof from a challenge issued on another transport', () => {
  socket.emit(
    'message',
    JSON.stringify({
      type: 'wren-native-auth',
      version: 3,
      step: 'prove',
      protocol: 'wren-companion-auth',
      transcript: { challengeId: '33333333-3333-4333-8333-333333333333' },
      signature: 'signature'
    })
  )
  expect(proveNativeChallenge).not.toHaveBeenCalled()
  expect(socket.close).toHaveBeenCalledWith(1008, 'Native authentication challenge does not match')
})

it('expires an authenticated quiet socket without inbound traffic', async () => {
  socket.emit(
    'message',
    JSON.stringify({
      type: 'wren-native-auth',
      version: 3,
      step: 'hello',
      installationId: 'client',
      publicKey: {},
      clientNonce: 'nonce'
    })
  )
  socket.emit(
    'message',
    JSON.stringify({
      type: 'wren-native-auth',
      version: 3,
      step: 'prove',
      protocol: 'wren-companion-auth',
      transcript: { challengeId: '11111111-1111-4111-8111-111111111111' },
      signature: 'signature'
    })
  )
  await flush()
  expect(proveNativeChallenge).toHaveBeenCalledWith(
    expect.any(Object),
    expect.any(Function),
    expect.stringMatching(/^ws:/u)
  )
  expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('authenticated'), expect.any(Function))
  jest.advanceTimersByTime(300_000)
  expect(socket.close).toHaveBeenCalledWith(1008, 'Native authentication session expired')
  expect(provider.send).not.toHaveBeenCalled()
})

it('unsubscribes provider work when the native credential is revoked', async () => {
  socket.emit(
    'message',
    JSON.stringify({
      type: 'wren-native-auth',
      version: 3,
      step: 'hello',
      installationId: 'client',
      publicKey: {},
      clientNonce: 'nonce'
    })
  )
  socket.emit(
    'message',
    JSON.stringify({
      type: 'wren-native-auth',
      version: 3,
      step: 'prove',
      protocol: 'wren-companion-auth',
      transcript: { challengeId: '11111111-1111-4111-8111-111111111111' },
      signature: 'signature'
    })
  )
  await flush()
  provider.send.mockImplementation((payload, response) => {
    if (payload.method === 'eth_subscribe') {
      response({ id: payload.id, jsonrpc: payload.jsonrpc, result: 'upstream-native-subscription' })
    }
  })
  const payload = Buffer.from(
    JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_subscribe', params: ['newHeads'] })
  )
  socket.emit(
    'message',
    JSON.stringify({
      type: 'wren-native-rpc',
      version: 3,
      proof: {},
      payloadBase64: payload.toString('base64url')
    })
  )
  await flush()

  revokeNativePeerAccess(nativeFingerprint)

  expect(store.removeDappGuardrailsForPrincipalOrigins).toHaveBeenCalledWith(['native-origin'])
  expect(provider.send).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'eth_unsubscribe',
      params: ['upstream-native-subscription'],
      _origin: 'native-origin'
    })
  )
  expect(socket.close).toHaveBeenCalledWith(1008, 'Native credential revoked')
})
