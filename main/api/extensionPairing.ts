import { v4 as uuid } from 'uuid'

import { EXTENSION_OWNER_PREFIX, notificationByOwner } from '../../resources/store/notifications'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { ExtensionCredentialSchema, type ExtensionCredential } from '../store/state/types/extensionCredential'
import type { ExtensionPairingCandidate } from './extensionAuth'
import { disconnectExtensionCredential } from './extensionConnections'

interface PendingPairing {
  candidate: ExtensionPairingCandidate
  notificationObserver?: { remove(): void }
  promise: Promise<boolean>
  requestId: string
  settle(approved: boolean): void
  waiters: number
}

export interface RevokedCompanionAccess {
  account: string
  originIds: string[]
}

const activeByIdentity = new Map<string, PendingPairing>()
const activeByRequest = new Map<string, PendingPairing>()
const rejectedIdentities = new Set<string>()

const pairingIdentity = ({ browser, extensionId, installationId }: ExtensionPairingCandidate) =>
  `${browser}:${extensionId}:${installationId}`

const pairingNotification = (requestId: string) =>
  notificationByOwner(
    (store('view.notifyQueue') || []) as Array<{ id: string; owner: string }>,
    `${EXTENSION_OWNER_PREFIX}${requestId}`
  )

function credentialMatches(candidate: ExtensionPairingCandidate, credential: ExtensionCredential) {
  return (
    credential.protocolVersion === candidate.protocolVersion &&
    credential.installationId === candidate.installationId &&
    credential.browser === candidate.browser &&
    credential.extensionId === candidate.extensionId &&
    credential.fingerprint === candidate.fingerprint &&
    credential.publicKey.x === candidate.publicKey.x &&
    credential.publicKey.y === candidate.publicKey.y
  )
}

function storedCredential(fingerprint: string) {
  return ExtensionCredentialSchema.safeParse(store('main.extensionCredentials', fingerprint))
}

function replaceIdentityCredentials(
  candidate: ExtensionPairingCandidate,
  revokeCredential: (fingerprint: string) => RevokedCompanionAccess[]
) {
  const credentials: Record<string, unknown> = store('main.extensionCredentials') || {}
  Object.entries(credentials).forEach(([fingerprint, value]) => {
    const parsed = ExtensionCredentialSchema.safeParse(value)
    if (
      parsed.success &&
      parsed.data.browser === candidate.browser &&
      parsed.data.extensionId === candidate.extensionId &&
      parsed.data.installationId === candidate.installationId &&
      fingerprint !== candidate.fingerprint
    ) {
      revokeCredential(fingerprint)
    }
  })
}

function finishPairing(pending: PendingPairing, approved: boolean) {
  if (activeByRequest.get(pending.requestId) !== pending) return
  activeByRequest.delete(pending.requestId)
  activeByIdentity.delete(pairingIdentity(pending.candidate))
  pending.notificationObserver?.remove()
  delete pending.notificationObserver
  const notification = pairingNotification(pending.requestId)
  if (notification) requireStoreAction('notify')('', {}, { expectedId: notification.id })
  pending.settle(approved)
}

function waitForPairing(pending: PendingPairing, signal?: AbortSignal) {
  if (signal?.aborted) {
    if (pending.waiters === 0) finishPairing(pending, false)
    return Promise.resolve(false)
  }
  pending.waiters += 1

  return new Promise<boolean>((resolve) => {
    let waiting = true
    const finish = (approved: boolean) => {
      if (!waiting) return
      waiting = false
      pending.waiters = Math.max(0, pending.waiters - 1)
      signal?.removeEventListener('abort', abort)
      resolve(approved)
    }
    const abort = () => {
      finish(false)
      if (pending.waiters > 0) return
      finishPairing(pending, false)
    }

    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    pending.promise.then(finish)
  })
}

export async function authorizeExtension(
  candidate: ExtensionPairingCandidate,
  signal?: AbortSignal,
  allowPairing = true
): Promise<boolean> {
  const { pairingCode: _pairingCode, ...candidateCredential } = candidate
  const parsedCandidate = ExtensionCredentialSchema.safeParse(candidateCredential)
  if (!parsedCandidate.success || signal?.aborted) return false

  const existing = storedCredential(candidate.fingerprint)
  if (existing.success && credentialMatches(candidate, existing.data)) return true
  if (!allowPairing) return false

  const identity = pairingIdentity(candidate)
  if (rejectedIdentities.has(identity)) return false
  const active = activeByIdentity.get(identity)
  if (active) {
    return credentialMatches(candidate, active.candidate) &&
      candidate.pairingCode === active.candidate.pairingCode
      ? waitForPairing(active, signal)
      : false
  }
  if (activeByRequest.size > 0) return false

  let settle = (_approved: boolean) => {}
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  const pending: PendingPairing = {
    candidate,
    promise,
    requestId: uuid(),
    settle,
    waiters: 0
  }
  activeByIdentity.set(identity, pending)
  activeByRequest.set(pending.requestId, pending)
  requireStoreAction('notify')('extensionConnect', {
    ...candidate,
    requestId: pending.requestId
  })
  pending.notificationObserver = store.observer(() => {
    if (activeByRequest.get(pending.requestId) !== pending) return
    if (!pairingNotification(pending.requestId)) finishPairing(pending, false)
  }, `extension-pairing:${pending.requestId}`)
  return waitForPairing(pending, signal)
}

export function respondToExtensionPairing(
  requestId: string,
  approved: boolean,
  revokeCredential = revokeExtensionCredential
) {
  const pending = activeByRequest.get(requestId)
  if (!pending) return false

  const identity = pairingIdentity(pending.candidate)
  if (approved) {
    const { pairingCode: _pairingCode, ...credential } = pending.candidate
    replaceIdentityCredentials(pending.candidate, revokeCredential)
    requireStoreAction('setExtensionCredential')(credential)
    rejectedIdentities.delete(identity)
  } else {
    rejectedIdentities.add(identity)
  }
  finishPairing(pending, approved)
  return true
}

export function revokeExtensionCredential(fingerprint: string): RevokedCompanionAccess[] {
  requireStoreAction('removeExtensionCredential')(fingerprint)
  disconnectExtensionCredential(fingerprint)

  const origins = (store('main.origins') || {}) as Record<string, { provenance?: string; sourceId?: string }>
  const companionOriginIds = Object.entries(origins)
    .filter(([, origin]) => origin.provenance === 'companion' && origin.sourceId === fingerprint)
    .map(([originId]) => originId)
  if (companionOriginIds.length === 0) return []

  const companionOrigins = new Set(companionOriginIds)
  const permissions = (store('main.permissions') || {}) as Record<string, Record<string, unknown>>
  return Object.entries(permissions).flatMap(([account, grants]) => {
    const originIds = Object.keys(grants).filter((originId) => companionOrigins.has(originId))
    originIds.forEach((originId) => requireStoreAction('toggleAccess')(account, originId, false))
    return originIds.length > 0 ? [{ account, originIds }] : []
  })
}
