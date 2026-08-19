import { z } from 'zod'

import {
  PEER_AUTH_VERSION,
  PeerAuthClientBundleIdentitySchema,
  PeerAuthFingerprintSchema,
  PeerAuthInstallationIdSchema,
  PeerAuthClientKeyBundleSchema
} from '../../../../api/peerAuth'

const CredentialCoreSchema = z
  .object({
    protocolVersion: z.literal(PEER_AUTH_VERSION),
    installationId: PeerAuthInstallationIdSchema,
    publicKeys: PeerAuthClientKeyBundleSchema,
    fingerprint: PeerAuthFingerprintSchema,
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

const TransportCredentialSchema = z
  .object({
    protocolVersion: z.literal(PEER_AUTH_VERSION),
    installationId: PeerAuthInstallationIdSchema,
    browser: z.enum(['chrome', 'firefox', 'safari']),
    extensionId: z.string().min(1).max(128),
    publicKeys: PeerAuthClientKeyBundleSchema,
    fingerprint: PeerAuthFingerprintSchema,
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

const StateSchema = z
  .object({
    main: z
      .object({
        extensionCredentials: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const credentials: Record<string, unknown> = {}
  const source = parsed.data.main.extensionCredentials
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    Object.entries(source).forEach(([key, value]) => {
      const current = CredentialCoreSchema.safeParse(value)
      const legacy = current.success ? undefined : TransportCredentialSchema.safeParse(value)
      const credential = current.success ? current.data : legacy?.success ? legacy.data : undefined
      if (!credential || credential.fingerprint !== key) return
      credentials[key] = {
        protocolVersion: credential.protocolVersion,
        installationId: credential.installationId,
        publicKeys: credential.publicKeys,
        fingerprint: credential.fingerprint,
        pairedAt: credential.pairedAt
      }
    })
  }

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      extensionCredentials: credentials
    }
  }
}

export default { version: 68, migrate }
