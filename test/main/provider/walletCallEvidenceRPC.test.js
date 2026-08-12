import { createWalletCallEvidenceRPC } from '../../../main/provider/walletCallEvidenceRPC'

const hash = `0x${'1'.repeat(64)}`

function manualTimers() {
  const pending = []
  const schedule = jest.fn((callback, delay) => {
    const timer = { callback, delay, unref: jest.fn() }
    pending.push(timer)
    return timer
  })
  const cancel = jest.fn((timer) => {
    const index = pending.indexOf(timer)
    if (index >= 0) pending.splice(index, 1)
  })

  return { pending, schedule, cancel }
}

it.each([
  ['getTransactionReceipt', 'eth_getTransactionReceipt'],
  ['getTransaction', 'eth_getTransactionByHash']
])('sends %s to only the exact candidate chain', async (operation, method) => {
  const timers = manualTimers()
  const connection = { send: jest.fn() }
  const rpc = createWalletCallEvidenceRPC(connection, {
    timeoutMs: 50,
    schedule: timers.schedule,
    cancel: timers.cancel
  })

  const result = rpc[operation]('0x89', hash)
  expect(connection.send).toHaveBeenCalledWith(
    { id: 1, jsonrpc: '2.0', method, params: [hash] },
    expect.any(Function),
    { type: 'ethereum', id: 137 }
  )
  expect(timers.pending).toHaveLength(1)

  connection.send.mock.calls[0][1]({ id: 1, jsonrpc: '2.0', result: null })
  await expect(result).resolves.toBeNull()
  expect(timers.pending).toHaveLength(0)
})

it.each([
  [{ id: 1, jsonrpc: '2.0', error: { code: 4901, message: 'chain disconnected' } }, 'chain disconnected'],
  [undefined, 'malformed response'],
  [{ id: 2, jsonrpc: '2.0', result: null }, 'malformed response'],
  [{ id: 1, jsonrpc: '1.0', result: null }, 'malformed response'],
  [{ id: 1, jsonrpc: '2.0' }, 'no result']
])('rejects RPC errors and malformed response envelopes', async (response, message) => {
  const connection = { send: jest.fn() }
  const rpc = createWalletCallEvidenceRPC(connection)
  const result = rpc.getTransactionReceipt('0x1', hash)

  connection.send.mock.calls[0][1](response)
  await expect(result).rejects.toThrow(message)
})

it('times out a stalled request and ignores its late callback', async () => {
  const timers = manualTimers()
  const connection = { send: jest.fn() }
  const rpc = createWalletCallEvidenceRPC(connection, {
    timeoutMs: 50,
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const result = rpc.getTransactionReceipt('0x1', hash)
  const callback = connection.send.mock.calls[0][1]

  expect(timers.pending[0].delay).toBe(50)
  timers.pending[0].callback()
  await expect(result).rejects.toThrow('eth_getTransactionReceipt timed out')
  callback({ id: 1, jsonrpc: '2.0', result: { transactionHash: hash } })
  expect(timers.pending).toHaveLength(0)
})

it('converts synchronous transport failures into request rejections', async () => {
  const connection = {
    send: jest.fn(() => {
      throw new Error('transport failed')
    })
  }
  const rpc = createWalletCallEvidenceRPC(connection)

  await expect(rpc.getTransaction('0x1', hash)).rejects.toThrow('transport failed')
})

it.each(['invalid', '0x00', '0x0', '0x20000000000000'])(
  'rejects an unusable chain id before transport: %s',
  async (chainId) => {
    const connection = { send: jest.fn() }
    const rpc = createWalletCallEvidenceRPC(connection)

    await expect(rpc.getTransaction(chainId, hash)).rejects.toThrow(/chain id/)
    expect(connection.send).not.toHaveBeenCalled()
  }
)

it.each([`0x${'A'.repeat(64)}`, '0x1', 'not-a-hash'])(
  'rejects a noncanonical transaction hash before transport: %s',
  async (transactionHash) => {
    const connection = { send: jest.fn() }
    const rpc = createWalletCallEvidenceRPC(connection)

    await expect(rpc.getTransaction('0x1', transactionHash)).rejects.toThrow(/transaction hash/)
    expect(connection.send).not.toHaveBeenCalled()
  }
)

it('allows only the canonical block query used by lifecycle reconciliation', async () => {
  const connection = { send: jest.fn() }
  const rpc = createWalletCallEvidenceRPC(connection)
  const result = rpc.rpc(1, 'eth_getBlockByNumber', ['0x10', false])

  expect(connection.send).toHaveBeenCalledWith(
    { id: 1, jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: ['0x10', false] },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
  connection.send.mock.calls[0][1]({
    id: 1,
    jsonrpc: '2.0',
    result: { number: '0x10', hash }
  })
  await expect(result).resolves.toEqual({ number: '0x10', hash })
})

it.each([
  ['eth_getBlockByNumber', ['pending', false]],
  ['eth_getBlockByNumber', ['0x10', true]],
  ['eth_sendRawTransaction', ['0x01']]
])('rejects out-of-scope lifecycle RPC before transport: %s', async (method, params) => {
  const connection = { send: jest.fn() }
  const rpc = createWalletCallEvidenceRPC(connection)

  await expect(rpc.rpc(1, method, params)).rejects.toThrow(/Invalid wallet-call evidence RPC request/)
  expect(connection.send).not.toHaveBeenCalled()
})
