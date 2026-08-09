import log from 'electron-log'
import { toBeHex } from 'ethers'
import { v5 as uuid } from 'uuid'

import accounts from '../accounts'
import chains from '../chains'
import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { createYearnPositionsService } from './positions'
import { preserveEarnReviewWindow } from './review'
import { createYearnCatalogService } from './service'
import { createYearnWorkflowService, type YearnQueuedResult } from './workflows/service'

const catalogService = createYearnCatalogService({
  readCache: () => store('main.yearn.catalogCache'),
  writeCache: (cache) => requireStoreAction('setYearnCatalogCache')(cache),
  onError: (reason) => log.warn('Could not refresh Yearn catalog', { reason })
})

let rpcId = 0
const sendRpc = (chainId: number, method: string, params: unknown[]) =>
  new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Yearn RPC request timed out')), 12_000)
    try {
      chains.send(
        {
          id: ++rpcId,
          jsonrpc: '2.0',
          method,
          params
        },
        (response: { error?: { message?: string }; result?: unknown }) => {
          clearTimeout(timer)
          if (response.error) return reject(new Error(response.error.message || 'RPC lookup failed'))
          resolve(response.result)
        },
        { type: 'ethereum', id: chainId }
      )
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })

const readContract = async (chainId: number, address: string, data: string) => {
  const result = await sendRpc(chainId, 'eth_call', [{ to: address, data }, 'latest'])
  if (typeof result !== 'string') throw new Error('RPC lookup returned no value')
  return result
}

const simulateContract = async (chainId: number, address: string, data: string, from: string) => {
  const result = await sendRpc(chainId, 'eth_call', [{ from, to: address, data }, 'latest'])
  if (typeof result !== 'string') throw new Error('RPC simulation returned no value')
  return result
}

const getPositions = createYearnPositionsService({
  getCatalog: () => catalogService.getCatalog(),
  getCurrentAccount: () => accounts.current() || null,
  getNetworkStatus: (chainId) => {
    const network = store('main.networks.ethereum', chainId)
    if (!network) return null
    return {
      on: network.on === true,
      connected: network.connection.endpoints.some((endpoint) => endpoint.connected)
    }
  },
  readContract
})

const internalOriginId = uuid('frame-internal', uuid.DNS)
const queueTransaction = (
  transaction: { chainId: number; account: string; target: string; data: string },
  onResult: (result: YearnQueuedResult) => void
) =>
  new Promise<void>((resolve, reject) => {
    let queued = false
    let pendingResult: YearnQueuedResult | undefined
    const deliver = (result: YearnQueuedResult) => {
      if (queued) onResult(result)
      else pendingResult = result
    }
    provider.sendTransaction(
      {
        id: ++rpcId,
        jsonrpc: '2.0',
        method: 'eth_sendTransaction',
        chainId: toBeHex(transaction.chainId),
        _origin: internalOriginId,
        params: [
          {
            from: transaction.account,
            to: transaction.target,
            data: transaction.data,
            value: '0x0',
            chainId: toBeHex(transaction.chainId)
          }
        ]
      },
      (response) => {
        if (response?.error) {
          const message = response.error.message || 'Transaction request failed'
          if (!queued) {
            reject(new Error(message))
          } else {
            deliver({ error: message })
          }
        } else {
          deliver(
            typeof response?.result === 'string'
              ? { hash: response.result }
              : { error: 'Transaction returned no hash' }
          )
        }
      },
      { type: 'ethereum', id: transaction.chainId },
      () => {
        queued = true
        preserveEarnReviewWindow(requireStoreAction('setDash'))
        resolve()
        if (pendingResult) onResult(pendingResult)
      }
    )
  })

const workflowService = createYearnWorkflowService({
  getCatalog: () => catalogService.getCatalog(),
  getCurrentAccount: () => accounts.current() || null,
  getNetworkStatus: (chainId) => {
    const network = store('main.networks.ethereum', chainId)
    return network
      ? {
          on: network.on === true,
          connected: network.connection.endpoints.some((endpoint) => endpoint.connected)
        }
      : null
  },
  readContract,
  simulateContract,
  getReceipt: (chainId, hash) => sendRpc(chainId, 'eth_getTransactionReceipt', [hash]),
  queueTransaction,
  hasQueuedTransaction: (transaction) => {
    const current = accounts.current()
    if (!current || current.id.toLowerCase() !== transaction.account.toLowerCase()) return false
    return Object.values(current.requests || {}).some((request) => {
      if (!request || typeof request !== 'object' || (request as { type?: unknown }).type !== 'transaction') {
        return false
      }
      const data = (request as { data?: Record<string, unknown> }).data
      return (
        typeof data?.['chainId'] === 'string' &&
        parseInt(data['chainId'], 16) === transaction.chainId &&
        typeof data['to'] === 'string' &&
        data['to'].toLowerCase() === transaction.target.toLowerCase() &&
        data['data'] === transaction.data
      )
    })
  },
  readWorkflows: () => store('main.yearn.workflows'),
  writeWorkflows: (workflows) => requireStoreAction('setYearnWorkflows')(workflows)
})

export default { ...catalogService, getPositions, ...workflowService }
export * from './positions'
export * from './service'
export * from './workflows/service'
