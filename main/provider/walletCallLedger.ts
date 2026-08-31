import store from '../store'
import { requireStoreAction } from '../store/action'
import type { WalletCallBatches } from '../store/state/types/walletCallBatch'
import operationLifecycleLedger from '../operationLifecycle'
import { WalletCallBatchLedger } from './walletCallBatches'
import { recordActivityReferenceForBatch } from '../activity/referenceRuntime'

export const walletCallBatchLedger = new WalletCallBatchLedger(
  {
    load: () => store('main.walletCallBatches'),
    save: (batches: WalletCallBatches) => {
      requireStoreAction('setWalletCallBatches')(batches)
    }
  },
  operationLifecycleLedger,
  recordActivityReferenceForBatch
)

export default walletCallBatchLedger
