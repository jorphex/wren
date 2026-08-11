import log from 'electron-log'

export interface Request {
  execute: () => Promise<unknown>
  type: string
  cancel?: (error: Error) => void
}

const noRequest = {
  type: 'emptyQueue',
  execute: () => Promise.resolve()
}

export class RequestQueue {
  private running = false
  private generation = 0
  private requestQueue: Array<Request> = []
  private activeRequest: Request | undefined
  private requestPoller = setTimeout(() => {})

  add(request: Request) {
    if (!this.running) {
      this.cancelRequest(request, new Error('Ledger request queue is not running'))
      return
    }

    this.requestQueue.push(request)
  }

  private pollRequest(generation: number) {
    if (!this.running || generation !== this.generation) return

    // each request must return a promise
    const request = this.requestQueue.shift() || noRequest
    this.activeRequest = request

    let execution: Promise<unknown>
    try {
      execution = request.execute()
    } catch (error) {
      execution = Promise.reject(error)
    }

    execution
      .catch((err) => log.warn('Ledger request queue caught unexpected error', err))
      .finally(() => {
        if (this.activeRequest === request) this.activeRequest = undefined

        if (this.running && generation === this.generation) {
          this.requestPoller = setTimeout(() => this.pollRequest(generation), 200)
        }
      })
  }

  start() {
    if (this.running) return

    this.running = true
    const generation = ++this.generation
    this.pollRequest(generation)
  }

  stop() {
    this.running = false
    this.generation++
    clearTimeout(this.requestPoller)
  }

  close(error = new Error('Ledger request queue closed')) {
    this.stop()
    this.cancelWhere(() => true, error, true)
  }

  cancelWhere(predicate: (request: Request) => boolean, error: Error, includeActive = false) {
    const retained: Request[] = []

    this.requestQueue.forEach((request) => {
      if (predicate(request)) this.cancelRequest(request, error)
      else retained.push(request)
    })

    this.requestQueue = retained

    if (includeActive && this.activeRequest && predicate(this.activeRequest)) {
      const activeRequest = this.activeRequest
      this.activeRequest = undefined
      this.cancelRequest(activeRequest, error)
    }
  }

  private cancelRequest(request: Request, error: Error) {
    try {
      request.cancel?.(error)
    } catch (cancelError) {
      log.warn('Ledger request cancellation callback failed', cancelError)
    }
  }

  peekBack() {
    return this.requestQueue[this.requestQueue.length - 1] || this.activeRequest
  }
}
