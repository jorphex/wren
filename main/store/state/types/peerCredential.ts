import { z } from 'zod'

import {
  PEER_AUTH_VERSION,
  PeerAuthFingerprintSchema,
  PeerAuthInstallationIdSchema,
  PeerAuthPublicKeySchema,
  peerAuthFingerprint
} from '../../../api/peerAuth'

export const NativePeerCredentialSchema = z
  .object({
    protocolVersion: z.literal(PEER_AUTH_VERSION),
    kind: z.literal('native'),
    installationId: PeerAuthInstallationIdSchema,
    publicKey: PeerAuthPublicKeySchema,
    fingerprint: PeerAuthFingerprintSchema,
    pairedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine((credential, context) => {
    if (peerAuthFingerprint(credential.publicKey) !== credential.fingerprint) {
      context.addIssue({ code: 'custom', path: ['fingerprint'], message: 'Fingerprint does not match key' })
    }
  })

export type NativePeerCredential = z.infer<typeof NativePeerCredentialSchema>

export const NativePeerCredentialsSchema = z
  .record(PeerAuthFingerprintSchema, NativePeerCredentialSchema)
  .superRefine((credentials, context) => {
    Object.entries(credentials).forEach(([fingerprint, credential]) => {
      if (fingerprint !== credential.fingerprint) {
        context.addIssue({ code: 'custom', path: [fingerprint], message: 'Credential key mismatch' })
      }
    })
  })
