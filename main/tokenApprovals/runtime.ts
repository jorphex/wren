import log from 'electron-log'

import store from '../store'
import { requireStoreAction } from '../store/action'
import { observeOperationLifecycles } from '../operationLifecycle/events'
import { TokenApprovalsService } from './service'

let rpcId = 0
export const tokenApprovals = new TokenApprovalsService({
  load: () => store('main.observedTokenApprovals'),
  save: (entries) => requireStoreAction('setObservedTokenApprovals')(entries),
  accounts: () => Object.keys(store('main.accounts') || {}),
  chainEnabled: (chainId) => store('main.networks.ethereum', chainId, 'on') === true,
  rpc: (chainId, method, params) =>
    new Promise((resolve, reject) => {
      const chains = require('../chains').default as typeof import('../chains').default
      const id = ++rpcId
      chains.send(
        { id, jsonrpc: '2.0', method, params },
        (response) => {
          if (
            response?.id !== id ||
            response.jsonrpc !== '2.0' ||
            response.error ||
            !Object.prototype.hasOwnProperty.call(response, 'result')
          ) {
            reject(new Error('Allowance lookup failed'))
          } else {
            resolve(response.result)
          }
        },
        { type: 'ethereum', id: chainId }
      )
    })
})

export const recordSubmittedTokenApproval = (
  transaction: Parameters<TokenApprovalsService['observeSubmitted']>[0],
  hash: string
) => {
  try {
    tokenApprovals.observeSubmitted(transaction, hash.toLowerCase())
  } catch {
    log.warn('Could not record local token approval')
  }
}

observeOperationLifecycles(({ previous, current, receipt }) => {
  if (current.state === 'reorged' && previous.state !== current.state) {
    tokenApprovals.invalidateAccountAllowances(current.chainId, current.account)
  }
  if (current.kind === 'transaction') {
    if (!current.transaction || JSON.stringify(previous.receipt) === JSON.stringify(current.receipt)) return
    void tokenApprovals
      .afterExecution(
        current.chainId,
        current.transaction.hash,
        JSON.stringify(current.receipt || current.state),
        receipt
      )
      .catch(() => {
        log.warn('Could not refresh local token approval')
      })
  } else if (
    current.kind === 'walletCalls' &&
    (previous.updatedAt !== current.updatedAt || previous.state !== current.state)
  ) {
    const batchId = current.walletCalls?.batchOperationId
    const batch = Object.values(store('main.walletCallBatches') || {}).find(
      (entry) => entry.operationId === batchId
    )
    for (const transaction of batch?.transactions || []) {
      if (transaction.receipt || current.state === 'reorged') {
        void tokenApprovals
          .afterExecution(
            current.chainId,
            transaction.hash,
            JSON.stringify([
              transaction.receipt?.blockHash,
              transaction.receipt?.status,
              current.state === 'reorged'
            ]),
            transaction.receipt
          )
          .catch(() => {
            log.warn('Could not refresh local token approval')
          })
      }
    }
  }
})
