import { EventEmitter } from 'events'

import chains from '../../../../main/chains'
import BalancesWorkerController from '../../../../main/externalData/balances/controller'

const mockFork = jest.fn()

jest.mock('child_process', () => ({ fork: (...args) => mockFork(...args) }))
jest.mock('../../../../main/chains', () => ({
  connections: { ethereum: {} },
  send: jest.fn()
}))

const mockChains = chains

const address = '0x0000000000000000000000000000000000000001'

function rpcRequest(overrides = {}) {
  return {
    type: 'rpcRequest',
    id: 1,
    chainId: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
    ...overrides
  }
}

describe('balances worker RPC controller', () => {
  let controller
  let worker

  beforeEach(() => {
    worker = Object.assign(new EventEmitter(), {
      pid: 123,
      connected: true,
      channel: {},
      send: jest.fn(),
      kill: jest.fn()
    })
    mockFork.mockReturnValue(worker)
    mockChains.connections.ethereum = { 1: { chainId: '1' } }
    mockChains.send.mockReset()
    controller = new BalancesWorkerController()
  })

  afterEach(() => {
    controller.close()
  })

  it('dispatches an allowlisted request to its explicit enabled chain', () => {
    worker.emit('message', rpcRequest())

    expect(mockChains.send).toHaveBeenCalledWith(
      { id: 1, jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'] },
      expect.any(Function),
      { type: 'ethereum', id: 1 }
    )

    mockChains.send.mock.calls[0][1]({ id: 1, jsonrpc: '2.0', result: '0x1' })

    expect(worker.send).toHaveBeenCalledWith({
      command: 'rpcResponse',
      args: [{ id: 1, result: '0x1' }]
    })
  })

  it('rejects requests for chains that are not enabled', () => {
    worker.emit('message', rpcRequest({ chainId: 10 }))

    expect(mockChains.send).not.toHaveBeenCalled()
    expect(worker.send).toHaveBeenCalledWith({
      command: 'rpcResponse',
      args: [{ id: 1, error: { code: 4901, message: 'Requested chain is not enabled' } }]
    })
  })

  it('does not dispatch methods or parameters outside the balance-read allowlist', () => {
    worker.emit('message', rpcRequest({ method: 'eth_sendTransaction', params: [] }))
    worker.emit(
      'message',
      rpcRequest({
        id: 2,
        method: 'eth_call',
        params: [{ to: address, data: '0x', from: address }, 'latest']
      })
    )

    expect(mockChains.send).not.toHaveBeenCalled()
    expect(worker.send).not.toHaveBeenCalled()
  })

  it('rejects duplicate in-flight request IDs without completing the original', () => {
    worker.emit('message', rpcRequest())
    worker.emit('message', rpcRequest())

    expect(mockChains.send).toHaveBeenCalledTimes(1)
    expect(worker.send).not.toHaveBeenCalled()

    mockChains.send.mock.calls[0][1]({ id: 1, jsonrpc: '2.0', result: '0x2' })
    expect(worker.send).toHaveBeenLastCalledWith({
      command: 'rpcResponse',
      args: [{ id: 1, result: '0x2' }]
    })
  })

  it('returns privacy-safe errors for upstream RPC failures', () => {
    worker.emit('message', rpcRequest())
    mockChains.send.mock.calls[0][1]({
      id: 1,
      jsonrpc: '2.0',
      error: { code: -32000, message: 'secret endpoint detail' }
    })

    expect(worker.send).toHaveBeenCalledWith({
      command: 'rpcResponse',
      args: [{ id: 1, error: { code: -32000, message: 'Balance RPC request failed' } }]
    })
  })

  it('rejects malformed upstream responses at the parent boundary', () => {
    worker.emit('message', rpcRequest())
    mockChains.send.mock.calls[0][1](null)

    expect(worker.send).toHaveBeenCalledWith({
      command: 'rpcResponse',
      args: [{ id: 1, error: { code: -32603, message: 'Balance RPC returned an invalid response' } }]
    })
  })

  it('bounds the number of RPC requests dispatched concurrently', () => {
    for (let id = 1; id <= 33; id += 1) worker.emit('message', rpcRequest({ id }))

    expect(mockChains.send).toHaveBeenCalledTimes(32)
    expect(worker.send).toHaveBeenCalledWith({
      command: 'rpcResponse',
      args: [{ id: 33, error: { code: -32005, message: 'Balance RPC limit reached' } }]
    })
  })
})
