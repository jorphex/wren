import {
  generatePeerAuthKeyPair,
  peerAuthClientBundleFingerprint,
  peerAuthFingerprint,
  type PeerAuthPrivateKey
} from '../../../main/api/peerAuth'
import { createPrivateKey, createPublicKey, sign, verify } from 'crypto'

import {
  EXTENSION_AUTH_CHALLENGE_TTL_MS,
  ExtensionAuthSession,
  extensionAuthPayload,
  extensionPairingCode,
  parseExtensionAuthMessage
} from '../../../main/api/extensionAuth'
import type { DesktopAuthIdentity } from '../../../main/api/desktopAuthIdentity'
import { ExtensionCredentialsSchema } from '../../../main/store/state/types/extensionCredential'

const clientNonce = Buffer.alloc(32, 1).toString('base64url')
const desktopNonce = Buffer.alloc(32, 2).toString('base64url')
const challengeId = '18e73d72-3643-4cf6-846f-83854160f9f2'
const installationId = '7a86842f-7c01-4d0d-b0f7-fc04e0acfd8f'

function desktop(): DesktopAuthIdentity {
  const keys = generatePeerAuthKeyPair()
  return {
    protocolVersion: 3,
    installationId: '7a86842f-7c01-4d0d-b0f7-fc04e0acfd9f',
    ...keys,
    fingerprint: peerAuthFingerprint(keys.publicKey),
    createdAt: 1
  }
}

function bundle() {
  const control = generatePeerAuthKeyPair()
  const page = generatePeerAuthKeyPair()
  const publicKeys = { control: control.publicKey, page: page.publicKey }
  return {
    control,
    page,
    publicKeys,
    fingerprint: peerAuthClientBundleFingerprint(publicKeys)
  }
}

function hello(keys = bundle(), role: 'control' | 'page' = 'control', overrides = {}) {
  return JSON.stringify({
    type: 'frame-auth',
    version: 3,
    step: 'hello',
    peerKind: 'companion',
    channelRole: role,
    clientNonce,
    browser: 'chrome',
    extensionId: 'a'.repeat(32),
    client: {
      installationId,
      fingerprint: keys.fingerprint,
      roleFingerprint: peerAuthFingerprint(keys.publicKeys[role]),
      publicKeys: keys.publicKeys
    },
    ...overrides
  })
}

function session(
  identity = desktop(),
  authorize = jest.fn(async () => true),
  commit = jest.fn(() => true),
  now = jest.fn(() => 1_000)
) {
  return {
    authorize,
    commit,
    now,
    auth: new ExtensionAuthSession(
      { browser: 'chrome', id: 'a'.repeat(32), role: 'control' },
      {
        authorize,
        commit,
        desktopIdentity: () => identity,
        now,
        randomNonce: () => desktopNonce,
        randomChallengeId: () => challengeId
      }
    )
  }
}

function response(
  challenge: Awaited<ReturnType<ExtensionAuthSession['receive']>>,
  privateKey: PeerAuthPrivateKey
) {
  if (challenge.step !== 'challenge') throw new Error('Expected a challenge')
  return JSON.stringify({
    type: 'frame-auth',
    version: 3,
    step: 'response',
    peerKind: 'companion',
    channelRole: challenge.channelRole,
    challengeId: challenge.challengeId,
    signature: sign('sha256', extensionAuthPayload(challenge, 'client-response'), {
      key: createPrivateKey({ key: privateKey, format: 'jwk' }),
      dsaEncoding: 'ieee-p1363'
    }).toString('base64url')
  })
}

it('parses exact v3 messages and reports v2 as an explicit upgrade requirement', () => {
  expect(parseExtensionAuthMessage(hello()).success).toBe(true)
  expect(parseExtensionAuthMessage(hello(bundle(), 'control', { version: 2 }))).toEqual({
    success: false,
    code: 'unsupported-version'
  })
  expect(parseExtensionAuthMessage(hello(bundle(), 'control', { extra: true }))).toEqual({
    success: false,
    code: 'invalid-message'
  })
  expect(parseExtensionAuthMessage('x'.repeat(17 * 1024))).toEqual({
    success: false,
    code: 'invalid-message'
  })
})

it('returns the exact actionable v2 error only to a recognizable legacy hello', async () => {
  const { auth } = session()
  const key = generatePeerAuthKeyPair().publicKey
  await expect(
    auth.receive(
      JSON.stringify({
        type: 'frame-auth',
        version: 2,
        step: 'hello',
        clientNonce,
        installationId,
        publicKey: key
      })
    )
  ).resolves.toEqual({
    type: 'frame-auth',
    version: 2,
    step: 'error',
    code: 'unsupported-version',
    message:
      'Update Wren Companion — This version can’t verify Wren’s identity. Update the companion, then reconnect.'
  })
  await expect(
    auth.receive(JSON.stringify({ type: 'frame-auth', version: 2, step: 'hello' }))
  ).resolves.toMatchObject({
    version: 3,
    code: 'unsupported-version'
  })
})

it('loads a legacy v2 credential without allowing the retired protocol to authenticate', () => {
  const legacy = generatePeerAuthKeyPair().publicKey
  const fingerprint = peerAuthFingerprint(legacy)
  expect(
    ExtensionCredentialsSchema.safeParse({
      [fingerprint]: {
        protocolVersion: 2,
        installationId,
        browser: 'chrome',
        extensionId: 'a'.repeat(32),
        publicKey: legacy,
        fingerprint,
        pairedAt: 1
      }
    }).success
  ).toBe(true)
})

it('requires a signed desktop challenge, channel-specific response, and signed final acknowledgement', async () => {
  const keys = bundle()
  const identity = desktop()
  const { auth, authorize, commit } = session(identity)
  const challenge = await auth.receive(hello(keys))
  expect(challenge).toMatchObject({
    step: 'challenge',
    channelRole: 'control',
    clientNonce,
    desktopNonce,
    expiresAt: 1_000 + EXTENSION_AUTH_CHALLENGE_TTL_MS,
    desktop: { fingerprint: identity.fingerprint, publicKey: identity.publicKey }
  })
  if (challenge.step !== 'challenge') throw new Error('Expected a challenge')
  expect(extensionPairingCode(challenge)).toMatch(/^\d{6}$/)
  expect(authorize).not.toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()

  const acknowledgement = await auth.receive(response(challenge, keys.control.privateKey))
  expect(acknowledgement).toMatchObject({ step: 'authenticated', challengeId, channelRole: 'control' })
  expect(authorize).toHaveBeenCalledWith(
    expect.objectContaining({ fingerprint: keys.fingerprint }),
    undefined
  )
  expect(commit).toHaveBeenCalledTimes(1)
  expect(auth.authenticated).toBe(true)
  if (acknowledgement.step !== 'authenticated') throw new Error('Expected acknowledgement')
  expect(
    verify(
      'sha256',
      extensionAuthPayload({ ...challenge, ...acknowledgement, desktop: challenge.desktop }, 'desktop-ack'),
      { key: createPublicKey({ key: identity.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(acknowledgement.signature, 'base64url')
    )
  ).toBe(true)
})

it('fails closed for role confusion, replay, expiry, tampering, identity mismatch, and denied consent', async () => {
  const keys = bundle()
  const mismatched = session().auth
  await expect(mismatched.receive(hello(keys, 'page'))).resolves.toMatchObject({ code: 'invalid-state' })

  const roleConfused = session().auth
  const challenge = await roleConfused.receive(hello(keys))
  if (challenge.step !== 'challenge') throw new Error('Expected a challenge')
  await expect(roleConfused.receive(response(challenge, keys.page.privateKey))).resolves.toMatchObject({
    code: 'invalid-proof'
  })
  await expect(roleConfused.receive(response(challenge, keys.control.privateKey))).resolves.toMatchObject({
    code: 'invalid-state'
  })

  const expiring = session()
  const expiredChallenge = await expiring.auth.receive(hello(keys))
  if (expiredChallenge.step !== 'challenge') throw new Error('Expected a challenge')
  expiring.now.mockReturnValue(expiredChallenge.expiresAt)
  await expect(
    expiring.auth.receive(response(expiredChallenge, keys.control.privateKey))
  ).resolves.toMatchObject({
    code: 'expired'
  })

  const denied = session(
    desktop(),
    jest.fn(async () => false)
  )
  const deniedChallenge = await denied.auth.receive(hello(keys))
  await expect(
    denied.auth.receive(response(deniedChallenge, keys.control.privateKey))
  ).resolves.toMatchObject({
    code: 'denied'
  })
  expect(denied.commit).not.toHaveBeenCalled()
})
