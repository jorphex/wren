import store from '../store'
import { requireStoreAction } from '../store/action'
import operationLifecycleRuntime from '../operationLifecycle/runtime'

import type { OperationReconciliationObservation } from '../operationLifecycle/reconciler'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const MAX_PENDING_RECIPIENTS = 100

export type RecentRecipientCandidate = Readonly<{
  operationId: string
  address: string
}>

export const shouldClearRecentRecipientCandidates = (action: unknown, args: readonly unknown[]) =>
  action === 'clearActivity' ||
  action === 'clearRecentRecipients' ||
  (action === 'setRememberRecentRecipients' && args[0] !== true)

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
  private removeObserver: (() => void) | undefined

  start() {
    if (this.removeObserver) return
    this.removeObserver = operationLifecycleRuntime.observe((observation) => this.observe(observation))
  }

  stop() {
    this.removeObserver?.()
    this.removeObserver = undefined
    this.clearCandidates()
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
    return this.candidates.delete(operationId)
  }

  clearCandidates() {
    this.candidates.clear()
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
    } catch {
      // Recipient convenience state must never affect authoritative lifecycle reconciliation.
    }
  }

  private observe({ current }: OperationReconciliationObservation) {
    if (current.kind !== 'transaction' && current.kind !== 'walletCalls') return

    if (['submitted', 'reorged', 'failed', 'replaced', 'stopped'].includes(current.state)) {
      this.removePersistedUse(current.id)
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
    const candidate = this.candidates.get(current.id)
    if (candidate && store('main.rememberRecentRecipients') === true) {
      const successful = current.kind === 'walletCalls' || current.receipt?.status === '0x1'
      if (successful) this.recordPersistedUse(candidate, current.updatedAt)
    }

    if (current.settlement?.status === 'complete') this.candidates.delete(current.id)
  }
}

export const recentRecipientsRuntime = new RecentRecipientsRuntime()
export default recentRecipientsRuntime
