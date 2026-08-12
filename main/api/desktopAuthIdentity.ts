import { z } from 'zod'

import {
  PEER_AUTH_VERSION,
  PeerAuthFingerprintSchema,
  PeerAuthInstallationIdSchema,
  PeerAuthPrivateKeySchema,
  PeerAuthPublicKeySchema,
  generatePeerAuthKeyPair,
  peerAuthFingerprint
} from './peerAuth'

export const DesktopAuthIdentitySchema = z
  .object({
    protocolVersion: z.literal(PEER_AUTH_VERSION),
    installationId: PeerAuthInstallationIdSchema,
    publicKey: PeerAuthPublicKeySchema,
    privateKey: PeerAuthPrivateKeySchema,
    fingerprint: PeerAuthFingerprintSchema,
    createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine((identity, context) => {
    const publicFingerprint = peerAuthFingerprint(identity.publicKey)
    const privateFingerprint = peerAuthFingerprint(identity.privateKey)
    if (identity.fingerprint !== publicFingerprint || privateFingerprint !== publicFingerprint) {
      context.addIssue({ code: 'custom', message: 'Desktop authentication identity keys do not match' })
    }
  })

export type DesktopAuthIdentity = z.infer<typeof DesktopAuthIdentitySchema>

export function createDesktopAuthIdentity(
  installationId: string,
  createdAt = Date.now()
): DesktopAuthIdentity {
  const keys = generatePeerAuthKeyPair()
  return DesktopAuthIdentitySchema.parse({
    protocolVersion: PEER_AUTH_VERSION,
    installationId,
    ...keys,
    fingerprint: peerAuthFingerprint(keys.publicKey),
    createdAt
  })
}

export function parseDesktopAuthIdentity(input: unknown) {
  return DesktopAuthIdentitySchema.safeParse(input)
}

export function desktopPublicIdentity(identity: DesktopAuthIdentity) {
  const parsed = DesktopAuthIdentitySchema.parse(identity)
  return {
    installationId: parsed.installationId,
    publicKey: parsed.publicKey,
    fingerprint: parsed.fingerprint
  }
}
