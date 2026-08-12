import { randomBytes, sign } from 'crypto'

import store from '../../../main/store'
import { createDesktopAuthIdentity } from '../../../main/api/desktopAuthIdentity'
import {
  NATIVE_AUTH_CHALLENGE_TTL_MS,
  NATIVE_AUTH_MAX_PENDING_CHALLENGES,
  NATIVE_AUTH_MAX_REPLAYS_PER_SESSION,
  NATIVE_AUTH_MAX_SESSIONS,
  NativeAuthError,
  authenticateNativeRequest,
  issueNativeChallenge,
  nativeRequestBodyHash,
  nativeRequestPayload,
  proveNativeChallenge,
  resetNativeAuthRuntimeForTests
} from '../../../main/api/nativeAuth'
import {
  PEER_AUTH_PROTOCOL,
  PEER_AUTH_VERSION,
  generatePeerAuthKeyPair,
  peerAuthFingerprint,
  signPeerAuthClientResponse,
  type PeerAuthPrivateKey,
  type PeerAuthPublicKey
} from '../../../main/api/peerAuth'
import type { NativePeerCredential } from '../../../main/store/state/types/peerCredential'

jest.mock('../../../main/store')
jest.mock('../../../main/accounts', () => ({
  __esModule: true,
  default: {
    getSelectedAddresses: jest.fn(() => []),
    rejectUnapprovedRequestsForOrigins: jest.fn()
  }
}))
jest.mock('../../../main/provider', () => ({
  __esModule: true,
  default: { accountsChanged: jest.fn() }
}))

const clientInstallationId = '11111111-1111-4111-8111-111111111111'
const desktopInstallationId = '22222222-2222-4222-8222-222222222222'

const nonce = (marker: number) => {
  const value = Buffer.alloc(32)
  value.writeUInt32BE(marker)
  return value.toString('base64url')
}

function installStoreActions() {
  store.setNativePeerCredential = jest.fn((credential: NativePeerCredential) => {
    store.set('main.nativePeerCredentials', credential.fingerprint, credential)
  })
  store.removeNativePeerCredential = jest.fn((fingerprint: string) => {
    const credentials = { ...(store('main.nativePeerCredentials') || {}) }
    delete credentials[fingerprint]
    store.set('main.nativePeerCredentials', credentials)
  })
  store.toggleAccess = jest.fn((account: string, originId: string) => {
    const grants = { ...(store('main.permissions', account) || {}) }
    delete grants[originId]
    store.set('main.permissions', account, grants)
  })
}

function proofFor(challenge: ReturnType<typeof issueNativeChallenge>, privateKey: PeerAuthPrivateKey) {
  const response = signPeerAuthClientResponse(privateKey, {
    ...challenge.transcript,
    role: 'client-response'
  })
  return {
    protocol: PEER_AUTH_PROTOCOL,
    version: PEER_AUTH_VERSION,
    step: 'prove' as const,
    ...response
  }
}

function challengeFor(publicKey: PeerAuthPublicKey, marker: number, now = 1_000) {
  return issueNativeChallenge(
    { installationId: clientInstallationId, publicKey, clientNonce: nonce(marker) },
    'test',
    now
  )
}

async function authenticatedSession(
  keys = generatePeerAuthKeyPair(),
  now = 1_000,
  authorize: (credential: NativePeerCredential, code: string) => boolean | Promise<boolean> = () => true
) {
  const challenge = challengeFor(keys.publicKey, 1, now)
  const authenticated = await proveNativeChallenge(
    proofFor(challenge, keys.privateKey),
    authorize,
    'test',
    now
  )
  return { authenticated, keys }
}

beforeEach(() => {
  store.clear()
  resetNativeAuthRuntimeForTests()
  store.set('main.desktopAuthIdentity', createDesktopAuthIdentity(desktopInstallationId, 1_000))
  store.set('main.nativePeerCredentials', {})
  store.set('main.origins', {})
  store.set('main.permissions', {})
  installStoreActions()
})

it('does not let a newly approved key retire another principal by claiming its installation id', async () => {
  const previous = generatePeerAuthKeyPair()
  const next = generatePeerAuthKeyPair()
  const previousFingerprint = peerAuthFingerprint(previous.publicKey)
  store.set('main.nativePeerCredentials', previousFingerprint, {
    protocolVersion: 3,
    kind: 'native',
    installationId: clientInstallationId,
    publicKey: previous.publicKey,
    fingerprint: previousFingerprint,
    pairedAt: 10
  })
  store.set('main.origins', {
    oldOrigin: { provenance: 'native', sourceId: previousFingerprint }
  })
  store.set('main.permissions', { account: { oldOrigin: { caveats: [] } } })
  const challenge = challengeFor(next.publicKey, 1)
  await expect(
    proveNativeChallenge(proofFor(challenge, next.privateKey), () => true, 'test', 1_000)
  ).resolves.toMatchObject({ fingerprint: peerAuthFingerprint(next.publicKey) })

  expect(store.removeNativePeerCredential).not.toHaveBeenCalled()
  expect(store.toggleAccess).not.toHaveBeenCalled()
  expect(store('main.nativePeerCredentials', previousFingerprint)).toMatchObject({
    fingerprint: previousFingerprint,
    installationId: clientInstallationId
  })
  expect(store('main.permissions', 'account')).toEqual({ oldOrigin: { caveats: [] } })
})

afterEach(resetNativeAuthRuntimeForTests)

it('requires an exact signed transcript and asynchronous explicit consent for first pairing', async () => {
  const keys = generatePeerAuthKeyPair()
  const challenge = challengeFor(keys.publicKey, 1)
  let release = (_approved: boolean) => {}
  const authorization = jest.fn(() => new Promise<boolean>((resolve) => (release = resolve)))
  let settled = false
  const result = proveNativeChallenge(
    proofFor(challenge, keys.privateKey),
    authorization,
    'test',
    1_000
  ).then((value) => {
    settled = true
    return value
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(authorization).toHaveBeenCalledWith(
    expect.objectContaining({
      installationId: clientInstallationId,
      fingerprint: peerAuthFingerprint(keys.publicKey)
    }),
    expect.stringMatching(/^\d{6}$/u)
  )
  expect(store.setNativePeerCredential).not.toHaveBeenCalled()
  release(true)
  await expect(result).resolves.toMatchObject({
    step: 'authenticated',
    sessionId: expect.any(String),
    fingerprint: peerAuthFingerprint(keys.publicKey),
    transcript: { role: 'desktop-ack' }
  })
  expect(store.setNativePeerCredential).toHaveBeenCalledTimes(1)
})

it('silently reconnects only the exact stored identity without retaining a client label', async () => {
  const keys = generatePeerAuthKeyPair()
  const fingerprint = peerAuthFingerprint(keys.publicKey)
  store.set('main.nativePeerCredentials', fingerprint, {
    protocolVersion: 3,
    kind: 'native',
    installationId: clientInstallationId,
    publicKey: keys.publicKey,
    fingerprint,
    pairedAt: 10
  })
  const authorize = jest.fn(() => false)
  const challenge = challengeFor(keys.publicKey, 1, 1_000)
  await expect(
    proveNativeChallenge(proofFor(challenge, keys.privateKey), authorize, 'test', 1_000)
  ).resolves.toMatchObject({ step: 'authenticated', fingerprint })
  expect(authorize).not.toHaveBeenCalled()
  expect(store('main.nativePeerCredentials', fingerprint)).not.toHaveProperty('label')
})

it('fails closed when a stored fingerprint is attached to a different installation', async () => {
  const keys = generatePeerAuthKeyPair()
  const fingerprint = peerAuthFingerprint(keys.publicKey)
  store.set('main.nativePeerCredentials', fingerprint, {
    protocolVersion: 3,
    kind: 'native',
    installationId: '33333333-3333-4333-8333-333333333333',
    publicKey: keys.publicKey,
    fingerprint,
    pairedAt: 10
  })
  const authorize = jest.fn(() => true)
  const challenge = challengeFor(keys.publicKey, 1)
  await expect(
    proveNativeChallenge(proofFor(challenge, keys.privateKey), authorize, 'test', 1_000)
  ).rejects.toMatchObject({ code: 'credential-mismatch' })
  expect(authorize).not.toHaveBeenCalled()
})

it('expires hello-only challenges instead of permanently exhausting capacity', () => {
  const keys = generatePeerAuthKeyPair()
  for (let index = 0; index < NATIVE_AUTH_MAX_PENDING_CHALLENGES; index += 1) {
    challengeFor(keys.publicKey, index + 1, 1_000)
  }
  expect(() => challengeFor(keys.publicKey, 999, 1_000)).toThrow(
    expect.objectContaining({ code: 'capacity' })
  )
  expect(() => challengeFor(keys.publicKey, 1_000, 1_000 + NATIVE_AUTH_CHALLENGE_TTL_MS)).not.toThrow()
})

it('bounds active sessions independently of pending challenges', async () => {
  const keys = generatePeerAuthKeyPair()
  for (let index = 0; index < NATIVE_AUTH_MAX_SESSIONS; index += 1) {
    const challenge = challengeFor(keys.publicKey, index + 1)
    await proveNativeChallenge(proofFor(challenge, keys.privateKey), () => true, 'test', 1_000)
  }
  const overflow = challengeFor(keys.publicKey, NATIVE_AUTH_MAX_SESSIONS + 1)
  await expect(
    proveNativeChallenge(proofFor(overflow, keys.privateKey), () => true, 'test', 1_000)
  ).rejects.toMatchObject({ code: 'capacity' })
})

function signedRequest(
  privateKey: PeerAuthPrivateKey,
  sessionId: string,
  requestNonce: string,
  body: Buffer,
  now = 1_000
) {
  const unsigned = {
    protocol: PEER_AUTH_PROTOCOL,
    version: PEER_AUTH_VERSION,
    role: 'rpc' as const,
    sessionId,
    requestNonce,
    expiresAt: now + 1_000,
    path: '/native/v3/rpc',
    bodySha256: nativeRequestBodyHash(body)
  }
  return {
    ...unsigned,
    signature: sign('sha256', nativeRequestPayload(unsigned), {
      key: privateKey,
      format: 'jwk',
      dsaEncoding: 'ieee-p1363'
    }).toString('base64url')
  }
}

it('authenticates path-and-body-bound requests once', async () => {
  const body = Buffer.from('{"jsonrpc":"2.0"}')
  const { authenticated, keys } = await authenticatedSession()
  const proof = signedRequest(keys.privateKey, authenticated.sessionId, nonce(20), body)
  expect(authenticateNativeRequest(proof, '/native/v3/rpc', body, 1_000)).toMatchObject({
    id: authenticated.sessionId,
    fingerprint: peerAuthFingerprint(keys.publicKey)
  })
  expect(() => authenticateNativeRequest(proof, '/native/v3/rpc', body, 1_000)).toThrow(
    expect.objectContaining({ code: 'replay' })
  )
  const mismatch = signedRequest(keys.privateKey, authenticated.sessionId, nonce(21), body)
  expect(() => authenticateNativeRequest(mismatch, '/native/v3/other', body, 1_000)).toThrow(
    expect.objectContaining({ code: 'request-mismatch' })
  )
})

it('uses a canonical domain-separated request payload independent of input property order', () => {
  const body = Buffer.from('request')
  const canonical = {
    protocol: PEER_AUTH_PROTOCOL,
    version: PEER_AUTH_VERSION,
    role: 'rpc' as const,
    sessionId: '44444444-4444-4444-8444-444444444444',
    requestNonce: nonce(1),
    expiresAt: 2_000,
    path: '/native/v3/rpc',
    bodySha256: nativeRequestBodyHash(body)
  }
  const reordered = {
    bodySha256: canonical.bodySha256,
    path: canonical.path,
    expiresAt: canonical.expiresAt,
    requestNonce: canonical.requestNonce,
    sessionId: canonical.sessionId,
    role: canonical.role,
    version: canonical.version,
    protocol: canonical.protocol
  }
  expect(nativeRequestPayload(reordered)).toEqual(nativeRequestPayload(canonical))
  expect(nativeRequestPayload(canonical).subarray(0, 23).toString()).toBe('wren-native-request-v3\0')
  expect(nativeRequestPayload({ ...canonical, path: '/native/v3/other' })).not.toEqual(
    nativeRequestPayload(canonical)
  )
  expect(nativeRequestPayload({ ...canonical, bodySha256: '0'.repeat(64) })).not.toEqual(
    nativeRequestPayload(canonical)
  )
})

it('invalidates rather than evicts a session at its replay-memory bound', async () => {
  const body = randomBytes(8)
  const { authenticated, keys } = await authenticatedSession()
  for (let index = 0; index < NATIVE_AUTH_MAX_REPLAYS_PER_SESSION; index += 1) {
    authenticateNativeRequest(
      signedRequest(keys.privateKey, authenticated.sessionId, nonce(index + 1), body),
      '/native/v3/rpc',
      body,
      1_000
    )
  }
  const overflow = signedRequest(
    keys.privateKey,
    authenticated.sessionId,
    nonce(NATIVE_AUTH_MAX_REPLAYS_PER_SESSION + 1),
    body
  )
  expect(() => authenticateNativeRequest(overflow, '/native/v3/rpc', body, 1_000)).toThrow(
    expect.objectContaining({ code: 'capacity' })
  )
  expect(() =>
    authenticateNativeRequest(
      signedRequest(keys.privateKey, authenticated.sessionId, nonce(999), body),
      '/native/v3/rpc',
      body,
      1_000
    )
  ).toThrow(expect.objectContaining({ code: 'session-invalid' }))
})

it('rejects tampered proof before persisting or creating a usable session', async () => {
  const keys = generatePeerAuthKeyPair()
  const challenge = challengeFor(keys.publicKey, 1)
  const proof = proofFor(challenge, keys.privateKey)
  proof.transcript.clientNonce = nonce(99)
  await expect(proveNativeChallenge(proof, () => true, 'test', 1_000)).rejects.toBeInstanceOf(NativeAuthError)
  expect(store.setNativePeerCredential).not.toHaveBeenCalled()
})

it('does not allow a challenge to cross transport contexts', async () => {
  const keys = generatePeerAuthKeyPair()
  const challenge = issueNativeChallenge(
    {
      installationId: clientInstallationId,
      publicKey: keys.publicKey,
      clientNonce: nonce(1)
    },
    'http',
    1_000
  )
  await expect(
    proveNativeChallenge(proofFor(challenge, keys.privateKey), () => true, 'ws:socket', 1_000)
  ).rejects.toMatchObject({ code: 'invalid-proof' })
  expect(store.setNativePeerCredential).not.toHaveBeenCalled()
})
