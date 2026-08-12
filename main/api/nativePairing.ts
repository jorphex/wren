import { v4 as uuid } from 'uuid'

import { NATIVE_OWNER_PREFIX, notificationByOwner } from '../../resources/store/notifications'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { NativePeerCredentialSchema, type NativePeerCredential } from '../store/state/types/peerCredential'
import { revokeNativePeerAccess, type RevokedNativeAccess } from './peerRevocation'

interface PendingPairing {
  credential: NativePeerCredential
  pairingCode: string
  notificationObserver?: { remove(): void }
  promise: Promise<boolean>
  requestId: string
  settle(approved: boolean): void
  waiters: number
}

const activeByRequest = new Map<string, PendingPairing>()
const activeByIdentity = new Map<string, PendingPairing>()

const pairingNotification = (requestId: string) =>
  notificationByOwner(
    (store('view.notifyQueue') || []) as Array<{ id: string; owner: string }>,
    `${NATIVE_OWNER_PREFIX}${requestId}`
  )

function finishPairing(pending: PendingPairing, approved: boolean) {
  if (activeByRequest.get(pending.requestId) !== pending) return
  activeByRequest.delete(pending.requestId)
  activeByIdentity.delete(pending.credential.installationId)
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
      if (pending.waiters === 0) finishPairing(pending, false)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    pending.promise.then(finish)
  })
}

export function authorizeNativePeer(
  credentialInput: NativePeerCredential,
  pairingCode: string,
  signal?: AbortSignal
): Promise<boolean> {
  const parsed = NativePeerCredentialSchema.safeParse(credentialInput)
  if (!parsed.success || !/^\d{6}$/u.test(pairingCode) || signal?.aborted) {
    return Promise.resolve(false)
  }
  const credential = parsed.data
  const active = activeByIdentity.get(credential.installationId)
  if (active) {
    return active.credential.fingerprint === credential.fingerprint && active.pairingCode === pairingCode
      ? waitForPairing(active, signal)
      : Promise.resolve(false)
  }
  if (activeByRequest.size > 0) return Promise.resolve(false)

  let settle = (_approved: boolean) => {}
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  const pending: PendingPairing = {
    credential,
    pairingCode,
    promise,
    requestId: uuid(),
    settle,
    waiters: 0
  }
  activeByRequest.set(pending.requestId, pending)
  activeByIdentity.set(credential.installationId, pending)
  requireStoreAction('notify')('nativeConnect', {
    requestId: pending.requestId,
    fingerprint: credential.fingerprint,
    pairingCode
  })
  pending.notificationObserver = store.observer(() => {
    if (activeByRequest.get(pending.requestId) !== pending) return
    if (!pairingNotification(pending.requestId)) finishPairing(pending, false)
  }, `native-pairing:${pending.requestId}`)
  return waitForPairing(pending, signal)
}

export function respondToNativePairing(requestId: string, approved: boolean) {
  const pending = activeByRequest.get(requestId)
  if (!pending) return false
  finishPairing(pending, approved)
  return true
}

export function revokeNativePeerCredential(fingerprint: string): RevokedNativeAccess[] {
  return revokeNativePeerAccess(fingerprint)
}

export function resetNativePairingForTests() {
  activeByRequest.forEach((pending) => finishPairing(pending, false))
  activeByRequest.clear()
  activeByIdentity.clear()
}
