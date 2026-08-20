import store from '../store'
import { requireStoreAction } from '../store/action'
import type { ContractVerificationJobs } from '../store/state/types/contractVerification'
import { ContractVerificationJobLedger } from './jobLedger'

export const contractVerificationJobLedger = new ContractVerificationJobLedger({
  load: () => store('main.contractVerificationJobs'),
  save: (jobs: ContractVerificationJobs) => {
    requireStoreAction('setContractVerificationJobs')(jobs)
  }
})

export default contractVerificationJobLedger
