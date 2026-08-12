import log from 'electron-log'
import path from 'path'
import { ChildProcess, fork } from 'child_process'
import { EventEmitter } from 'stream'

import { toTokenId } from '../../../resources/domain/balance'
import { nodeWorkerEnvironment } from '../../worker/environment'
import { BalancesWorkerCommand, parseBalancesWorkerEvent } from './protocol'

import type { Token } from '../../store/state'
import type { NativeCurrencyTarget } from './scan'

const BOOTSTRAP_TIMEOUT_SECONDS = 20

export default class BalancesWorkerController extends EventEmitter {
  private readonly worker: ChildProcess

  private bootstrapTimeout: NodeJS.Timeout | undefined
  private heartbeat: NodeJS.Timeout | undefined

  constructor() {
    super()

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

      log.debug(`balances controller received message: ${JSON.stringify(message)}`)

      switch (message.type) {
        case 'ready':
          this.clearBootstrapTimeout()
          log.info(`balances worker ready, pid: ${this.worker.pid}`)
          this.heartbeat = setInterval(() => this.sendHeartbeat(), 1000 * 20)
          this.emit('ready')
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
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }

    this.clearBootstrapTimeout()

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

  private clearBootstrapTimeout() {
    if (this.bootstrapTimeout) {
      clearTimeout(this.bootstrapTimeout)
      this.bootstrapTimeout = undefined
    }
  }
}
