import store from '../store'
import { requireStoreAction } from '../store/action'
import operationLifecycleRuntime from '../operationLifecycle/runtime'
import operationLifecycleLedger from '../operationLifecycle'

import type { OperationReconciliationObservation } from '../operationLifecycle/reconciler'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const MAX_PENDING_RECIPIENTS = 100

export type RecentRecipientCandidate = Readonly<{
  operationId: string
  address: string
}>

export type RecentRecipientPrivacyAction = 'disable' | 'clear' | 'activity'
export type RecentRecipientPrivacyResult =
  | Readonly<{ success: true; durable: true }>
  | Readonly<{
      success: false
      durable: false
      sessionOnly: true
      error: 'metadata-removal-failed' | 'persistence-failed'
    }>

export const applyRecentRecipientPrivacyAction = (
  action: RecentRecipientPrivacyAction,
  dependencies: Readonly<{
    updateSession: (action: RecentRecipientPrivacyAction) => void
    clearPendingMetadata: () => boolean
    commit: () => void
  }>
): RecentRecipientPrivacyResult => {
  dependencies.updateSession(action)
  if (!dependencies.clearPendingMetadata()) {
    return {
      success: false,
      durable: false,
      sessionOnly: true,
      error: 'metadata-removal-failed'
    }
  }
  try {
    dependencies.commit()
    return { success: true, durable: true }
  } catch {
    return { success: false, durable: false, sessionOnly: true, error: 'persistence-failed' }
  }
}

const normalizeCandidate = (candidate: RecentRecipientCandidate): RecentRecipientCandidate => {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.operationId !== 'string' ||
    !candidate.operationId ||
    typeof candidate.address !== 'string' ||
    !ADDRESS.test(candidate.address)
  ) {
    throw new Error('Invalid recent-recipient candidate')
  }

  return Object.freeze({
    operationId: candidate.operationId,
    address: candidate.address.toLowerCase()
  })
}

export class RecentRecipientsRuntime {
  private candidates = new Map<string, RecentRecipientCandidate>()
  private suppressedPendingRecipients = new Set<string>()
  private suppressedPendingOutbound = new Set<string>()
  private removeObserver: (() => void) | undefined

  start() {
    if (this.removeObserver) return
    this.removeObserver = operationLifecycleRuntime.observe((observation) => this.observe(observation))
  }

  stop() {
    this.removeObserver?.()
    this.removeObserver = undefined
    this.candidates.clear()
    this.suppressedPendingRecipients.clear()
    this.suppressedPendingOutbound.clear()
  }

  track(candidate: RecentRecipientCandidate) {
    if (store('main.rememberRecentRecipients') !== true) return false
    let normalized: RecentRecipientCandidate
    try {
      normalized = normalizeCandidate(candidate)
    } catch {
      return false
    }

    this.candidates.delete(normalized.operationId)
    this.candidates.set(normalized.operationId, normalized)
    while (this.candidates.size > MAX_PENDING_RECIPIENTS) {
      const oldest = this.candidates.keys().next().value
      if (typeof oldest !== 'string') break
      this.candidates.delete(oldest)
    }
    return true
  }

  forget(operationId: string) {
    const removed = this.candidates.delete(operationId)
    this.suppressedPendingRecipients.delete(operationId)
    this.suppressedPendingOutbound.delete(operationId)
    return removed
  }

  clearCandidates({ outbound = false }: Readonly<{ outbound?: boolean }> = {}) {
    this.candidates.clear()
    let cleared = true
    operationLifecycleLedger
      .listStored()
      .filter(
        ({ broadcast }) => broadcast?.pendingRecipient || (outbound && broadcast?.pendingOutboundFingerprints)
      )
      .forEach((operation) => {
        if (operation.broadcast?.pendingRecipient) this.suppressedPendingRecipients.add(operation.id)
        if (outbound && operation.broadcast?.pendingOutboundFingerprints) {
          this.suppressedPendingOutbound.add(operation.id)
        }
        if (!this.removePendingMetadata(operation, { recipient: true, outbound })) cleared = false
      })
    return cleared
  }

  private removePersistedUse(operationId: string) {
    try {
      requireStoreAction('removeRecentRecipientUse')(operationId)
    } catch {
      // Recipient convenience state must never affect authoritative lifecycle reconciliation.
    }
  }

  private recordPersistedUse(candidate: RecentRecipientCandidate, confirmedAt: number) {
    try {
      requireStoreAction('recordRecentRecipientUse')({
        operationId: candidate.operationId,
        address: candidate.address,
        confirmedAt
      })
      return true
    } catch {
      // Recipient convenience state must never affect authoritative lifecycle reconciliation.
      return false
    }
  }

  private recordOutboundFingerprints(
    fingerprints: NonNullable<NonNullable<OperationLifecycle['broadcast']>['pendingOutboundFingerprints']>,
    confirmedAt: number
  ) {
    try {
      requireStoreAction('recordOutboundAddressFingerprints')(fingerprints, confirmedAt)
      return true
    } catch {
      return false
    }
  }

  private removePendingMetadata(
    operation: OperationLifecycle,
    remove: Readonly<{ recipient?: boolean; outbound?: boolean }>
  ) {
    const stored = operationLifecycleLedger.get(operation.id) || operation
    if (!stored.broadcast) return true
    const broadcast = { ...stored.broadcast }
    if (remove.recipient) delete broadcast.pendingRecipient
    if (remove.outbound) delete broadcast.pendingOutboundFingerprints
    try {
      operationLifecycleLedger.put(
        {
          ...stored,
          updatedAt: Math.min(Math.max(Date.now(), stored.updatedAt), stored.expiresAt),
          broadcast
        },
        -1
      )
      return true
    } catch {
      return false
    }
  }

  private observe({ current }: OperationReconciliationObservation) {
    if (current.kind !== 'transaction' && current.kind !== 'walletCalls') return
    const stored = operationLifecycleLedger.get(current.id)
    const broadcast = stored ? stored.broadcast : current.broadcast
    const pendingRecipient = broadcast?.pendingRecipient
    const pendingOutboundFingerprints = broadcast?.pendingOutboundFingerprints

    if (['submitted', 'reorged', 'failed', 'replaced', 'stopped'].includes(current.state)) {
      this.removePersistedUse(current.id)
      if (['failed', 'replaced', 'stopped'].includes(current.state)) {
        this.removePendingMetadata(current, { recipient: true, outbound: true })
        this.candidates.delete(current.id)
        this.suppressedPendingRecipients.delete(current.id)
        this.suppressedPendingOutbound.delete(current.id)
      }
      if (
        current.state === 'replaced' ||
        current.state === 'stopped' ||
        current.settlement?.status === 'complete'
      ) {
        this.candidates.delete(current.id)
      }
      return
    }

    if (current.state !== 'confirmed') return
    const remembered = store('main.rememberRecentRecipients') === true
    const recipientSuppressed = this.suppressedPendingRecipients.has(current.id)
    const candidate = recipientSuppressed
      ? undefined
      : this.candidates.get(current.id) ||
        (pendingRecipient ? { operationId: current.id, address: pendingRecipient } : undefined)
    const successful = current.kind === 'walletCalls' || current.receipt?.status === '0x1'
    let removeOutbound = false
    if (pendingOutboundFingerprints) {
      if (this.suppressedPendingOutbound.has(current.id)) {
        removeOutbound = true
      } else if (successful) {
        if (this.recordOutboundFingerprints(pendingOutboundFingerprints, current.updatedAt)) {
          removeOutbound = true
        }
      } else {
        removeOutbound = true
      }
    }
    let removeRecipient = Boolean(pendingRecipient && (recipientSuppressed || !remembered || !successful))
    if (candidate && remembered && successful) {
      const recentRecorded = this.recordPersistedUse(candidate, current.updatedAt)
      if (pendingRecipient && recentRecorded) removeRecipient = true
    }
    if (removeRecipient || removeOutbound) {
      this.removePendingMetadata(current, { recipient: removeRecipient, outbound: removeOutbound })
    }

    if (current.settlement?.status === 'complete') {
      this.candidates.delete(current.id)
      this.suppressedPendingRecipients.delete(current.id)
      this.suppressedPendingOutbound.delete(current.id)
    }
  }
}

export const recentRecipientsRuntime = new RecentRecipientsRuntime()
export default recentRecipientsRuntime
