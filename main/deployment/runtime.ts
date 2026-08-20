import accounts from '../accounts'
import provider from '../provider'
import chains from '../chains'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { isWatchOnlyAccountType } from '../../resources/domain/signer'
import { WREN_DEPLOY_ORIGIN, originIdForName } from '../../resources/domain/origin'
import { simulateTransaction } from '../transaction/simulation'
import { createDeploymentService, DeploymentEvidenceError } from '.'

import type { TransactionData } from '../../resources/domain/transaction'

const deploymentOriginId = originIdForName(WREN_DEPLOY_ORIGIN)
let rpcId = 0

function currentAccountContext() {
  const account = accounts.current()
  if (!account) return undefined
  return {
    id: account.id,
    status: account.status,
    watchOnly: isWatchOnlyAccountType(account.lastSignerType),
    signerCapable: Boolean(account.getSigner())
  }
}

function networkContext(chainId: number) {
  const network = store('main.networks.ethereum', chainId)
  const connection = provider.connection.connections?.ethereum?.[chainId]
  const active = connection?.active || connection?.primary || connection?.secondary
  if (!network) return undefined
  return {
    type: 'ethereum' as const,
    chainId,
    configured: Boolean(connection?.chainConfig),
    enabled: network.on === true,
    connected: Boolean(active?.connected),
    nativeDecimals: store('main.networksMeta.ethereum', chainId, 'nativeCurrency', 'decimals')
  }
}

function pendingNonce(transaction: TransactionData) {
  return new Promise<unknown>((resolve, reject) => {
    provider.getNonce(transaction, (response) => {
      if (response?.error) return reject(new Error('Configured RPC pending nonce request failed'))
      if (!response || response.result === undefined) {
        return reject(new DeploymentEvidenceError('failed'))
      }
      resolve(response.result)
    })
  })
}

function ensureDeploymentOrigin(chainId: number) {
  const existing = store('main.origins', deploymentOriginId)
  if (!existing) {
    requireStoreAction('initOrigin')(deploymentOriginId, {
      chain: { type: 'ethereum', id: chainId },
      name: WREN_DEPLOY_ORIGIN,
      provenance: 'managed',
      sessionOnly: false
    })
    return deploymentOriginId
  }

  if (existing.name !== WREN_DEPLOY_ORIGIN || existing.provenance !== 'managed' || existing.sourceId) {
    throw new Error('Managed deployment origin is unavailable')
  }
  requireStoreAction('addOriginRequest')(deploymentOriginId)
  if (existing.chain?.type !== 'ethereum' || existing.chain?.id !== chainId) {
    requireStoreAction('switchOriginChain')(deploymentOriginId, chainId, 'ethereum')
  }
  return deploymentOriginId
}

export const deployment = createDeploymentService({
  getCurrentAccount: currentAccountContext,
  getNetwork: networkContext,
  estimateGas: (transaction) => provider.estimateGas(transaction),
  simulateTransaction: (transaction) =>
    simulateTransaction(transaction as TransactionData, { send: chains.send.bind(chains) }),
  getPendingNonce: (transaction) => pendingNonce(transaction as TransactionData),
  ensureDeploymentOrigin,
  admitTransaction: ({ originId, transaction, metadata }) =>
    new Promise((resolve, reject) => {
      let queued = false
      try {
        provider.sendTransaction(
          {
            id: ++rpcId,
            jsonrpc: '2.0',
            method: 'eth_sendTransaction',
            chainId: transaction.chainId,
            _origin: originId,
            params: [transaction]
          },
          (response) => {
            if (!queued && response?.error) reject(new Error('Deployment admission failed'))
          },
          { type: 'ethereum', id: Number(BigInt(transaction.chainId)) },
          (handlerId) => {
            queued = true
            resolve({ handlerId })
          },
          { deployment: metadata }
        )
      } catch {
        reject(new Error('Deployment admission failed'))
      }
    })
})

export default deployment
