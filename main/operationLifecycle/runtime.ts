import log from 'electron-log'

import ledger from './index'
import { operationLifecycleRpc } from './rpc'
import { OperationLifecycleReconciler, type OperationReconciliationObserver } from './reconciler'
import { observeOperationLifecycles, publishOperationLifecycleObservation } from './events'

const RECONCILIATION_INTERVAL_MS = 15_000

class OperationLifecycleRuntime {
  private timer: ReturnType<typeof setInterval> | undefined
  private running: Promise<void> | undefined
  private claimed = new Set<string>()
  private reconciler = new OperationLifecycleReconciler(
    ledger,
    operationLifecycleRpc,
    publishOperationLifecycleObservation
  )

  observe(observer: OperationReconciliationObserver) {
    return observeOperationLifecycles(observer)
  }

  claim(operationId: string) {
    this.claimed.add(operationId)
  }

  release(operationId: string) {
    this.claimed.delete(operationId)
  }

  private run() {
    if (this.running) return this.running
    this.running = Promise.all(
      ledger
        .listStored()
        .filter(({ id, kind }) => kind !== 'walletCalls' && !this.claimed.has(id))
        .map(({ id }) => this.reconciler.reconcile(id))
    )
      .then(() => undefined)
      .catch((error) => log.warn('Operation lifecycle reconciliation failed', error))
      .finally(() => {
        this.running = undefined
      })
    return this.running
  }

  start() {
    if (this.timer) return
    void this.run()
    this.timer = setInterval(() => void this.run(), RECONCILIATION_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  reconcile(operationId: string) {
    if (this.claimed.has(operationId)) return Promise.resolve(undefined)
    return this.reconciler.reconcile(operationId)
  }
}

export const operationLifecycleRuntime = new OperationLifecycleRuntime()
export default operationLifecycleRuntime
