import operationLifecycleLedger from './index'
import operationLifecycleRuntime from './runtime'
import { OperationLifecycleProjection } from './projection'

const PROJECTION_INTERVAL_MS = 15_000

class OperationLifecycleProjectionRuntime {
  private timer: ReturnType<typeof setInterval> | undefined
  private removeObserver: (() => void) | undefined
  private readonly projection = new OperationLifecycleProjection(operationLifecycleLedger)

  start() {
    if (this.timer) return
    this.removeObserver = operationLifecycleRuntime.observe(({ current, pendingEvidence }) => {
      this.projection.project(current.id, Date.now(), true, pendingEvidence)
    })
    this.projection.projectAll()
    this.timer = setInterval(() => this.projection.projectAll(), PROJECTION_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.removeObserver?.()
    this.removeObserver = undefined
  }
}

export const operationLifecycleProjectionRuntime = new OperationLifecycleProjectionRuntime()
export default operationLifecycleProjectionRuntime
