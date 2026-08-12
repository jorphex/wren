import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from 'crypto'
import { z } from 'zod'

export const PEER_AUTH_PROTOCOL = 'wren-companion-auth'
export const PEER_AUTH_VERSION = 3
export const PEER_AUTH_DOMAIN = 'wren-companion-auth-v3\0'
export const PEER_AUTH_MAX_TRANSCRIPT_BYTES = 4 * 1024

const canonicalBase64Url = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 8) / 6)}}$`, 'u'))
    .refine((value) => {
      const decoded = Buffer.from(value, 'base64url')
      return decoded.length === bytes && decoded.toString('base64url') === value
    }, `Expected canonical ${bytes}-byte Base64URL`)

export const PeerAuthFingerprintSchema = canonicalBase64Url(32)
export const PeerAuthNonceSchema = canonicalBase64Url(32)
export const PeerAuthSignatureSchema = canonicalBase64Url(64)
const V4UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu)
export const PeerAuthInstallationIdSchema = V4UuidSchema

const P256CoordinateSchema = canonicalBase64Url(32)
const P256PrivateScalarSchema = canonicalBase64Url(32)

export const PeerAuthPublicKeySchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: P256CoordinateSchema,
    y: P256CoordinateSchema,
    ext: z.literal(true),
    key_ops: z.tuple([z.literal('verify')])
  })
  .strict()
  .superRefine((key, context) => {
    try {
      createPublicKey({ key, format: 'jwk' })
    } catch {
      context.addIssue({ code: 'custom', message: 'Expected a valid P-256 public key' })
    }
  })

export const PeerAuthPrivateKeySchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: P256CoordinateSchema,
    y: P256CoordinateSchema,
    d: P256PrivateScalarSchema,
    ext: z.literal(true),
    key_ops: z.tuple([z.literal('sign')])
  })
  .strict()
  .superRefine((key, context) => {
    try {
      const privateKey = createPrivateKey({ key, format: 'jwk' })
      const publicKey = createPublicKey({
        key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
        format: 'jwk'
      })
      const probe = Buffer.from('wren-peer-auth-key-consistency-v3', 'utf8')
      const signature = sign('sha256', probe, { key: privateKey, dsaEncoding: 'ieee-p1363' })
      if (!verify('sha256', probe, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) {
        throw new Error('Private scalar does not match public coordinates')
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Expected a valid P-256 private key' })
    }
  })

export type PeerAuthPublicKey = z.infer<typeof PeerAuthPublicKeySchema>
export type PeerAuthPrivateKey = z.infer<typeof PeerAuthPrivateKeySchema>

const DesktopPeerIdentitySchema = z
  .object({
    installationId: PeerAuthInstallationIdSchema,
    fingerprint: PeerAuthFingerprintSchema
  })
  .strict()

const ClientPeerIdentitySchema = DesktopPeerIdentitySchema.extend({
  roleFingerprint: PeerAuthFingerprintSchema
}).strict()

export const PeerAuthClientKeyBundleSchema = z
  .object({
    control: PeerAuthPublicKeySchema,
    page: PeerAuthPublicKeySchema
  })
  .strict()
  .superRefine((bundle, context) => {
    if (peerAuthFingerprint(bundle.control) === peerAuthFingerprint(bundle.page)) {
      context.addIssue({ code: 'custom', message: 'Control and page keys must be distinct' })
    }
  })

export type PeerAuthClientKeyBundle = z.infer<typeof PeerAuthClientKeyBundleSchema>

export function peerAuthClientBundleFingerprint(input: PeerAuthClientKeyBundle) {
  const bundle = PeerAuthClientKeyBundleSchema.parse(input)
  return createHash('sha256')
    .update(
      `wren-companion-key-bundle-v3\0${peerAuthFingerprint(bundle.control)}.${peerAuthFingerprint(bundle.page)}`,
      'utf8'
    )
    .digest('base64url')
}

export function peerAuthClientRoleKey(input: PeerAuthClientKeyBundle, channelRole: 'control' | 'page') {
  const bundle = PeerAuthClientKeyBundleSchema.parse(input)
  return bundle[channelRole]
}

export const PeerAuthClientBundleIdentitySchema = z
  .object({
    installationId: PeerAuthInstallationIdSchema,
    fingerprint: PeerAuthFingerprintSchema,
    publicKeys: PeerAuthClientKeyBundleSchema
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.fingerprint !== peerAuthClientBundleFingerprint(identity.publicKeys)) {
      context.addIssue({ code: 'custom', message: 'Client bundle fingerprint does not match its keys' })
    }
  })

export const PeerAuthTranscriptSchema = z
  .object({
    protocol: z.literal(PEER_AUTH_PROTOCOL),
    version: z.literal(PEER_AUTH_VERSION),
    peerKind: z.enum(['companion', 'native']),
    role: z.enum(['desktop-challenge', 'client-response', 'desktop-ack']),
    channelRole: z.enum(['control', 'page', 'rpc']),
    desktop: DesktopPeerIdentitySchema,
    client: ClientPeerIdentitySchema,
    challengeId: V4UuidSchema,
    desktopNonce: PeerAuthNonceSchema,
    clientNonce: PeerAuthNonceSchema,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine((transcript, context) => {
    if (
      (transcript.peerKind === 'companion' && transcript.channelRole === 'rpc') ||
      (transcript.peerKind === 'native' && transcript.channelRole !== 'rpc')
    ) {
      context.addIssue({ code: 'custom', message: 'Channel role does not match peer kind' })
    }
    if (transcript.desktop.fingerprint === transcript.client.fingerprint) {
      context.addIssue({ code: 'custom', message: 'Desktop and client keys must be distinct' })
    }
    if (transcript.desktopNonce === transcript.clientNonce) {
      context.addIssue({ code: 'custom', message: 'Desktop and client nonces must be distinct' })
    }
  })

export type PeerAuthTranscript = z.infer<typeof PeerAuthTranscriptSchema>
export type PeerAuthRole = PeerAuthTranscript['role']

export const PeerAuthSignedMessageSchema = z
  .object({
    transcript: PeerAuthTranscriptSchema,
    signature: PeerAuthSignatureSchema
  })
  .strict()

export type PeerAuthSignedMessage = z.infer<typeof PeerAuthSignedMessageSchema>

function publicJwk(key: KeyObject): PeerAuthPublicKey {
  const exported = key.export({ format: 'jwk' })
  return PeerAuthPublicKeySchema.parse({
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
    y: exported.y,
    ext: true,
    key_ops: ['verify']
  })
}

function privateJwk(key: KeyObject): PeerAuthPrivateKey {
  const exported = key.export({ format: 'jwk' })
  return PeerAuthPrivateKeySchema.parse({
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
    y: exported.y,
    d: exported.d,
    ext: true,
    key_ops: ['sign']
  })
}

export function generatePeerAuthKeyPair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { publicKey: publicJwk(pair.publicKey), privateKey: privateJwk(pair.privateKey) }
}

export function importPeerAuthPublicKey(input: unknown) {
  const publicKey = PeerAuthPublicKeySchema.parse(input)
  return createPublicKey({ key: publicKey, format: 'jwk' })
}

export function importPeerAuthPrivateKey(input: unknown) {
  const privateKey = PeerAuthPrivateKeySchema.parse(input)
  return createPrivateKey({ key: privateKey, format: 'jwk' })
}

export function peerAuthFingerprint(key: Pick<PeerAuthPublicKey, 'x' | 'y'>) {
  return createHash('sha256').update(`${key.x}.${key.y}`, 'utf8').digest('base64url')
}

export function peerAuthTranscriptBytes(input: unknown) {
  const transcript = PeerAuthTranscriptSchema.parse(input)
  const canonical: PeerAuthTranscript = {
    protocol: transcript.protocol,
    version: transcript.version,
    peerKind: transcript.peerKind,
    role: transcript.role,
    channelRole: transcript.channelRole,
    desktop: {
      installationId: transcript.desktop.installationId,
      fingerprint: transcript.desktop.fingerprint
    },
    client: {
      installationId: transcript.client.installationId,
      fingerprint: transcript.client.fingerprint,
      roleFingerprint: transcript.client.roleFingerprint
    },
    challengeId: transcript.challengeId,
    desktopNonce: transcript.desktopNonce,
    clientNonce: transcript.clientNonce,
    expiresAt: transcript.expiresAt
  }
  const bytes = Buffer.from(`${PEER_AUTH_DOMAIN}${JSON.stringify(canonical)}`, 'utf8')
  if (bytes.length > PEER_AUTH_MAX_TRANSCRIPT_BYTES)
    throw new Error('Peer authentication transcript too large')
  return bytes
}

export function peerAuthTranscriptMatchesExchange(
  expected: PeerAuthTranscript,
  candidate: PeerAuthTranscript
) {
  try {
    const normalizeRole = (transcript: PeerAuthTranscript) => ({
      ...PeerAuthTranscriptSchema.parse(transcript),
      role: 'desktop-challenge' as const
    })
    return peerAuthTranscriptBytes(normalizeRole(expected)).equals(
      peerAuthTranscriptBytes(normalizeRole(candidate))
    )
  } catch {
    return false
  }
}

export function signPeerAuthTranscript(privateKey: PeerAuthPrivateKey, transcript: PeerAuthTranscript) {
  const key = importPeerAuthPrivateKey(privateKey)
  return sign('sha256', peerAuthTranscriptBytes(transcript), { key, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url'
  )
}

export function verifyPeerAuthTranscript(
  publicKey: PeerAuthPublicKey,
  signed: PeerAuthSignedMessage,
  expectedRole: PeerAuthRole,
  now = Date.now()
) {
  try {
    const message = PeerAuthSignedMessageSchema.parse(signed)
    if (message.transcript.role !== expectedRole || now >= message.transcript.expiresAt) return false
    const signerFingerprint =
      expectedRole === 'client-response'
        ? message.transcript.client.roleFingerprint
        : message.transcript.desktop.fingerprint
    if (peerAuthFingerprint(publicKey) !== signerFingerprint) return false
    return verify(
      'sha256',
      peerAuthTranscriptBytes(message.transcript),
      { key: importPeerAuthPublicKey(publicKey), dsaEncoding: 'ieee-p1363' },
      Buffer.from(message.signature, 'base64url')
    )
  } catch {
    return false
  }
}

export function verifyExpectedPeerAuthTranscript(
  publicKey: PeerAuthPublicKey,
  signed: PeerAuthSignedMessage,
  expected: PeerAuthTranscript,
  now = Date.now()
) {
  return (
    peerAuthTranscriptMatchesExchange(expected, signed.transcript) &&
    verifyPeerAuthTranscript(publicKey, signed, expected.role, now)
  )
}

export type PeerAuthVerificationCode =
  | 'authenticated'
  | 'expired'
  | 'invalid-message'
  | 'invalid-proof'
  | 'key-changed'
  | 'role-mismatch'
  | 'upgrade-required'

export function peerAuthVerificationCode(
  input: unknown,
  publicKey: PeerAuthPublicKey,
  expectedRole: PeerAuthRole,
  expectedFingerprint: string,
  now = Date.now()
): PeerAuthVerificationCode {
  const parsed = PeerAuthSignedMessageSchema.safeParse(input)
  if (!parsed.success) {
    const candidate = input as { version?: unknown; transcript?: { version?: unknown } } | undefined
    return candidate?.version === 2 || candidate?.transcript?.version === 2
      ? 'upgrade-required'
      : 'invalid-message'
  }
  if (parsed.data.transcript.role !== expectedRole) return 'role-mismatch'
  if (parsed.data.transcript.expiresAt <= now) return 'expired'
  if (peerAuthFingerprint(publicKey) !== expectedFingerprint) return 'key-changed'
  return verifyPeerAuthTranscript(publicKey, parsed.data, expectedRole, now)
    ? 'authenticated'
    : 'invalid-proof'
}

export const signPeerAuthChallenge = (privateKey: PeerAuthPrivateKey, transcript: PeerAuthTranscript) => {
  if (transcript.role !== 'desktop-challenge') throw new Error('Expected desktop challenge transcript')
  return { transcript, signature: signPeerAuthTranscript(privateKey, transcript) }
}

export const signPeerAuthFinalAck = (privateKey: PeerAuthPrivateKey, transcript: PeerAuthTranscript) => {
  if (transcript.role !== 'desktop-ack') throw new Error('Expected desktop acknowledgement transcript')
  return { transcript, signature: signPeerAuthTranscript(privateKey, transcript) }
}

export const signPeerAuthClientResponse = (
  privateKey: PeerAuthPrivateKey,
  transcript: PeerAuthTranscript
) => {
  if (transcript.role !== 'client-response') throw new Error('Expected client response transcript')
  return { transcript, signature: signPeerAuthTranscript(privateKey, transcript) }
}

export const verifyPeerAuthChallenge = (
  publicKey: PeerAuthPublicKey,
  message: PeerAuthSignedMessage,
  now = Date.now()
) => verifyPeerAuthTranscript(publicKey, message, 'desktop-challenge', now)

export const verifyPeerAuthFinalAck = (
  publicKey: PeerAuthPublicKey,
  message: PeerAuthSignedMessage,
  now = Date.now()
) => verifyPeerAuthTranscript(publicKey, message, 'desktop-ack', now)

export const verifyPeerAuthClientResponse = (
  publicKey: PeerAuthPublicKey,
  message: PeerAuthSignedMessage,
  now = Date.now()
) => verifyPeerAuthTranscript(publicKey, message, 'client-response', now)
