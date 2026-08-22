import store from '../store'
import { requireStoreAction } from '../store/action'
import type { OperationLifecycles } from '../store/state/types/operationLifecycle'
import { OperationLifecycleLedger } from './ledger'

export const operationLifecycleLedger = new OperationLifecycleLedger(
  {
    load: () => store('main.operationLifecycles'),
    save: (operations: OperationLifecycles) => {
      requireStoreAction('setOperationLifecycles')(operations)
    }
  },
  {
    // Verification jobs are capped independently; retained evidence still counts toward the lifecycle cap.
    isReferenced: (operationId) =>
      store('main.contractVerificationJobs').some(
        ({ target }) => target.creationEvidence?.operationId === operationId
      )
  }
)

export default operationLifecycleLedger
