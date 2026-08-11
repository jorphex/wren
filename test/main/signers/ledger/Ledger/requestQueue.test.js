import { RequestQueue } from '../../../../../main/signers/ledger/Ledger/requestQueue'

describe('Ledger RequestQueue', () => {
  beforeAll(() => {
    jest.useFakeTimers()
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  it('cancels active and queued requests exactly once when closed', async () => {
    let finishActive
    const activeCancel = jest.fn()
    const queuedCancel = jest.fn()
    const queue = new RequestQueue()

    queue.start()
    queue.add({
      type: 'active',
      cancel: activeCancel,
      execute: () =>
        new Promise((resolve) => {
          finishActive = resolve
        })
    })
    queue.add({
      type: 'queued',
      cancel: queuedCancel,
      execute: jest.fn().mockResolvedValue(undefined)
    })

    await Promise.resolve()
    await Promise.resolve()
    jest.advanceTimersByTime(200)
    await Promise.resolve()

    const cancellation = new Error('cancelled')
    queue.close(cancellation)
    queue.close(cancellation)

    expect(activeCancel).toHaveBeenCalledTimes(1)
    expect(activeCancel).toHaveBeenCalledWith(cancellation)
    expect(queuedCancel).toHaveBeenCalledTimes(1)

    finishActive()
    await Promise.resolve()
    await Promise.resolve()
    jest.advanceTimersByTime(1000)

    expect(activeCancel).toHaveBeenCalledTimes(1)
    expect(queuedCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels matching work without dropping unrelated requests', async () => {
    const deriveCancel = jest.fn()
    const signExecute = jest.fn().mockResolvedValue(undefined)
    const queue = new RequestQueue()

    queue.start()
    queue.add({
      type: 'deriveAddresses',
      cancel: deriveCancel,
      execute: jest.fn().mockResolvedValue(undefined)
    })
    queue.add({ type: 'signMessage', execute: signExecute })

    queue.cancelWhere((request) => request.type === 'deriveAddresses', new Error('derivation changed'))
    await Promise.resolve()
    await Promise.resolve()
    jest.advanceTimersByTime(200)
    await Promise.resolve()

    expect(deriveCancel).toHaveBeenCalledTimes(1)
    expect(signExecute).toHaveBeenCalledTimes(1)

    queue.close()
  })

  it('does not let an old execution create a second poller after restart', async () => {
    let finishOldRequest
    const firstFresh = jest.fn().mockResolvedValue(undefined)
    const secondFresh = jest.fn().mockResolvedValue(undefined)
    const queue = new RequestQueue()

    queue.start()
    queue.add({
      type: 'old',
      execute: () =>
        new Promise((resolve) => {
          finishOldRequest = resolve
        })
    })
    await Promise.resolve()
    await Promise.resolve()
    jest.advanceTimersByTime(200)
    await Promise.resolve()

    queue.close()
    queue.start()
    queue.add({ type: 'fresh-1', execute: firstFresh })
    queue.add({ type: 'fresh-2', execute: secondFresh })

    finishOldRequest()
    await Promise.resolve()
    await Promise.resolve()
    jest.advanceTimersByTime(200)
    await Promise.resolve()

    expect(firstFresh).toHaveBeenCalledTimes(1)
    expect(secondFresh).not.toHaveBeenCalled()

    await Promise.resolve()
    jest.advanceTimersByTime(200)
    await Promise.resolve()

    expect(secondFresh).toHaveBeenCalledTimes(1)
    queue.close()
  })
})
