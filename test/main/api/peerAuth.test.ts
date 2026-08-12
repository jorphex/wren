import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'

import {
  PEER_AUTH_DOMAIN,
  PeerAuthClientBundleIdentitySchema,
  PeerAuthTranscriptSchema,
  generatePeerAuthKeyPair,
  importPeerAuthPrivateKey,
  importPeerAuthPublicKey,
  peerAuthClientBundleFingerprint,
  peerAuthClientRoleKey,
  peerAuthFingerprint,
  peerAuthTranscriptBytes,
  peerAuthTranscriptMatchesExchange,
  peerAuthVerificationCode,
  signPeerAuthChallenge,
  signPeerAuthClientResponse,
  signPeerAuthFinalAck,
  signPeerAuthTranscript,
  verifyPeerAuthChallenge,
  verifyPeerAuthClientResponse,
  verifyPeerAuthFinalAck,
  verifyExpectedPeerAuthTranscript,
  verifyPeerAuthTranscript,
  type PeerAuthTranscript
} from '../../../main/api/peerAuth'
import {
  createDesktopAuthIdentity,
  desktopPublicIdentity,
  parseDesktopAuthIdentity
} from '../../../main/api/desktopAuthIdentity'

const fixtureRecord = JSON.parse(
  readFileSync(path.join(__dirname, '../../fixtures/peerAuth/v3-transcript.json'), 'utf8')
) as { transcript: PeerAuthTranscript; payloadBase64: string; sha256: string }
const fixture = fixtureRecord.transcript

const role = (value: PeerAuthTranscript['role']) => ({ ...fixture, role: value })

it('uses the shared bounded canonical v3 transcript fixture', () => {
  expect(PeerAuthTranscriptSchema.parse(fixture)).toEqual(fixture)
  const payload = peerAuthTranscriptBytes(fixture)
  expect(payload.toString()).toBe(`${PEER_AUTH_DOMAIN}${JSON.stringify(fixture)}`)
  expect(payload.toString('base64')).toBe(fixtureRecord.payloadBase64)
  expect(createHash('sha256').update(payload).digest('hex')).toBe(fixtureRecord.sha256)
  expect(() => PeerAuthTranscriptSchema.parse({ ...fixture, extra: true })).toThrow()
  expect(() => PeerAuthTranscriptSchema.parse({ ...fixture, version: 2 })).toThrow()
  expect(() =>
    PeerAuthTranscriptSchema.parse({
      ...fixture,
      challengeId: '33333333-3333-1333-8333-333333333333'
    })
  ).toThrow()
  expect(() => PeerAuthTranscriptSchema.parse({ ...fixture, peerKind: 'native' })).toThrow()
  expect(
    PeerAuthTranscriptSchema.safeParse({ ...fixture, peerKind: 'native', channelRole: 'rpc' }).success
  ).toBe(true)
})

it('generates, imports, fingerprints, signs, and verifies strict P-256 keys', () => {
  const desktop = generatePeerAuthKeyPair()
  expect(importPeerAuthPublicKey(desktop.publicKey).asymmetricKeyType).toBe('ec')
  expect(importPeerAuthPrivateKey(desktop.privateKey).asymmetricKeyType).toBe('ec')
  expect(peerAuthFingerprint(desktop.publicKey)).toMatch(/^[A-Za-z0-9_-]{43}$/)

  const transcript = {
    ...fixture,
    desktop: { ...fixture.desktop, fingerprint: peerAuthFingerprint(desktop.publicKey) }
  }
  const signature = signPeerAuthTranscript(desktop.privateKey, transcript)
  expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/)
  expect(verifyPeerAuthTranscript(desktop.publicKey, { transcript, signature }, 'desktop-challenge', 1)).toBe(
    true
  )
})

it('binds distinct control and page keys into one stable client principal', () => {
  const control = generatePeerAuthKeyPair()
  const page = generatePeerAuthKeyPair()
  const publicKeys = { control: control.publicKey, page: page.publicKey }
  const fingerprint = peerAuthClientBundleFingerprint(publicKeys)
  expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(peerAuthClientBundleFingerprint(publicKeys)).toBe(fingerprint)
  expect(peerAuthClientRoleKey(publicKeys, 'page')).toStrictEqual(page.publicKey)
  expect(
    PeerAuthClientBundleIdentitySchema.safeParse({
      installationId: fixture.client.installationId,
      fingerprint,
      publicKeys
    }).success
  ).toBe(true)
  expect(
    PeerAuthClientBundleIdentitySchema.safeParse({
      installationId: fixture.client.installationId,
      fingerprint: peerAuthFingerprint(control.publicKey),
      publicKeys
    }).success
  ).toBe(false)
  expect(() =>
    peerAuthClientBundleFingerprint({ control: control.publicKey, page: control.publicKey })
  ).toThrow()
})

it('signs and verifies the desktop challenge and final acknowledgement roles', () => {
  const desktop = generatePeerAuthKeyPair()
  const client = generatePeerAuthKeyPair()
  const withDesktop = (transcript: PeerAuthTranscript) => ({
    ...transcript,
    desktop: { ...transcript.desktop, fingerprint: peerAuthFingerprint(desktop.publicKey) },
    client: { ...transcript.client, roleFingerprint: peerAuthFingerprint(client.publicKey) }
  })
  const challenge = signPeerAuthChallenge(desktop.privateKey, withDesktop(role('desktop-challenge')))
  const ack = signPeerAuthFinalAck(desktop.privateKey, withDesktop(role('desktop-ack')))
  const responseTranscript = {
    ...withDesktop(role('client-response'))
  }
  const response = signPeerAuthClientResponse(client.privateKey, responseTranscript)
  expect(verifyPeerAuthChallenge(desktop.publicKey, challenge, 1)).toBe(true)
  expect(verifyPeerAuthFinalAck(desktop.publicKey, ack, 1)).toBe(true)
  expect(verifyPeerAuthClientResponse(client.publicKey, response, 1)).toBe(true)
  expect(peerAuthTranscriptMatchesExchange(challenge.transcript, response.transcript)).toBe(true)
  expect(verifyExpectedPeerAuthTranscript(client.publicKey, response, responseTranscript, 1)).toBe(true)
  expect(
    verifyExpectedPeerAuthTranscript(
      client.publicKey,
      response,
      {
        ...responseTranscript,
        challengeId: '55555555-5555-4555-8555-555555555555'
      },
      1
    )
  ).toBe(false)
  expect(() => signPeerAuthFinalAck(desktop.privateKey, withDesktop(role('desktop-challenge')))).toThrow()
})

it('rejects tamper, role, peer-kind, channel, key, expiry, and downgrade confusion', () => {
  const desktop = generatePeerAuthKeyPair()
  const other = generatePeerAuthKeyPair()
  const transcript = {
    ...fixture,
    desktop: { ...fixture.desktop, fingerprint: peerAuthFingerprint(desktop.publicKey) }
  }
  const message = signPeerAuthChallenge(desktop.privateKey, transcript)
  expect(verifyPeerAuthChallenge(other.publicKey, message, 1)).toBe(false)
  expect(verifyPeerAuthFinalAck(desktop.publicKey, message, 1)).toBe(false)
  expect(verifyPeerAuthChallenge(desktop.publicKey, message, transcript.expiresAt)).toBe(false)
  expect(
    verifyPeerAuthChallenge(
      desktop.publicKey,
      { ...message, transcript: { ...transcript, channelRole: 'page' } },
      1
    )
  ).toBe(false)
  expect(
    verifyPeerAuthChallenge(
      desktop.publicKey,
      { ...message, transcript: { ...transcript, peerKind: 'native', channelRole: 'rpc' } },
      1
    )
  ).toBe(false)
  expect(
    peerAuthVerificationCode(
      { transcript: { ...transcript, version: 2 }, signature: message.signature },
      desktop.publicKey,
      'desktop-challenge',
      peerAuthFingerprint(desktop.publicKey),
      1
    )
  ).toBe('upgrade-required')
  expect(
    peerAuthVerificationCode(
      { type: 'frame-auth', version: 2, step: 'hello' },
      desktop.publicKey,
      'desktop-challenge',
      peerAuthFingerprint(desktop.publicKey),
      1
    )
  ).toBe('upgrade-required')
  expect(
    peerAuthVerificationCode(
      message,
      desktop.publicKey,
      'desktop-ack',
      peerAuthFingerprint(desktop.publicKey),
      1
    )
  ).toBe('role-mismatch')
  expect(peerAuthVerificationCode(message, desktop.publicKey, 'desktop-challenge', 'A'.repeat(43), 1)).toBe(
    'key-changed'
  )
})

it('creates strict self-consistent desktop identity records without persisting them', () => {
  const identity = createDesktopAuthIdentity('44444444-4444-4444-8444-444444444444', 10)
  expect(parseDesktopAuthIdentity(identity).success).toBe(true)
  expect(desktopPublicIdentity(identity)).toEqual({
    installationId: identity.installationId,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint
  })
  expect(parseDesktopAuthIdentity({ ...identity, fingerprint: 'A'.repeat(43) }).success).toBe(false)
  expect(
    parseDesktopAuthIdentity({ ...identity, privateKey: { ...identity.privateKey, d: 'A'.repeat(43) } })
      .success
  ).toBe(false)
})
