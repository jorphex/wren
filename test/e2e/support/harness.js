import fs from 'fs'
import http from 'http'
import path from 'path'

import { WalletCallBatchLedger } from '../../../main/provider/walletCallBatches'
import { WalletCallLifecycleController } from '../../../main/provider/walletCallLifecycle'
import { executeWalletCallBatch, hashSignedTransaction } from '../../../main/provider/walletCallExecution'
import {
  enforceRequestOriginAuthorization,
  isRequestOriginAuthorized
} from '../../../main/rpc/requestAuthorization'
import { originIdForName } from '../../../resources/domain/origin'

export const ACCOUNT = '0x1111111111111111111111111111111111111111'
export const TARGET = '0x2222222222222222222222222222222222222222'

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function profileStorage(filename = 'wallet-call-batches.json') {
  const target = path.join(process.env.WREN_E2E_PROFILE, filename)
  if (!fs.existsSync(target)) fs.writeFileSync(target, '{}', { mode: 0o600, flag: 'wx' })

  return {
    path: target,
    load() {
      return JSON.parse(fs.readFileSync(target, 'utf8'))
    },
    save(value) {
      const temporary = `${target}.${process.env.WREN_E2E_NAMESPACE}.tmp`
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
      fs.renameSync(temporary, target)
    }
  }
}

export function startJsonRpcFixture(handler) {
  let requests = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', async () => {
      let payload
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        requests.push({ origin: request.headers.origin, payload: jsonClone(payload) })
        const result = await handler(payload, request.headers.origin)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: payload.id, jsonrpc: '2.0', ...result }))
      } catch (error) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: payload?.id ?? null,
            jsonrpc: '2.0',
            error: { code: error.code ?? -32603, message: error.message }
          })
        )
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        requests,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done))
      })
    })
  })
}

export function createDappClient(url, origin) {
  let nextId = 1
  return {
    async request(method, params = []) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ id: nextId++, jsonrpc: '2.0', method, params })
      })
      const payload = await response.json()
      if (payload.error) throw Object.assign(new Error(payload.error.message), payload.error)
      return payload.result
    }
  }
}

export function createReviewHarness({
  storage = profileStorage(),
  origin = 'https://garden.example',
  failSignAt = -1,
  rpcUrl
} = {}) {
  const ledger = new WalletCallBatchLedger(storage)
  const requests = new Map()
  const permissions = {}
  const originId = originIdForName(origin)
  let handlerSequence = 0

  const accounts = {
    addRequestForAccount(accountId, request, responder) {
      if (accountId !== request.account) return false
      requests.set(request.handlerId, { ...request, res: responder })
      return true
    },
    claimWalletCallsRequestWithResponse(accountId, handlerId) {
      const request = requests.get(handlerId)
      if (!request || request.account !== accountId) throw new Error('Review request is unavailable')
      requests.delete(handlerId)
      return {
        snapshot: Object.freeze({
          id: request.batchId,
          origin: request.origin,
          account: request.account,
          chainId: request.chainId,
          calls: request.calls,
          preparation: { calls: [], maxFee: '0x0' }
        }),
        responder: request.res
      }
    },
    settleWalletCallsRequest: jest.fn(() => true)
  }

  const controller = new WalletCallLifecycleController({
    ledger,
    accounts,
    execute: async (snapshot) =>
      executeWalletCallBatch(snapshot, {
        ledger,
        signCall: async (_call, index) => {
          if (index === failSignAt) throw new Error(`Signer declined call ${index + 1}`)
          return { rawTransaction: `0x${(index + 1).toString(16).padStart(2, '0')}` }
        },
        broadcast: async (rawTransaction) => {
          const result = await createDappClient(rpcUrl, origin).request('eth_sendRawTransaction', [
            rawTransaction
          ])
          if (result !== hashSignedTransaction(rawTransaction)) throw new Error('Mock RPC hash mismatch')
          return result
        }
      })
  })

  const rejectUnauthorized = (request) => {
    const authorizationError = enforceRequestOriginAuthorization(
      request,
      permissions,
      (_account, _handlerId, error) => {
        throw Object.assign(new Error(error.message), error)
      }
    )
    if (authorizationError) throw authorizationError
  }

  return {
    account: ACCOUNT,
    accounts,
    controller,
    ledger,
    origin,
    originId,
    requests,
    grant() {
      permissions[originId] = { origin, provider: true }
    },
    revoke() {
      permissions[originId] = { origin, provider: false }
    },
    isAuthorized() {
      return isRequestOriginAuthorized({ type: 'transaction', origin: originId }, permissions)
    },
    async handle(payload, requestOrigin) {
      if (requestOrigin !== origin) throw Object.assign(new Error('Origin mismatch'), { code: 4100 })
      if (payload.method === 'eth_accounts') return { result: this.isAuthorized() ? [ACCOUNT] : [] }
      if (payload.method !== 'wallet_sendCalls') {
        throw Object.assign(new Error('Method not found'), { code: -32601 })
      }

      const handlerId = `review-${++handlerSequence}`
      rejectUnauthorized({ type: 'walletCalls', account: ACCOUNT, handlerId, origin: originId })
      return new Promise((resolve) => {
        controller.admit({ handlerId, origin, account: ACCOUNT, payload }, (response) =>
          resolve(response.error ? { error: response.error } : { result: response.result })
        )
      })
    },
    pending() {
      return [...requests.values()][0]
    },
    reject(error = { code: 4001, message: 'User rejected request' }) {
      const request = this.pending()
      if (!request) throw new Error('No review request is pending')
      requests.delete(request.handlerId)
      request.res({ id: request.payload.id, jsonrpc: '2.0', error })
    },
    approve() {
      const request = this.pending()
      if (!request) throw new Error('No review request is pending')
      return controller.approve(ACCOUNT, request.handlerId)
    }
  }
}

export function sendCalls({ id = 'garden-batch', calls } = {}) {
  return [
    {
      version: '2.0.0',
      id,
      from: ACCOUNT,
      chainId: '0x1',
      atomicRequired: false,
      calls: calls || [
        { to: TARGET, data: '0x', value: '0x0' },
        { to: TARGET, data: '0xabcd', value: '0x1' }
      ]
    }
  ]
}

export function waitForReview(harness) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      reject(new Error('Review request was not admitted'))
    }, 1000)
    const poll = () => {
      if (settled) return
      if (harness.pending()) {
        settled = true
        clearTimeout(timeout)
        resolve(harness.pending())
      } else {
        setImmediate(poll)
      }
    }
    poll()
  })
}

export function receipt(transactionHash, status = '0x1') {
  return {
    logs: [],
    status,
    blockHash: `0x${'b'.repeat(64)}`,
    blockNumber: '0x1',
    gasUsed: '0x5208',
    transactionHash
  }
}
