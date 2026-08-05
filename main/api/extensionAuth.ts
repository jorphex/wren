import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'crypto'
import { z } from 'zod'

import {
  ExtensionPublicKeySchema,
  ExtensionInstallationIdSchema,
  extensionPublicKeyFingerprint,
  type ExtensionBrowser,
  type ExtensionCredential,
  type ExtensionPublicKey
} from '../store/state/types/extensionCredential'

export const EXTENSION_AUTH_VERSION = 2
export const EXTENSION_AUTH_MAX_MESSAGE_BYTES = 8 * 1024
export const EXTENSION_AUTH_CHALLENGE_TTL_MS = 60 * 1000

const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const ChallengeIdSchema = z.string().uuid()
const SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/)

const AuthHelloSchema = z
  .object({
    type: z.literal('frame-auth'),
    version: z.literal(EXTENSION_AUTH_VERSION),
    step: z.literal('hello'),
    clientNonce: NonceSchema,
    installationId: ExtensionInstallationIdSchema,
    publicKey: ExtensionPublicKeySchema
  })
  .strict()

const AuthProofSchema = z
  .object({
    type: z.literal('frame-auth'),
    version: z.literal(EXTENSION_AUTH_VERSION),
    step: z.literal('proof'),
    challengeId: ChallengeIdSchema,
    signature: SignatureSchema
  })
  .strict()

const AuthMessageSchema = z.discriminatedUnion('step', [AuthHelloSchema, AuthProofSchema])

export type ExtensionAuthClientMessage = z.infer<typeof AuthMessageSchema>

export interface ExtensionIdentity {
  browser: ExtensionBrowser
  id: string
}

export interface ExtensionPairingCandidate extends ExtensionCredential {
  pairingCode: string
}

export interface ExtensionAuthChallenge {
  type: 'frame-auth'
  version: 2
  step: 'challenge'
  challengeId: string
  clientNonce: string
  serverNonce: string
  browser: ExtensionBrowser
  extensionId: string
  installationId: string
  fingerprint: string
  expiresAt: number
}

export type ExtensionAuthServerMessage =
  | ExtensionAuthChallenge
  | {
      type: 'frame-auth'
      version: 2
      step: 'authenticated'
      fingerprint: string
    }
  | {
      type: 'frame-auth'
      version: 2
      step: 'error'
      code:
        'denied' | 'expired' | 'invalid-message' | 'invalid-proof' | 'invalid-state' | 'unsupported-version'
      message: string
    }

interface ExtensionAuthSessionOptions {
  authorize(candidate: ExtensionPairingCandidate, signal?: AbortSignal): Promise<boolean>
  now?: () => number
  randomNonce?: () => string
  randomChallengeId?: () => string
}

interface PendingChallenge {
  challenge: ExtensionAuthChallenge
  candidate: ExtensionPairingCandidate
  publicKey: ExtensionPublicKey
}

const errorMessage = (
  code: Extract<ExtensionAuthServerMessage, { step: 'error' }>['code'],
  message: string
): ExtensionAuthServerMessage => ({
  type: 'frame-auth',
  version: EXTENSION_AUTH_VERSION,
  step: 'error',
  code,
  message
})

export function parseExtensionAuthMessage(data: unknown) {
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > EXTENSION_AUTH_MAX_MESSAGE_BYTES) {
    return { success: false as const, code: 'invalid-message' as const }
  }

  try {
    const value: unknown = JSON.parse(data)
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { type?: unknown }).type === 'frame-auth' &&
      (value as { version?: unknown }).version !== EXTENSION_AUTH_VERSION
    ) {
      return { success: false as const, code: 'unsupported-version' as const }
    }
    const parsed = AuthMessageSchema.safeParse(value)
    return parsed.success
      ? { success: true as const, message: parsed.data }
      : { success: false as const, code: 'invalid-message' as const }
  } catch {
    return { success: false as const, code: 'invalid-message' as const }
  }
}

export function extensionKeyFingerprint(publicKey: ExtensionPublicKey) {
  return extensionPublicKeyFingerprint(publicKey)
}

export function extensionPairingCode(challenge: ExtensionAuthChallenge) {
  const digest = createHash('sha256')
    .update('frame-pairing-code-v2\0', 'utf8')
    .update(extensionAuthPayload(challenge))
    .digest()
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0')
}

export function extensionAuthPayload(challenge: ExtensionAuthChallenge) {
  return Buffer.from(
    [
      'frame-extension-auth-v2',
      challenge.challengeId,
      challenge.clientNonce,
      challenge.serverNonce,
      challenge.browser,
      challenge.extensionId,
      challenge.installationId,
      challenge.fingerprint,
      challenge.expiresAt.toString(10)
    ].join('\n'),
    'utf8'
  )
}

export function verifyExtensionProof(
  publicKey: ExtensionPublicKey,
  challenge: ExtensionAuthChallenge,
  signature: string
) {
  try {
    const key = createPublicKey({ key: publicKey, format: 'jwk' })
    return verify(
      'sha256',
      extensionAuthPayload(challenge),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    )
  } catch {
    return false
  }
}

export class ExtensionAuthSession {
  authenticated = false
  private pending: PendingChallenge | undefined
  private proofPending = false
  private readonly now: () => number
  private readonly randomNonce: () => string
  private readonly randomChallengeId: () => string

  constructor(
    private readonly extension: ExtensionIdentity,
    private readonly options: ExtensionAuthSessionOptions
  ) {
    this.now = options.now ?? Date.now
    this.randomNonce = options.randomNonce ?? (() => randomBytes(32).toString('base64url'))
    this.randomChallengeId = options.randomChallengeId ?? randomUUID
  }

  async receive(data: unknown, signal?: AbortSignal): Promise<ExtensionAuthServerMessage> {
    if (this.authenticated) return errorMessage('invalid-state', 'Extension is already authenticated')

    const parsed = parseExtensionAuthMessage(data)
    if (!parsed.success) {
      return parsed.code === 'unsupported-version'
        ? errorMessage('unsupported-version', 'Unsupported extension authentication version')
        : errorMessage('invalid-message', 'Invalid extension authentication message')
    }

    if (parsed.message.step === 'hello') return this.handleHello(parsed.message)
    return this.handleProof(parsed.message, signal)
  }

  private handleHello(hello: z.infer<typeof AuthHelloSchema>): ExtensionAuthServerMessage {
    if (this.pending || this.proofPending) {
      return errorMessage('invalid-state', 'Authentication challenge already issued')
    }
    try {
      createPublicKey({ key: hello.publicKey, format: 'jwk' })
    } catch {
      return errorMessage('invalid-message', 'Invalid extension authentication key')
    }

    const fingerprint = extensionKeyFingerprint(hello.publicKey)
    const challenge: ExtensionAuthChallenge = {
      type: 'frame-auth',
      version: EXTENSION_AUTH_VERSION,
      step: 'challenge',
      challengeId: this.randomChallengeId(),
      clientNonce: hello.clientNonce,
      serverNonce: this.randomNonce(),
      browser: this.extension.browser,
      extensionId: this.extension.id,
      installationId: hello.installationId,
      fingerprint,
      expiresAt: this.now() + EXTENSION_AUTH_CHALLENGE_TTL_MS
    }
    const candidate: ExtensionPairingCandidate = {
      protocolVersion: EXTENSION_AUTH_VERSION,
      installationId: hello.installationId,
      browser: this.extension.browser,
      extensionId: this.extension.id,
      publicKey: hello.publicKey,
      fingerprint,
      pairingCode: extensionPairingCode(challenge),
      pairedAt: this.now()
    }
    this.pending = { candidate, challenge, publicKey: hello.publicKey }
    return challenge
  }

  private async handleProof(
    proof: z.infer<typeof AuthProofSchema>,
    signal?: AbortSignal
  ): Promise<ExtensionAuthServerMessage> {
    if (this.proofPending) return errorMessage('invalid-state', 'Authentication proof is pending')
    const pending = this.pending
    this.pending = undefined
    if (!pending || proof.challengeId !== pending.challenge.challengeId) {
      return errorMessage('invalid-state', 'Authentication challenge does not match')
    }
    if (this.now() >= pending.challenge.expiresAt) {
      return errorMessage('expired', 'Extension authentication challenge expired')
    }
    if (!verifyExtensionProof(pending.publicKey, pending.challenge, proof.signature)) {
      return errorMessage('invalid-proof', 'Extension authentication proof is invalid')
    }

    this.proofPending = true
    let authorized = false
    try {
      authorized = await this.options.authorize(pending.candidate, signal)
    } catch {
      authorized = false
    } finally {
      this.proofPending = false
    }
    if (!authorized || signal?.aborted) {
      return errorMessage('denied', 'Wren Companion pairing was denied')
    }

    this.authenticated = true
    return {
      type: 'frame-auth',
      version: EXTENSION_AUTH_VERSION,
      step: 'authenticated',
      fingerprint: pending.challenge.fingerprint
    }
  }
}
