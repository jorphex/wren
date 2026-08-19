import { createHash, randomBytes, randomUUID } from 'crypto'
import { z } from 'zod'

import type { DesktopAuthIdentity } from './desktopAuthIdentity'
import {
  PEER_AUTH_PROTOCOL,
  PEER_AUTH_VERSION,
  PeerAuthClientBundleIdentitySchema,
  PeerAuthFingerprintSchema,
  PeerAuthNonceSchema,
  PeerAuthSignatureSchema,
  PeerAuthTranscriptSchema,
  peerAuthClientRoleKey,
  peerAuthFingerprint,
  peerAuthTranscriptBytes,
  signPeerAuthChallenge,
  signPeerAuthFinalAck,
  verifyExpectedPeerAuthTranscript,
  type PeerAuthTranscript
} from './peerAuth'
import {
  ExtensionBrowserSchema,
  ExtensionCredentialSchema,
  ExtensionInstallationIdSchema,
  ExtensionPublicKeySchema,
  type ExtensionBrowser,
  type ExtensionCredential,
  type ExtensionPublicKey
} from '../store/state/types/extensionCredential'

export const EXTENSION_AUTH_VERSION = PEER_AUTH_VERSION
export const EXTENSION_AUTH_MAX_MESSAGE_BYTES = 16 * 1024
export const EXTENSION_AUTH_CHALLENGE_TTL_MS = 60 * 1000

const ChannelRoleSchema = z.enum(['control', 'page'])
const ChallengeIdSchema = z.uuid()

const ClientIdentitySchema = PeerAuthClientBundleIdentitySchema.extend({
  roleFingerprint: PeerAuthFingerprintSchema
}).strict()

const AuthHelloSchema = z
  .object({
    type: z.literal('frame-auth'),
    version: z.literal(EXTENSION_AUTH_VERSION),
    step: z.literal('hello'),
    peerKind: z.literal('companion'),
    channelRole: ChannelRoleSchema,
    clientNonce: PeerAuthNonceSchema,
    browser: ExtensionBrowserSchema.optional(),
    extensionId: z.string().min(1).max(128).optional(),
    client: ClientIdentitySchema
  })
  .strict()
  .superRefine((hello, context) => {
    if ((hello.browser === undefined) !== (hello.extensionId === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: hello.browser === undefined ? ['browser'] : ['extensionId'],
        message: 'Legacy transport identity must include both browser and extensionId'
      })
    }
  })

const AuthResponseSchema = z
  .object({
    type: z.literal('frame-auth'),
    version: z.literal(EXTENSION_AUTH_VERSION),
    step: z.literal('response'),
    peerKind: z.literal('companion'),
    channelRole: ChannelRoleSchema,
    challengeId: ChallengeIdSchema,
    signature: PeerAuthSignatureSchema
  })
  .strict()

const AuthMessageSchema = z.discriminatedUnion('step', [AuthHelloSchema, AuthResponseSchema])

const LegacyV2HelloSchema = z
  .object({
    type: z.literal('frame-auth'),
    version: z.literal(2),
    step: z.literal('hello'),
    clientNonce: PeerAuthNonceSchema,
    installationId: ExtensionInstallationIdSchema,
    publicKey: ExtensionPublicKeySchema
  })
  .strict()

export type ExtensionAuthClientMessage = z.infer<typeof AuthMessageSchema>

export interface ExtensionIdentity {
  browser: ExtensionBrowser
  id: string
  role: 'control' | 'page'
}

export interface ExtensionPairingCandidate extends ExtensionCredential {
  pairingCode: string
}

type DesktopWireIdentity = {
  installationId: string
  fingerprint: string
  publicKey: ExtensionPublicKey
}

type ClientWireIdentity = {
  installationId: string
  fingerprint: string
  roleFingerprint: string
}

export interface ExtensionAuthChallenge {
  type: 'frame-auth'
  version: 3
  step: 'challenge'
  peerKind: 'companion'
  channelRole: 'control' | 'page'
  challengeId: string
  desktopNonce: string
  clientNonce: string
  expiresAt: number
  desktop: DesktopWireIdentity
  client: ClientWireIdentity
  signature: string
}

export interface ExtensionAuthAcknowledgement {
  type: 'frame-auth'
  version: 3
  step: 'authenticated'
  peerKind: 'companion'
  channelRole: 'control' | 'page'
  challengeId: string
  desktopNonce: string
  clientNonce: string
  expiresAt: number
  desktop: Omit<DesktopWireIdentity, 'publicKey'>
  client: ClientWireIdentity
  signature: string
}

export type ExtensionAuthErrorCode =
  | 'denied'
  | 'expired'
  | 'invalid-message'
  | 'invalid-proof'
  | 'invalid-state'
  | 'pinned-desktop-mismatch'
  | 'unsupported-version'

export interface ExtensionAuthLegacyUpgradeError {
  type: 'frame-auth'
  version: 2
  step: 'error'
  code: 'unsupported-version'
  message: string
}

export type ExtensionAuthServerMessage =
  | ExtensionAuthChallenge
  | ExtensionAuthAcknowledgement
  | ExtensionAuthLegacyUpgradeError
  | {
      type: 'frame-auth'
      version: 3
      step: 'error'
      code: ExtensionAuthErrorCode
      message: string
    }

interface ExtensionAuthSessionOptions {
  authorize(candidate: ExtensionPairingCandidate, signal?: AbortSignal): Promise<boolean>
  commit(candidate: ExtensionPairingCandidate): boolean | Promise<boolean>
  desktopIdentity(): DesktopAuthIdentity
  now?: () => number
  randomNonce?: () => string
  randomChallengeId?: () => string
}

interface PendingChallenge {
  candidate: ExtensionPairingCandidate
  challenge: ExtensionAuthChallenge
  transcript: PeerAuthTranscript
  rolePublicKey: ExtensionPublicKey
}

const errorMessage = (code: ExtensionAuthErrorCode, message: string): ExtensionAuthServerMessage => ({
  type: 'frame-auth',
  version: EXTENSION_AUTH_VERSION,
  step: 'error',
  code,
  message
})

const legacyUpgradeMessage = (): ExtensionAuthLegacyUpgradeError => ({
  type: 'frame-auth',
  version: 2,
  step: 'error',
  code: 'unsupported-version',
  message:
    'Update Wren Companion — This version can’t verify Wren’s identity. Update the companion, then reconnect.'
})

const transcriptFor = (
  input: Omit<PeerAuthTranscript, 'protocol' | 'version' | 'peerKind'>
): PeerAuthTranscript =>
  PeerAuthTranscriptSchema.parse({
    protocol: PEER_AUTH_PROTOCOL,
    version: EXTENSION_AUTH_VERSION,
    peerKind: 'companion',
    ...input
  })

const challengeTranscript = (challenge: ExtensionAuthChallenge, role: PeerAuthTranscript['role']) =>
  transcriptFor({
    role,
    channelRole: challenge.channelRole,
    desktop: {
      installationId: challenge.desktop.installationId,
      fingerprint: challenge.desktop.fingerprint
    },
    client: challenge.client,
    challengeId: challenge.challengeId,
    desktopNonce: challenge.desktopNonce,
    clientNonce: challenge.clientNonce,
    expiresAt: challenge.expiresAt
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

function isRecognizableLegacyV2Hello(data: unknown) {
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > EXTENSION_AUTH_MAX_MESSAGE_BYTES) {
    return false
  }
  try {
    return LegacyV2HelloSchema.safeParse(JSON.parse(data)).success
  } catch {
    return false
  }
}

export const extensionKeyFingerprint = peerAuthFingerprint

/** Exact v3 desktop-challenge transcript bytes, shared with Companion. */
export function extensionAuthPayload(
  challenge: ExtensionAuthChallenge,
  role: PeerAuthTranscript['role'] = 'desktop-challenge'
) {
  return peerAuthTranscriptBytes(challengeTranscript(challenge, role))
}

export function extensionPairingCode(challenge: ExtensionAuthChallenge) {
  const digest = createHash('sha256').update(extensionAuthPayload(challenge)).digest()
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0')
}

export function verifyExtensionProof(
  publicKey: ExtensionPublicKey,
  challenge: ExtensionAuthChallenge,
  signature: string,
  now = Date.now()
) {
  return verifyExpectedPeerAuthTranscript(
    publicKey,
    {
      transcript: challengeTranscript(challenge, 'client-response'),
      signature
    },
    challengeTranscript(challenge, 'client-response'),
    now
  )
}

export class ExtensionAuthSession {
  authenticated = false
  private extension: ExtensionIdentity | undefined
  private readonly channelRole: ExtensionIdentity['role']
  private pending: PendingChallenge | undefined
  private responsePending = false
  private readonly now: () => number
  private readonly randomNonce: () => string
  private readonly randomChallengeId: () => string
  private readonly desktopIdentity: () => DesktopAuthIdentity

  constructor(
    extension: ExtensionIdentity,
    private readonly options: ExtensionAuthSessionOptions
  ) {
    this.extension = extension
    this.channelRole = extension.role
    this.now = options.now ?? Date.now
    this.randomNonce = options.randomNonce ?? (() => randomBytes(32).toString('base64url'))
    this.randomChallengeId = options.randomChallengeId ?? randomUUID
    this.desktopIdentity = options.desktopIdentity
  }

  async receive(data: unknown, signal?: AbortSignal): Promise<ExtensionAuthServerMessage> {
    if (this.authenticated) return errorMessage('invalid-state', 'Companion is already authenticated')

    if (isRecognizableLegacyV2Hello(data)) return legacyUpgradeMessage()

    const parsed = parseExtensionAuthMessage(data)
    if (!parsed.success) {
      return parsed.code === 'unsupported-version'
        ? errorMessage(
            'unsupported-version',
            'Companion protocol v2 is no longer supported. Update Companion to authenticate with Wren.'
          )
        : errorMessage('invalid-message', 'Invalid Companion authentication message')
    }

    return parsed.message.step === 'hello'
      ? this.handleHello(parsed.message)
      : this.handleResponse(parsed.message, signal)
  }

  private handleHello(hello: z.infer<typeof AuthHelloSchema>): ExtensionAuthServerMessage {
    if (this.pending || this.responsePending) {
      return errorMessage('invalid-state', 'Authentication challenge already issued')
    }
    const extension = this.extension
    if (!extension || hello.channelRole !== this.channelRole) {
      return errorMessage('invalid-state', 'Companion identity does not match this connection')
    }
    const legacyIdentity = hello.browser !== undefined && hello.extensionId !== undefined
    if (legacyIdentity && (hello.browser !== extension.browser || hello.extensionId !== extension.id)) {
      return errorMessage('invalid-state', 'Companion identity does not match this connection')
    }
    const rolePublicKey = peerAuthClientRoleKey(hello.client.publicKeys, hello.channelRole)
    if (peerAuthFingerprint(rolePublicKey) !== hello.client.roleFingerprint) {
      return errorMessage('invalid-message', 'Companion channel role key does not match its fingerprint')
    }

    // The browser/runtime UUID is transport evidence only. It is validated for
    // legacy clients, then discarded before pairing state is constructed.
    this.extension = undefined

    try {
      const desktop = this.desktopIdentity()
      const expiresAt = this.now() + EXTENSION_AUTH_CHALLENGE_TTL_MS
      const transcript = transcriptFor({
        role: 'desktop-challenge',
        channelRole: hello.channelRole,
        desktop: { installationId: desktop.installationId, fingerprint: desktop.fingerprint },
        client: {
          installationId: hello.client.installationId,
          fingerprint: hello.client.fingerprint,
          roleFingerprint: hello.client.roleFingerprint
        },
        challengeId: this.randomChallengeId(),
        desktopNonce: this.randomNonce(),
        clientNonce: hello.clientNonce,
        expiresAt
      })
      const signature = signPeerAuthChallenge(desktop.privateKey, transcript).signature
      const challenge: ExtensionAuthChallenge = {
        type: 'frame-auth',
        version: EXTENSION_AUTH_VERSION,
        step: 'challenge',
        peerKind: 'companion',
        channelRole: hello.channelRole,
        challengeId: transcript.challengeId,
        desktopNonce: transcript.desktopNonce,
        clientNonce: transcript.clientNonce,
        expiresAt: transcript.expiresAt,
        desktop: {
          installationId: desktop.installationId,
          fingerprint: desktop.fingerprint,
          publicKey: desktop.publicKey
        },
        client: transcript.client,
        signature
      }
      const credential = ExtensionCredentialSchema.parse({
        protocolVersion: EXTENSION_AUTH_VERSION,
        installationId: hello.client.installationId,
        publicKeys: hello.client.publicKeys,
        fingerprint: hello.client.fingerprint,
        pairedAt: this.now()
      })
      const candidate: ExtensionPairingCandidate = {
        ...credential,
        pairingCode: extensionPairingCode(challenge)
      }
      this.pending = { candidate, challenge, transcript, rolePublicKey }
      return challenge
    } catch {
      return errorMessage('invalid-state', 'Desktop authentication identity is unavailable')
    }
  }

  private async handleResponse(
    response: z.infer<typeof AuthResponseSchema>,
    signal?: AbortSignal
  ): Promise<ExtensionAuthServerMessage> {
    if (this.responsePending) return errorMessage('invalid-state', 'Authentication response is pending')
    const pending = this.pending
    this.pending = undefined
    if (
      !pending ||
      response.peerKind !== 'companion' ||
      response.channelRole !== pending.challenge.channelRole ||
      response.challengeId !== pending.challenge.challengeId
    ) {
      return errorMessage('invalid-state', 'Authentication challenge does not match')
    }
    if (this.now() >= pending.transcript.expiresAt) {
      return errorMessage('expired', 'Companion authentication challenge expired')
    }
    if (!verifyExtensionProof(pending.rolePublicKey, pending.challenge, response.signature, this.now())) {
      return errorMessage('invalid-proof', 'Companion authentication proof is invalid')
    }

    this.responsePending = true
    try {
      if (!(await this.options.authorize(pending.candidate, signal)) || signal?.aborted) {
        return errorMessage('denied', 'Wren Companion pairing was denied')
      }
      const desktop = this.desktopIdentity()
      if (
        desktop.installationId !== pending.challenge.desktop.installationId ||
        desktop.fingerprint !== pending.challenge.desktop.fingerprint
      ) {
        return errorMessage('invalid-state', 'Desktop authentication identity changed during pairing')
      }
      const acknowledgementTranscript = { ...pending.transcript, role: 'desktop-ack' as const }
      const signature = signPeerAuthFinalAck(desktop.privateKey, acknowledgementTranscript).signature
      if (!(await this.options.commit(pending.candidate))) {
        return errorMessage('denied', 'Wren Companion pairing could not be committed')
      }
      this.authenticated = true
      return {
        type: 'frame-auth',
        version: EXTENSION_AUTH_VERSION,
        step: 'authenticated',
        peerKind: 'companion',
        channelRole: pending.challenge.channelRole,
        challengeId: pending.challenge.challengeId,
        desktopNonce: pending.challenge.desktopNonce,
        clientNonce: pending.challenge.clientNonce,
        expiresAt: pending.challenge.expiresAt,
        desktop: {
          installationId: pending.challenge.desktop.installationId,
          fingerprint: pending.challenge.desktop.fingerprint
        },
        client: pending.challenge.client,
        signature
      }
    } catch {
      return errorMessage('denied', 'Wren Companion pairing was denied')
    } finally {
      this.responsePending = false
    }
  }
}
