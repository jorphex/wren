import EventEmitter from 'events'

import HotSigner from '../../../../../main/signers/hot/HotSigner'

jest.mock('electron')
jest.mock('../../../../../main/store/persist')

class FakeWorker extends EventEmitter {
  connected = true
  disconnect = jest.fn(() => {
    this.connected = false
    this.emit('disconnect')
  })
  send = jest.fn()
}

const createSigner = (timeout = 100) => {
  const worker = new FakeWorker()
  const signer = new HotSigner(undefined, 'unused-worker-path', {
    rpcTimeoutMs: timeout,
    worker
  })

  return { signer, worker }
}

describe('HotSigner worker lifecycle', () => {
  afterEach(() => {
    jest.clearAllTimers()
  })

  it('queues calls until authentication and settles a response once', () => {
    const { signer, worker } = createSigner()
    const callback = jest.fn()

    signer._callWorker({ method: 'lock' }, callback)
    expect(worker.send).not.toHaveBeenCalled()

    worker.emit('message', { type: 'token', token: 'worker-token' })
    expect(worker.send).toHaveBeenCalledTimes(1)

    const request = worker.send.mock.calls[0][0]
    worker.emit('message', { type: 'rpc', id: request.id, result: 'done' })
    worker.emit('message', { type: 'rpc', id: request.id, result: 'duplicate' })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, 'done')
    signer.close()
  })

  it('dispatches EIP-7702 revocation without adding signature fields', () => {
    const { signer, worker } = createSigner()
    const callback = jest.fn()
    const request = { kind: 'eip7702-revoke-v1' }
    worker.emit('message', { type: 'token', token: 'worker-token' })

    signer.signEip7702Revoke(2, request, callback)

    expect(worker.send).toHaveBeenCalledTimes(1)
    expect(worker.send.mock.calls[0][0]).toMatchObject({
      method: 'signEip7702Revoke',
      params: { index: 2, request }
    })
    expect(worker.send.mock.calls[0][0].params).not.toHaveProperty('signature')
    signer.close()
  })

  it('times out a pre-token call and does not revive it later', () => {
    const { signer, worker } = createSigner(25)
    const callback = jest.fn()

    signer._callWorker({ method: 'lock' }, callback)
    jest.advanceTimersByTime(25)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toBe('Hot signer worker request timed out')

    worker.emit('message', { type: 'token', token: 'late-token' })
    expect(worker.send).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledTimes(1)
    signer.close()
  })

  it.each([
    ['error', new Error('worker failed'), 'worker failed'],
    ['exit', 1, 'Hot signer worker exited (code 1)'],
    ['disconnect', undefined, 'Hot signer worker disconnected']
  ])('settles pending and future calls after worker %s', (event, detail, expectedMessage) => {
    const { signer, worker } = createSigner()
    const pending = jest.fn()
    const future = jest.fn()

    signer._callWorker({ method: 'lock' }, pending)
    worker.emit(event, detail)
    worker.emit('disconnect')
    signer._callWorker({ method: 'lock' }, future)

    expect(pending).toHaveBeenCalledTimes(1)
    expect(pending.mock.calls[0][0].message).toBe(expectedMessage)
    expect(signer.status).toBe('error')
    expect(future).toHaveBeenCalledTimes(1)
    expect(future.mock.calls[0][0].message).toBe('Hot signer worker is not running')
  })

  it('settles a dispatch exception instead of throwing', () => {
    const { signer, worker } = createSigner()
    const callback = jest.fn()
    worker.send.mockImplementation(() => {
      throw new Error('synthetic send failure')
    })
    worker.emit('message', { type: 'token', token: 'worker-token' })

    expect(() => signer._callWorker({ method: 'lock' }, callback)).not.toThrow()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toBe('synthetic send failure')
    signer.close()
  })

  it('settles an in-flight authenticated call when the worker disconnects', () => {
    const { signer, worker } = createSigner()
    const callback = jest.fn()

    worker.emit('message', { type: 'token', token: 'worker-token' })
    signer._callWorker({ method: 'lock' }, callback)
    expect(worker.send).toHaveBeenCalledTimes(1)

    worker.emit('disconnect')

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].message).toBe('Hot signer worker disconnected')
  })

  it('settles pending and future calls when closed before authentication', () => {
    const { signer, worker } = createSigner()
    const pending = jest.fn()
    const future = jest.fn()

    signer._callWorker({ method: 'lock' }, pending)
    signer.close()
    signer.close()
    signer._callWorker({ method: 'lock' }, future)

    expect(pending).toHaveBeenCalledTimes(1)
    expect(pending.mock.calls[0][0].message).toBe('Hot signer closed')
    expect(future).toHaveBeenCalledTimes(1)
    expect(future.mock.calls[0][0].message).toBe('Hot signer worker is not running')
    expect(worker.disconnect).toHaveBeenCalledTimes(1)
    expect(() => worker.emit('error', new Error('late disconnect error'))).not.toThrow()
  })

  it('keeps the live signer open when protected-file erasure fails', () => {
    const { signer } = createSigner()
    signer.delete = jest.fn(() => {
      throw new Error('synthetic erase failure')
    })
    signer.close = jest.fn()

    expect(() => signer.remove()).toThrow('synthetic erase failure')
    expect(signer.close).not.toHaveBeenCalled()
  })

  it('erases before closing without issuing a second persistence mutation', () => {
    const { signer } = createSigner()
    const order = []
    signer.delete = jest.fn(() => order.push('delete'))
    signer.close = jest.fn(function () {
      order.push(this._deferPersistence ? 'deferred-close' : 'close')
    })

    signer.remove()

    expect(order).toEqual(['delete', 'deferred-close'])
    expect(signer._deferPersistence).toBe(false)
  })

  it('contains one failing callback while settling every pending call on close', () => {
    const { signer } = createSigner()
    const first = jest.fn(() => {
      throw new Error('synthetic callback failure')
    })
    const second = jest.fn()

    signer._callWorker({ method: 'first' }, first)
    signer._callWorker({ method: 'second' }, second)

    expect(() => signer.close()).not.toThrow()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0].message).toBe('Hot signer closed')
  })
})
