import type { ContractVerificationJobRecord } from '../../resources/domain/contractVerification'

export const CONTRACT_VERIFICATION_POLL_INTERVAL_MS = 15_000

type JobListResult =
  Readonly<{ success: true; jobs: readonly ContractVerificationJobRecord[] }> | Readonly<{ success: false }>

export interface ContractVerificationPollingService {
  list(): JobListResult
  refresh(jobId: string): Promise<unknown>
}

export const contractVerificationNeedsPolling = (job: ContractVerificationJobRecord) =>
  job.destinations.some(({ status }) => status === 'checking') ||
  (job.status === 'publishing' &&
    job.destinations.some(
      ({ destination, status }) => destination === 'sourcify' && status === 'not-submitted'
    ))

export const wakeContractVerificationPollingForActiveResult = <
  Result extends Readonly<{ success: boolean; job?: ContractVerificationJobRecord }>
>(
  runtime: Readonly<{ wake(): void }>,
  result: Result
): Result => {
  if (result.success && result.job && contractVerificationNeedsPolling(result.job)) runtime.wake()
  return result
}

export class ContractVerificationPollingRuntime {
  private running = false
  private active = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly service: ContractVerificationPollingService,
    private readonly intervalMs = CONTRACT_VERIFICATION_POLL_INTERVAL_MS
  ) {}

  start() {
    this.running = true
    this.wake()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  wake() {
    if (!this.running || this.active) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    void this.sweep()
  }

  private schedule() {
    if (!this.running || this.timer) return
    const listed = this.service.list()
    if (!listed.success || !listed.jobs.some(contractVerificationNeedsPolling)) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.wake()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  private async sweep() {
    this.active = true
    try {
      const listed = this.service.list()
      if (!listed.success) return
      for (const job of listed.jobs.filter(contractVerificationNeedsPolling)) {
        if (!this.running) return
        try {
          await this.service.refresh(job.id)
        } catch {
          // The bounded service result remains authoritative; polling never retries publication.
        }
      }
    } finally {
      this.active = false
      this.schedule()
    }
  }
}
