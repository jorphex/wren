import log from 'electron-log'

log.transports.console.format = '[scanWorker] {h}:{i}:{s}.{ms} {text}'
log.transports.console.level = process.env['LOG_WORKER'] ? 'debug' : 'info'
log.transports.file.level = ['development', 'test'].includes(process.env['NODE_ENV'] || 'development')
  ? false
  : 'verbose'

import { supportsChain as chainSupportsScan } from '../../multicall'
import balancesLoader, { BalanceLoader } from './scan'
import TokenLoader from '../inventory/tokens'
import { toTokenId } from '../../../resources/domain/balance'
import {
  BALANCE_RPC_MAX_IN_FLIGHT,
  BALANCE_RPC_MAX_QUEUED,
  BALANCE_RPC_QUEUE_TIMEOUT_MS,
  BALANCE_RPC_TIMEOUT_MS,
  BalanceRpcRequest,
  BalanceRpcResponse,
  BalancesWorkerEvent,
  parseBalancesWorkerCommand,
  parseBalancesWorkerEvent
} from './protocol'
import { isYearnSystemToken } from '../../yearn/catalog'

import type { Token } from '../../store/state'
import type EthereumProvider from 'ethereum-provider'

let heartbeat: NodeJS.Timeout
let balances: BalanceLoader

const tokenLoader = new TokenLoader()

type QueuedRpcRequest = Omit<BalanceRpcRequest, 'id' | 'type'> & {
  resolve: (result: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface PendingRpcRequest {
  resolve: (result: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

class BalanceRpcError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

class ParentRpcProvider {
  private nextRequestId = 0
  private readonly pending = new Map<number, PendingRpcRequest>()
  private readonly queued: QueuedRpcRequest[] = []

  request<T>(payload: { method: string; params?: readonly unknown[]; chainId?: string }): Promise<T> {
    return new Promise<string>((resolve, reject) => {
      if (this.queued.length >= BALANCE_RPC_MAX_QUEUED) {
        reject(new BalanceRpcError(-32005, 'Balance RPC queue is full'))
        return
      }

      const chainId = parseCanonicalChainId(payload.chainId)
      const candidate = parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id: 1,
        chainId,
        method: payload.method,
        params: payload.params
      })

      if (!candidate || candidate.type !== 'rpcRequest') {
        reject(new BalanceRpcError(-32602, 'Unsupported balance RPC request'))
        return
      }

      const queued = {
        chainId: candidate.chainId,
        method: candidate.method,
        params: candidate.params,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queued.indexOf(queued)
          if (index < 0) return
          this.queued.splice(index, 1)
          reject(new BalanceRpcError(-32002, 'Balance RPC queue timed out'))
        }, BALANCE_RPC_QUEUE_TIMEOUT_MS)
      } as QueuedRpcRequest
      this.queued.push(queued)
      this.drainQueue()
    }) as Promise<T>
  }

  handleResponse(response: BalanceRpcResponse) {
    const request = this.pending.get(response.id)
    if (!request) {
      log.warn(`received response for unknown balance RPC request ${response.id}`)
      return
    }

    clearTimeout(request.timer)
    this.pending.delete(response.id)

    if ('result' in response) request.resolve(response.result)
    else request.reject(new BalanceRpcError(response.error.code, response.error.message))

    this.drainQueue()
  }

  close(error = new BalanceRpcError(4900, 'Balance RPC channel closed')) {
    this.pending.forEach((request) => {
      clearTimeout(request.timer)
      request.reject(error)
    })
    this.pending.clear()
    this.queued.splice(0).forEach((request) => {
      clearTimeout(request.timer)
      request.reject(error)
    })
  }

  private drainQueue() {
    while (this.pending.size < BALANCE_RPC_MAX_IN_FLIGHT) {
      const queued = this.queued.shift()
      if (!queued) return
      clearTimeout(queued.timer)

      const id = this.allocateRequestId()
      const request = parseBalancesWorkerEvent({
        type: 'rpcRequest',
        id,
        chainId: queued.chainId,
        method: queued.method,
        params: queued.params
      })

      if (!request || request.type !== 'rpcRequest') {
        queued.reject(new BalanceRpcError(-32602, 'Unsupported balance RPC request'))
        continue
      }

      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.reject(new BalanceRpcError(-32002, 'Balance RPC request timed out'))
        this.drainQueue()
      }, BALANCE_RPC_TIMEOUT_MS)

      this.pending.set(id, { resolve: queued.resolve, reject: queued.reject, timer })

      if (sendToMainProcess(request) === undefined) {
        clearTimeout(timer)
        this.pending.delete(id)
        queued.reject(new BalanceRpcError(4900, 'Balance RPC channel is unavailable'))
      }
    }
  }

  private allocateRequestId() {
    do {
      this.nextRequestId = (this.nextRequestId % Number.MAX_SAFE_INTEGER) + 1
    } while (this.pending.has(this.nextRequestId))
    return this.nextRequestId
  }
}

const rpcProvider = new ParentRpcProvider()

function parseCanonicalChainId(value: string | undefined) {
  if (!value || value.length > 15 || !/^0x[1-9a-f][0-9a-f]*$/.test(value)) return Number.NaN
  const parsed = BigInt(value)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN
  return Number(parsed)
}

async function start() {
  await tokenLoader.start()
  balances = balancesLoader(rpcProvider as unknown as EthereumProvider)

  sendToMainProcess({ type: 'ready' })
}

function sendToMainProcess(data: BalancesWorkerEvent) {
  if (process.send && process.connected) {
    try {
      return process.send(data)
    } catch (error) {
      log.error('could not send to main process', error)
      return undefined
    }
  }

  log.error(`cannot send to main process! connected: ${process.connected}`)

  return undefined
}

async function updateBlacklist(address: Address, chains: number[]) {
  try {
    const blacklistTokens = tokenLoader.getBlacklist(chains)
    sendToMainProcess({ type: 'tokenBlacklist', address, tokens: blacklistTokens })
  } catch (e) {
    log.error('error updating token blacklist', e)
  }
}

async function tokenBalanceScan(address: Address, tokensToOmit: Token[] = [], chains: number[]) {
  try {
    // for chains that support multicall, we can attempt to load every token that we know about,
    // for all other chains we need to call each contract individually so don't scan every contract
    const omitSet = new Set(tokensToOmit.map(toTokenId))
    const eligibleChains = chains.filter(chainSupportsScan)
    const tokenList = tokenLoader.getTokens(eligibleChains)
    const tokens = tokenList.filter((token) => !omitSet.has(toTokenId(token)))

    const tokenBalances = (await balances.getTokenBalances(address, tokens)).filter(
      (balance) => parseInt(balance.balance) > 0
    )

    sendToMainProcess({ type: 'tokenBalances', address, balances: tokenBalances })
  } catch (e) {
    log.error('error scanning for token balances', e)
  }
}

async function fetchTokenBalances(address: Address, tokens: Token[]) {
  try {
    const blacklistSet = new Set(tokenLoader.getBlacklist().map(toTokenId))
    const filteredTokens = tokens.filter(
      (token) => isYearnSystemToken(token) || !blacklistSet.has(toTokenId(token))
    )
    const tokenBalances = await balances.getTokenBalances(address, filteredTokens)

    sendToMainProcess({ type: 'tokenBalances', address, balances: tokenBalances })
  } catch (e) {
    log.error('error fetching token balances', e)
  }
}

async function chainBalanceScan(address: string, chains: { chainId: number; decimals: number }[]) {
  try {
    const chainBalances = await balances.getCurrencyBalances(address, chains)

    sendToMainProcess({ type: 'chainBalances', balances: chainBalances, address })
  } catch (e) {
    log.error('error scanning chain balance', e)
  }
}

function disconnect() {
  rpcProvider.close()
  if (process.connected) process.disconnect()
  process.kill(process.pid, 'SIGHUP')
}

function resetHeartbeat() {
  clearTimeout(heartbeat)

  heartbeat = setTimeout(() => {
    log.warn('no heartbeat received in 60 seconds, worker exiting')
    disconnect()
  }, 60 * 1000)
}

process.on('message', (value: unknown) => {
  const message = parseBalancesWorkerCommand(value)
  if (!message) {
    log.warn('received malformed balance worker command')
    return
  }

  if (message.command === 'rpcResponse') {
    log.debug(`received balance RPC response ${message.args[0].id}`)
  } else {
    log.debug(`received message: ${message.command} [${message.args}]`)
  }

  switch (message.command) {
    case 'heartbeat':
      resetHeartbeat()
      break
    case 'rpcResponse':
      rpcProvider.handleResponse(message.args[0])
      break
    case 'updateChainBalance':
      void chainBalanceScan(...message.args)
      break
    case 'fetchTokenBalances':
      void fetchTokenBalances(...message.args)
      break
    case 'tokenBalanceScan': {
      const [address, tokensToOmit, chains] = message.args
      void updateBlacklist(address, chains)
      void tokenBalanceScan(address, tokensToOmit, chains)
      break
    }
  }
})

void start().catch((error) => {
  log.error('could not start balances worker', error)
  disconnect()
})
