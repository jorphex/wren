import type { ActivityEntry } from '../store/state/types/activity'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import type { OperationLifecycleLedger } from './ledger'
import { requireStoreAction } from '../store/action'
import { notifyWalletActivity, type WalletActivityNotificationOutcome } from '../notifications/transaction'

export const LONG_PENDING_NOTIFICATION_MS = 5 * 60 * 1000

const terminalStates = new Set<OperationLifecycle['state']>([
  'confirmed',
  'failed',
  'replaced',
  'stopped',
  'clearance-unverified',
  'verified-clearance'
])

const activityEntry = (operation: OperationLifecycle): ActivityEntry => ({
  id: operation.id,
  account: operation.account,
  origin: operation.origin,
  type: operation.kind,
  outcome: operation.state,
  ...(operation.state === 'submitted' && operation.broadcast
    ? { broadcastPhase: operation.broadcast.phase }
    : {}),
  createdAt: operation.createdAt,
  completedAt: operation.updatedAt,
  chainId: operation.chainId
})

const terminalNotification = (
  state: OperationLifecycle['state']
): WalletActivityNotificationOutcome | undefined => {
  if (state === 'confirmed' || state === 'verified-clearance') return 'confirmed'
  if (state === 'failed') return 'failed'
  if (state === 'replaced') return 'replaced'
  return undefined
}

export class OperationLifecycleProjection {
  private readonly pendingEvidence = new Set<string>()

  constructor(
    private readonly ledger: OperationLifecycleLedger,
    private readonly recordReference: (operation: OperationLifecycle) => void = () => {},
    private readonly activityClearedAt: () => number = () => 0
  ) {}

  private visibleAfterClear(operation: OperationLifecycle) {
    const clearedAt = this.activityClearedAt()
    return (
      operation.visibleInActivity &&
      (clearedAt <= 0 || operation.createdAt >= clearedAt || operation.updatedAt > clearedAt)
    )
  }

  private record(operation: OperationLifecycle) {
    if (this.visibleAfterClear(operation)) {
      requireStoreAction('recordActivity')(activityEntry(operation))
      this.recordReference(operation)
    }
  }

  project(
    operationId: string,
    now = Date.now(),
    recordObservation = true,
    reconciliationPendingEvidence?: boolean
  ) {
    if (reconciliationPendingEvidence === true) this.pendingEvidence.add(operationId)
    else if (reconciliationPendingEvidence === false) this.pendingEvidence.delete(operationId)

    const operation = this.ledger.listStored().find(({ id }) => id === operationId)
    if (!operation) {
      this.pendingEvidence.delete(operationId)
      return
    }
    if (!['submitted', 'confirming', 'reorged'].includes(operation.state)) {
      this.pendingEvidence.delete(operation.id)
    }
    if (operation.expiresAt <= now && ['submitted', 'confirming', 'reorged'].includes(operation.state)) {
      return
    }

    const notification = { ...operation.notification }
    const unhandledTerminal =
      terminalStates.has(operation.state) && notification.terminalHandledAt === undefined
    const pendingDue =
      this.visibleAfterClear(operation) &&
      ['submitted', 'confirming', 'reorged'].includes(operation.state) &&
      this.pendingEvidence.has(operation.id) &&
      notification.longPendingShownAt === undefined &&
      now - operation.createdAt >= LONG_PENDING_NOTIFICATION_MS

    if (recordObservation || unhandledTerminal || pendingDue) this.record(operation)

    if (pendingDue) {
      const outcome =
        operation.broadcast?.phase === 'broadcasting' ? 'long-pending-broadcasting' : 'long-pending'
      const delivered = notifyWalletActivity(operation.id, operation.account, outcome)
      if (delivered) notification.longPendingShownAt = Math.min(now, operation.expiresAt)
    }

    if (terminalStates.has(operation.state) && notification.terminalHandledAt === undefined) {
      const outcome = this.visibleAfterClear(operation) ? terminalNotification(operation.state) : undefined
      if (outcome) notifyWalletActivity(operation.id, operation.account, outcome)
      notification.terminalHandledAt = Math.min(now, operation.expiresAt)
    }

    if (
      notification.terminalHandledAt !== operation.notification.terminalHandledAt ||
      notification.longPendingShownAt !== operation.notification.longPendingShownAt
    ) {
      this.ledger.put({ ...operation, notification }, -1)
    }

    const current = this.ledger.listStored().find(({ id }) => id === operation.id)
    if (
      current &&
      terminalStates.has(current.state) &&
      current.notification.terminalHandledAt !== undefined &&
      current.expiresAt <= now
    ) {
      this.ledger.remove(current.id, -1)
      this.pendingEvidence.delete(current.id)
    }
  }

  projectAll(now = Date.now()) {
    this.ledger.listStored().forEach(({ id }) => this.project(id, now, false))
  }

  restoreBroadcastReservations(now = Date.now()) {
    this.ledger
      .listStored()
      .filter(({ broadcast, state }) => state === 'submitted' && broadcast?.phase === 'broadcasting')
      .forEach(({ id }) => this.project(id, now, true))
  }
}
