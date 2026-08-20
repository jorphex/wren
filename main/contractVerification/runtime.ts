import { app, safeStorage } from 'electron'
import path from 'path'

import provider from '../provider'
import store from '../store'
import operationLifecycleLedger from '../operationLifecycle'
import { operationLifecycleRpc } from '../operationLifecycle/rpc'
import { createContractVerificationArtifactIntake } from './artifactIntake'
import { createEtherscanApiKeyStore, type SafeStorageLike } from './credentialStorage'
import { createEtherscanV2Client } from './etherscan'
import contractVerificationJobLedger from '.'
import { createContractVerificationService } from './service'
import { createSourcifyClient } from './sourcify'
import { ContractVerificationPollingRuntime } from './pollingRuntime'

const unavailableSafeStorage: SafeStorageLike = {
  decryptString: () => {
    throw new Error('OS keychain is unavailable')
  },
  encryptString: () => {
    throw new Error('OS keychain is unavailable')
  },
  getSelectedStorageBackend: () => 'unknown',
  isEncryptionAvailable: () => false
}

const userData = app?.getPath
  ? app.getPath('userData')
  : path.resolve(path.dirname(require.main?.filename || process.cwd()), '../.userData')

const networkContext = (chainId: number) => {
  const network = store('main.networks.ethereum', chainId)
  const connection = provider.connection.connections?.ethereum?.[chainId]
  const active = connection?.active || connection?.primary || connection?.secondary
  if (!network) return undefined
  return {
    type: 'ethereum' as const,
    chainId,
    configured: Boolean(connection?.chainConfig),
    enabled: network.on === true,
    connected: Boolean(active?.connected)
  }
}

export const contractVerificationArtifactIntake = createContractVerificationArtifactIntake()
export const contractVerificationCredentialStore = createEtherscanApiKeyStore(userData, {
  safeStorage: (safeStorage as SafeStorageLike | undefined) || unavailableSafeStorage
})

export const contractVerification = createContractVerificationService({
  artifactIntake: contractVerificationArtifactIntake,
  credentialStore: contractVerificationCredentialStore,
  etherscan: createEtherscanV2Client(),
  getNetwork: networkContext,
  jobs: contractVerificationJobLedger,
  operations: operationLifecycleLedger,
  rpc: operationLifecycleRpc,
  sourcify: createSourcifyClient({})
})
export const contractVerificationPollingRuntime = new ContractVerificationPollingRuntime(contractVerification)

export default contractVerification
