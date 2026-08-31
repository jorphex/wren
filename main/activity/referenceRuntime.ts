import store from '../store'
import { requireStoreAction } from '../store/action'
import {
  activityTransactionReferenceForOperation,
  type ActivityTransactionReference
} from '../store/state/types/activityTransactionReference'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import type { WalletCallBatch, WalletCallBatches } from '../store/state/types/walletCallBatch'

const record = (reference: ActivityTransactionReference | undefined) => {
  if (reference) requireStoreAction('recordActivityTransactionReference')(reference)
}

export const recordActivityReferenceForOperation = (operation: OperationLifecycle) => {
  const batches = (store('main.walletCallBatches') || {}) as WalletCallBatches
  record(activityTransactionReferenceForOperation(operation, batches))
}

export const recordActivityReferenceForBatch = (batch: WalletCallBatch) => {
  if (!batch.operationId) return
  const operations = (store('main.operationLifecycles') || {}) as Record<string, OperationLifecycle>
  const operation = operations[batch.operationId]
  if (!operation || operation.walletCalls?.batchOperationId !== batch.operationId) return
  record(activityTransactionReferenceForOperation(operation, { [batch.id]: batch }))
}
