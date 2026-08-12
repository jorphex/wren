import log from 'electron-log'
import path from 'path'
import { ChildProcess, fork } from 'child_process'
import { EventEmitter } from 'stream'

import { toTokenId } from '../../../resources/domain/balance'
import { nodeWorkerEnvironment } from '../../worker/environment'
import {
  BALANCE_RPC_MAX_IN_FLIGHT,
  BALANCE_RPC_TIMEOUT_MS,
  BalanceRpcRequest,
  BalanceRpcResponse,
  BalancesWorkerCommand,
  parseBalanceRpcResponse,
  parseBalancesWorkerEvent
} from './protocol'

import type { Token } from '../../store/state'
import type { NativeCurrencyTarget } from './scan'

const BOOTSTRAP_TIMEOUT_SECONDS = 20
const PARENT_RPC_TIMEOUT_MS = BALANCE_RPC_TIMEOUT_MS - 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export default class BalancesWorkerController extends EventEmitter {
  private readonly worker: ChildProcess
  private readonly chains: typeof import('../../chains').default

  private bootstrapTimeout: NodeJS.Timeout | undefined
  private heartbeat: NodeJS.Timeout | undefined
  private readonly rpcRequests = new Map<number, NodeJS.Timeout>()

  constructor() {
    super()

    // Load the network manager only when the worker starts. Importing the
    // controller is otherwise part of account/bootstrap module loading and must
    // not initialize Electron network state.
    this.chains = require('../../chains') as typeof import('../../chains').default

    const workerArgs = process.env.NODE_ENV === 'development' ? ['--inspect=127.0.0.1:9230'] : []
    this.worker = fork(path.resolve(__dirname, 'worker.js'), [], {
      env: nodeWorkerEnvironment(),
      execArgv: workerArgs
    })

    log.info('created balances worker, pid:', this.worker.pid)

    // restart the worker if no ready event is received within a reasonable time frame
    this.bootstrapTimeout = setTimeout(() => {
      log.warn(
        `Balances worker with pid ${this.worker.pid} did not report as ready after ${BOOTSTRAP_TIMEOUT_SECONDS} seconds, killing worker`
      )
      this.stopWorker()
    }, BOOTSTRAP_TIMEOUT_SECONDS * 1000)

    this.worker.on('message', (value: unknown) => {
      const message = parseBalancesWorkerEvent(value)
      if (!message) {
        log.warn('balances controller received malformed worker message')
        return
      }

      if (message.type === 'rpcRequest') {
        log.debug(
          `balances controller received RPC request ${message.id}: ${message.method} on chain ${message.chainId}`
        )
      } else {
        log.debug(`balances controller received message: ${JSON.stringify(message)}`)
      }

      switch (message.type) {
        case 'ready':
          this.clearBootstrapTimeout()
          log.info(`balances worker ready, pid: ${this.worker.pid}`)
          this.heartbeat = setInterval(() => this.sendHeartbeat(), 1000 * 20)
          this.emit('ready')
          break
        case 'rpcRequest':
          this.handleRpcRequest(message)
          break
        case 'chainBalances':
          this.emit('chainBalances', message.address, message.balances)
          break
        case 'tokenBalances':
          this.emit('tokenBalances', message.address, message.balances)
          break
        case 'tokenBlacklist':
          this.emit('tokenBlacklist', message.address, new Set(message.tokens.map(toTokenId)))
          break
      }
    })

    this.worker.on('close', (code, signal) => {
      // emitted after exit or error and when all stdio streams are closed
      log.warn(`balances worker exited with code ${code}, signal: ${signal}, pid: ${this.worker.pid}`)
      this.clearHeartbeat()
      this.clearBootstrapTimeout()
      this.clearRpcRequests()
      this.worker.removeAllListeners()

      this.emit('close')
      this.removeAllListeners()
    })

    this.worker.on('disconnect', () => {
      log.warn(`balances worker disconnected`)
      this.stopWorker()
    })

    this.worker.on('error', (err) => {
      log.warn(`balances worker sent error, pid: ${this.worker.pid}`, err)
      this.stopWorker()
    })
  }

  close() {
    log.info(`closing worker controller`)

    this.stopWorker()
  }

  isRunning() {
    return !!this.heartbeat
  }

  updateChainBalances(address: Address, chains: NativeCurrencyTarget[]) {
    this.sendCommandToWorker({ command: 'updateChainBalance', args: [address, chains] })
  }

  updateKnownTokenBalances(address: Address, tokens: Token[]) {
    this.sendCommandToWorker({ command: 'fetchTokenBalances', args: [address, tokens] })
  }

  scanForTokenBalances(address: Address, tokens: Token[], chains: number[]) {
    this.sendCommandToWorker({ command: 'tokenBalanceScan', args: [address, tokens, chains] })
  }

  // private
  private stopWorker() {
    this.clearHeartbeat()

    this.clearBootstrapTimeout()
    this.clearRpcRequests()

    this.worker.kill('SIGTERM')
  }

  private isWorkerReachable() {
    return this.worker.connected && this.worker.channel && this.worker.listenerCount('error') > 0
  }

  // sending messages
  private sendCommandToWorker(message: BalancesWorkerCommand) {
    log.debug(`sending command ${message.command} to worker`)

    try {
      if (!this.isWorkerReachable()) {
        log.error(`attempted to send command "${message.command}" to worker but worker cannot be reached!`)
        return
      }

      this.worker.send(message)
    } catch (e) {
      log.error(`unknown error sending command "${message.command}" to worker`, e)
    }
  }

  private sendHeartbeat() {
    this.sendCommandToWorker({ command: 'heartbeat', args: [] })
  }

  private handleRpcRequest(request: BalanceRpcRequest) {
    if (this.rpcRequests.has(request.id)) {
      log.warn(`balances controller ignored duplicate RPC request ID ${request.id}`)
      return
    }

    if (this.rpcRequests.size >= BALANCE_RPC_MAX_IN_FLIGHT) {
      this.sendRpcResponse({ id: request.id, error: { code: -32005, message: 'Balance RPC limit reached' } })
      return
    }

    const connection = this.chains.connections.ethereum?.[String(request.chainId)]
    if (!connection) {
      this.sendRpcResponse({
        id: request.id,
        error: { code: 4901, message: 'Requested chain is not enabled' }
      })
      return
    }

    const timer = setTimeout(() => {
      if (!this.rpcRequests.delete(request.id)) return
      this.sendRpcResponse({
        id: request.id,
        error: { code: -32002, message: 'Balance RPC request timed out' }
      })
    }, PARENT_RPC_TIMEOUT_MS)

    this.rpcRequests.set(request.id, timer)

    try {
      this.chains.send(
        {
          id: request.id,
          jsonrpc: '2.0',
          method: request.method,
          params: request.params
        },
        (response) => this.handleRpcResult(request.id, response),
        { type: 'ethereum', id: request.chainId }
      )
    } catch (error) {
      log.warn('balance RPC dispatch failed', error)
      this.finishRpcRequest(request.id, {
        id: request.id,
        error: { code: -32603, message: 'Balance RPC request failed' }
      })
    }
  }

  private handleRpcResult(id: number, response: unknown) {
    if (!this.rpcRequests.has(id)) return

    if (!isRecord(response)) {
      this.finishRpcRequest(id, {
        id,
        error: { code: -32603, message: 'Balance RPC returned an invalid response' }
      })
      return
    }

    const responseError = response['error']
    if (responseError !== undefined) {
      if (!isRecord(responseError)) {
        this.finishRpcRequest(id, {
          id,
          error: { code: -32603, message: 'Balance RPC returned an invalid response' }
        })
        return
      }

      const errorCode = responseError['code']
      const code = typeof errorCode === 'number' && Number.isInteger(errorCode) ? errorCode : -32603
      this.finishRpcRequest(id, {
        id,
        error: {
          code,
          message: code === 4901 ? 'Requested chain is unavailable' : 'Balance RPC request failed'
        }
      })
      return
    }

    const parsed = parseBalanceRpcResponse({ id, result: response['result'] })
    if (!parsed || !('result' in parsed)) {
      this.finishRpcRequest(id, {
        id,
        error: { code: -32603, message: 'Balance RPC returned an invalid result' }
      })
      return
    }

    this.finishRpcRequest(id, parsed)
  }

  private finishRpcRequest(id: number, response: BalanceRpcResponse) {
    const timer = this.rpcRequests.get(id)
    if (!timer) return
    clearTimeout(timer)
    this.rpcRequests.delete(id)
    this.sendRpcResponse(response)
  }

  private sendRpcResponse(response: BalanceRpcResponse) {
    this.sendCommandToWorker({ command: 'rpcResponse', args: [response] })
  }

  private clearRpcRequests() {
    this.rpcRequests.forEach(clearTimeout)
    this.rpcRequests.clear()
  }

  private clearHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
  }

  private clearBootstrapTimeout() {
    if (this.bootstrapTimeout) {
      clearTimeout(this.bootstrapTimeout)
      this.bootstrapTimeout = undefined
    }
  }
}
