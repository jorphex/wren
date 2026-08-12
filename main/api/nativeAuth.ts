import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'crypto'
import { z } from 'zod'

import store from '../store'
import { requireStoreAction } from '../store/action'
import { NativePeerCredentialSchema, type NativePeerCredential } from '../store/state/types/peerCredential'
import { DesktopAuthIdentitySchema } from './desktopAuthIdentity'
import { registerPeerCleanup } from './peerConnections'
import { revokeNativePeerAccess } from './peerRevocation'
import {
  PEER_AUTH_PROTOCOL,
  PEER_AUTH_VERSION,
  PeerAuthFingerprintSchema,
  PeerAuthInstallationIdSchema,
  PeerAuthNonceSchema,
  PeerAuthPublicKeySchema,
  PeerAuthSignatureSchema,
  PeerAuthTranscriptSchema,
  peerAuthFingerprint,
  peerAuthTranscriptBytes,
  signPeerAuthChallenge,
  signPeerAuthFinalAck,
  verifyExpectedPeerAuthTranscript,
  type PeerAuthPublicKey,
  type PeerAuthTranscript
} from './peerAuth'

export const NATIVE_AUTH_SESSION_TTL_MS = 5 * 60 * 1000
export const NATIVE_AUTH_CHALLENGE_TTL_MS = 60 * 1000
export const NATIVE_AUTH_REQUEST_TTL_MS = 30 * 1000
export const NATIVE_AUTH_MAX_PENDING_CHALLENGES = 128
export const NATIVE_AUTH_MAX_SESSIONS = 128
export const NATIVE_AUTH_MAX_REPLAYS_PER_SESSION = 256

export type NativeAuthErrorCode =
  | 'capacity'
  | 'challenge-expired'
  | 'credential-mismatch'
  | 'invalid-proof'
  | 'pairing-denied'
  | 'replay'
  | 'request-expired'
  | 'request-mismatch'
  | 'session-invalid'

export class NativeAuthError extends Error {
  constructor(readonly code: NativeAuthErrorCode) {
    super(code)
    this.name = 'NativeAuthError'
  }
}

const SignedProofSchema = z
  .object({
    protocol: z.literal(PEER_AUTH_PROTOCOL),
    version: z.literal(PEER_AUTH_VERSION),
    step: z.literal('prove'),
    transcript: PeerAuthTranscriptSchema,
    signature: PeerAuthSignatureSchema
  })
  .strict()

export const NativeRequestProofSchema = z
  .object({
    protocol: z.literal(PEER_AUTH_PROTOCOL),
    version: z.literal(PEER_AUTH_VERSION),
    role: z.literal('rpc'),
    sessionId: z.uuid(),
    requestNonce: PeerAuthNonceSchema,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    path: z.string().startsWith('/').min(1).max(128),
    bodySha256: z.string().regex(/^[0-9a-f]{64}$/u),
    signature: PeerAuthSignatureSchema
  })
  .strict()

export type NativeRequestProof = z.infer<typeof NativeRequestProofSchema>

type PendingChallenge = {
  transcript: PeerAuthTranscript
  publicKey: PeerAuthPublicKey
  transportContext: string
}

export type NativeAuthSession = Readonly<{
  id: string
  fingerprint: string
  publicKey: PeerAuthPublicKey
  expiresAt: number
}>

type RuntimeSession = NativeAuthSession & {
  replayNonces: Map<string, number>
  unregisterPeerCleanup: () => void
}

const pending = new Map<string, PendingChallenge>()
const sessions = new Map<string, RuntimeSession>()

const nonce = () => randomBytes(32).toString('base64url')
export const nativeRequestBodyHash = (body: Buffer) => createHash('sha256').update(body).digest('hex')

const desktopIdentity = () => DesktopAuthIdentitySchema.parse(store('main.desktopAuthIdentity'))

const nativeTranscript = (input: {
  role: PeerAuthTranscript['role']
  desktopInstallationId: string
  desktopFingerprint: string
  clientInstallationId: string
  clientFingerprint: string
  challengeId: string
  desktopNonce: string
  clientNonce: string
  expiresAt: number
}): PeerAuthTranscript =>
  PeerAuthTranscriptSchema.parse({
    protocol: PEER_AUTH_PROTOCOL,
    version: PEER_AUTH_VERSION,
    peerKind: 'native',
    role: input.role,
    channelRole: 'rpc',
    desktop: {
      installationId: input.desktopInstallationId,
      fingerprint: input.desktopFingerprint
    },
    client: {
      installationId: input.clientInstallationId,
      fingerprint: input.clientFingerprint,
      roleFingerprint: input.clientFingerprint
    },
    challengeId: input.challengeId,
    desktopNonce: input.desktopNonce,
    clientNonce: input.clientNonce,
    expiresAt: input.expiresAt
  })

const prune = (now: number) => {
  for (const [id, challenge] of pending) {
    if (challenge.transcript.expiresAt <= now) pending.delete(id)
  }
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id)
      session.unregisterPeerCleanup()
    } else {
      for (const [requestNonce, expiry] of session.replayNonces) {
        if (expiry <= now) session.replayNonces.delete(requestNonce)
      }
    }
  }
}

const pairingCode = (transcript: PeerAuthTranscript) =>
  (
    Number.parseInt(
      createHash('sha256').update(peerAuthTranscriptBytes(transcript)).digest('hex').slice(0, 8),
      16
    ) % 1_000_000
  )
    .toString()
    .padStart(6, '0')

export function issueNativeChallenge(
  input: { installationId: unknown; publicKey: unknown; clientNonce: unknown },
  transportContext: string,
  now = Date.now()
) {
  prune(now)
  if (pending.size >= NATIVE_AUTH_MAX_PENDING_CHALLENGES) {
    throw new NativeAuthError('capacity')
  }
  const installationId = PeerAuthInstallationIdSchema.parse(input.installationId)
  const publicKey = PeerAuthPublicKeySchema.parse(input.publicKey)
  const clientNonce = PeerAuthNonceSchema.parse(input.clientNonce)
  const context = z.string().min(1).max(128).parse(transportContext)
  const fingerprint = peerAuthFingerprint(publicKey)
  const desktop = desktopIdentity()
  const transcript = nativeTranscript({
    role: 'desktop-challenge',
    desktopInstallationId: desktop.installationId,
    desktopFingerprint: desktop.fingerprint,
    clientInstallationId: installationId,
    clientFingerprint: fingerprint,
    challengeId: randomUUID(),
    desktopNonce: nonce(),
    clientNonce,
    expiresAt: now + NATIVE_AUTH_CHALLENGE_TTL_MS
  })
  pending.set(transcript.challengeId, { transcript, publicKey, transportContext: context })
  return {
    step: 'challenge' as const,
    desktop: {
      installationId: desktop.installationId,
      publicKey: desktop.publicKey,
      fingerprint: desktop.fingerprint
    },
    ...signPeerAuthChallenge(desktop.privateKey, transcript),
    pairingCode: pairingCode(transcript)
  }
}

const credentialMatches = (
  credential: NativePeerCredential,
  installationId: string,
  publicKey: PeerAuthPublicKey
) =>
  credential.installationId === installationId &&
  credential.fingerprint === peerAuthFingerprint(publicKey) &&
  credential.publicKey.x === publicKey.x &&
  credential.publicKey.y === publicKey.y

function retireReplacedCredentials(credential: NativePeerCredential) {
  const credentials = (store('main.nativePeerCredentials') || {}) as Record<string, unknown>
  Object.entries(credentials).forEach(([fingerprint, value]) => {
    const existing = NativePeerCredentialSchema.safeParse(value)
    if (
      existing.success &&
      existing.data.installationId === credential.installationId &&
      fingerprint !== credential.fingerprint
    ) {
      revokeNativePeerAccess(fingerprint, 'Native credential replaced')
    }
  })
}

export async function proveNativeChallenge(
  input: unknown,
  authorize: (credential: NativePeerCredential, code: string) => boolean | Promise<boolean>,
  transportContext: string,
  now = Date.now()
) {
  prune(now)
  const proof = SignedProofSchema.parse(input)
  const challenge = pending.get(proof.transcript.challengeId)
  pending.delete(proof.transcript.challengeId)
  if (!challenge || challenge.transcript.expiresAt <= now) {
    throw new NativeAuthError('challenge-expired')
  }
  if (challenge.transportContext !== transportContext) throw new NativeAuthError('invalid-proof')
  const expected = { ...challenge.transcript, role: 'client-response' as const }
  if (
    !verifyExpectedPeerAuthTranscript(
      challenge.publicKey,
      { transcript: proof.transcript, signature: proof.signature },
      expected,
      now
    )
  ) {
    throw new NativeAuthError('invalid-proof')
  }
  if (sessions.size >= NATIVE_AUTH_MAX_SESSIONS) throw new NativeAuthError('capacity')

  const fingerprint = peerAuthFingerprint(challenge.publicKey)
  const persisted = NativePeerCredentialSchema.safeParse(store('main.nativePeerCredentials', fingerprint))
  if (
    persisted.success &&
    !credentialMatches(persisted.data, expected.client.installationId, challenge.publicKey)
  ) {
    throw new NativeAuthError('credential-mismatch')
  }
  const credential = NativePeerCredentialSchema.parse({
    protocolVersion: PEER_AUTH_VERSION,
    kind: 'native',
    installationId: expected.client.installationId,
    publicKey: challenge.publicKey,
    fingerprint,
    pairedAt: now
  })
  if (!persisted.success) {
    if (!(await authorize(credential, pairingCode(challenge.transcript)))) {
      throw new NativeAuthError('pairing-denied')
    }
    retireReplacedCredentials(credential)
    requireStoreAction('setNativePeerCredential')(credential)
  }

  const sessionId = randomUUID()
  const session: RuntimeSession = {
    id: sessionId,
    fingerprint,
    publicKey: challenge.publicKey,
    expiresAt: now + NATIVE_AUTH_SESSION_TTL_MS,
    replayNonces: new Map(),
    unregisterPeerCleanup: registerPeerCleanup(fingerprint, () => sessions.delete(sessionId))
  }
  sessions.set(session.id, session)
  const desktop = desktopIdentity()
  const ackTranscript = { ...expected, role: 'desktop-ack' as const }
  return {
    step: 'authenticated' as const,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    fingerprint,
    ...signPeerAuthFinalAck(desktop.privateKey, ackTranscript)
  }
}

const requestBytes = (proof: Omit<NativeRequestProof, 'signature'>) =>
  Buffer.from(
    `wren-native-request-v3\0${JSON.stringify({
      protocol: proof.protocol,
      version: proof.version,
      role: proof.role,
      sessionId: proof.sessionId,
      requestNonce: proof.requestNonce,
      expiresAt: proof.expiresAt,
      path: proof.path,
      bodySha256: proof.bodySha256
    })}`,
    'utf8'
  )

export const nativeRequestPayload = (input: Omit<NativeRequestProof, 'signature'>) => requestBytes(input)

export function authenticateNativeRequest(
  input: unknown,
  path: string,
  body: Buffer,
  now = Date.now()
): NativeAuthSession {
  prune(now)
  const proof = NativeRequestProofSchema.parse(input)
  const session = sessions.get(proof.sessionId)
  if (!session || session.expiresAt <= now) throw new NativeAuthError('session-invalid')
  if (
    proof.expiresAt <= now ||
    proof.expiresAt > now + NATIVE_AUTH_REQUEST_TTL_MS ||
    proof.expiresAt > session.expiresAt
  ) {
    throw new NativeAuthError('request-expired')
  }
  if (proof.path !== path || proof.bodySha256 !== nativeRequestBodyHash(body)) {
    throw new NativeAuthError('request-mismatch')
  }
  if (session.replayNonces.has(proof.requestNonce)) throw new NativeAuthError('replay')
  if (session.replayNonces.size >= NATIVE_AUTH_MAX_REPLAYS_PER_SESSION) {
    sessions.delete(session.id)
    session.unregisterPeerCleanup()
    throw new NativeAuthError('capacity')
  }
  const { signature, ...unsigned } = proof
  const verified = verify(
    'sha256',
    requestBytes(unsigned),
    {
      key: createPublicKey({ key: session.publicKey, format: 'jwk' }),
      dsaEncoding: 'ieee-p1363'
    },
    Buffer.from(signature, 'base64url')
  )
  if (!verified) throw new NativeAuthError('invalid-proof')
  session.replayNonces.set(proof.requestNonce, proof.expiresAt)
  return {
    id: session.id,
    fingerprint: session.fingerprint,
    publicKey: session.publicKey,
    expiresAt: session.expiresAt
  }
}

export function revokeNativeCredential(fingerprint: string) {
  PeerAuthFingerprintSchema.parse(fingerprint)
  revokeNativePeerAccess(fingerprint)
}

export function resetNativeAuthRuntimeForTests() {
  pending.clear()
  sessions.forEach((session) => session.unregisterPeerCleanup())
  sessions.clear()
}
