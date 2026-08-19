import { z } from 'zod'

import {
  PEER_AUTH_VERSION,
  PeerAuthClientBundleIdentitySchema,
  PeerAuthClientKeyBundleSchema,
  PeerAuthFingerprintSchema,
  PeerAuthInstallationIdSchema,
  PeerAuthPublicKeySchema,
  peerAuthClientBundleFingerprint,
  peerAuthFingerprint
} from '../../../api/peerAuth'

export const ExtensionBrowserSchema = z.enum(['chrome', 'firefox', 'safari'])
export const ExtensionFingerprintSchema = PeerAuthFingerprintSchema
export const ExtensionInstallationIdSchema = PeerAuthInstallationIdSchema
export const ExtensionPublicKeySchema = PeerAuthPublicKeySchema
export const ExtensionPublicKeyBundleSchema = PeerAuthClientKeyBundleSchema

export type ExtensionPublicKey = z.infer<typeof ExtensionPublicKeySchema>
export type ExtensionPublicKeyBundle = z.infer<typeof ExtensionPublicKeyBundleSchema>

// A role key fingerprint is useful for diagnostics, but a persisted principal is
// always the fingerprint of the complete control + page bundle.
export const extensionPublicKeyFingerprint = peerAuthFingerprint
export const extensionPublicKeyBundleFingerprint = peerAuthClientBundleFingerprint

export const ExtensionCredentialSchema = z
  .object({
    protocolVersion: z.literal(PEER_AUTH_VERSION),
    installationId: ExtensionInstallationIdSchema,
    publicKeys: ExtensionPublicKeyBundleSchema,
    fingerprint: ExtensionFingerprintSchema,
    pairedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
  .superRefine((credential, context) => {
    const identity = PeerAuthClientBundleIdentitySchema.safeParse({
      installationId: credential.installationId,
      publicKeys: credential.publicKeys,
      fingerprint: credential.fingerprint
    })
    if (!identity.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fingerprint'],
        message: 'Fingerprint does not match the public-key bundle'
      })
    }
  })

export const ExtensionCredentialsSchema = z
  .record(ExtensionFingerprintSchema, ExtensionCredentialSchema)
  .superRefine((credentials, context) => {
    Object.entries(credentials).forEach(([fingerprint, credential]) => {
      if (fingerprint !== credential.fingerprint) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [fingerprint],
          message: 'Credential record key does not match its fingerprint'
        })
      }
    })
  })

export type ExtensionBrowser = z.infer<typeof ExtensionBrowserSchema>
export type ExtensionCredential = z.infer<typeof ExtensionCredentialSchema>
