import log from 'electron-log'

import connection from '../chains'
import operationLifecycleLedger from '../operationLifecycle'
import { publishOperationLifecycleObservation } from '../operationLifecycle/events'
import walletCallBatchLedger from './walletCallLedger'
import { WalletCallEvidenceController } from './walletCallEvidenceController'
import { createWalletCallEvidenceRPC } from './walletCallEvidenceRPC'
import { WalletCallLifecycleReconciler } from './walletCallLifecycleReconciliation'

const evidenceRPC = createWalletCallEvidenceRPC(connection)
const lifecycleReconciler = new WalletCallLifecycleReconciler(
  walletCallBatchLedger,
  operationLifecycleLedger,
  evidenceRPC.rpc,
  publishOperationLifecycleObservation
)

export const walletCallEvidenceRuntime = new WalletCallEvidenceController({
  poll: async () => {
    const outcomes = await lifecycleReconciler.reconcileAll()
    const continuePolling = operationLifecycleLedger
      .listStored()
      .some(
        (operation) =>
          operation.kind === 'walletCalls' && ['submitted', 'confirming', 'reorged'].includes(operation.state)
      )
    return {
      reconciliation: outcomes.map((outcome) => ({
        status:
          outcome.status === 'error'
            ? ('error' as const)
            : outcome.status === 'updated'
              ? ('transaction-submitted' as const)
              : ('unresolved' as const),
        ...(outcome.reason ? { reason: outcome.reason } : {})
      })),
      receipts: [],
      continuePolling
    }
  },
  reportError: (error) => log.warn('Wallet-call evidence polling error', error)
})

export default walletCallEvidenceRuntime
