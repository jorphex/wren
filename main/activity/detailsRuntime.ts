import { createActivityDetailsService } from './details'
import chains from '../chains'
import { createWalletCallEvidenceRPC } from '../provider/walletCallEvidenceRPC'
import store from '../store'

const activityDetailsRpc = createWalletCallEvidenceRPC(chains).rpc

const activityDetails = createActivityDetailsService({
  activity: () => store('main.activity'),
  references: () => store('main.activityTransactionReferences'),
  operations: () => store('main.operationLifecycles'),
  batches: () => store('main.walletCallBatches'),
  rpc: activityDetailsRpc
})

export default activityDetails
