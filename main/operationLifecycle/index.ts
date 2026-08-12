import store from '../store'
import { requireStoreAction } from '../store/action'
import type { OperationLifecycles } from '../store/state/types/operationLifecycle'
import { OperationLifecycleLedger } from './ledger'

export const operationLifecycleLedger = new OperationLifecycleLedger({
  load: () => store('main.operationLifecycles'),
  save: (operations: OperationLifecycles) => {
    requireStoreAction('setOperationLifecycles')(operations)
  }
})

export default operationLifecycleLedger
