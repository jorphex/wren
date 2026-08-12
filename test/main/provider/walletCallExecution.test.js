import { executeWalletCallBatch, hashSignedTransaction } from '../../../main/provider/walletCallExecution'
import { WalletCallBatchLedger } from '../../../main/provider/walletCallBatches'
import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'
const rawTransactions = ['0x01', '0x02']
const hashes = rawTransactions.map(hashSignedTransaction)

function input(
  calls = [
    { to: target, data: '0xabcd', value: '0x0' },
    { data: '0x6000', value: '0x2' }
  ]
) {
  return { id: 'batch-id', origin: 'example.test', account, calls }
}

function dependencies(events = []) {
  const ledger = {
    reserveTransaction: jest.fn((_origin, _account, _id, hash) => events.push(`reserve:${hash}`)),
    markTransactionSubmitted: jest.fn((_origin, _account, _id, hash) => events.push(`submit:${hash}`)),
    complete: jest.fn(() => events.push('complete')),
    fail: jest.fn(() => events.push('fail'))
  }
  return {
    ledger,
    signCall: jest.fn(async (_call, index) => {
      events.push(`sign:${index}`)
      return { rawTransaction: rawTransactions[index] }
    }),
    broadcast: jest.fn(async (_rawTransaction, index) => {
      events.push(`broadcast:${index}`)
      return hashes[index]
    })
  }
}

it('hashes exact bounded signed transaction bytes', () => {
  expect(hashSignedTransaction('0x01')).toBe(
    '0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2'
  )
  expect(() => hashSignedTransaction('0x')).toThrow(/Invalid signed transaction/)
  expect(() => hashSignedTransaction('0x0')).toThrow(/Invalid signed transaction/)
  expect(() => hashSignedTransaction(`0x${'00'.repeat(256 * 1024 + 1)}`)).toThrow(
    /Invalid signed transaction/
  )
})

it('signs, reserves, broadcasts, and submits each call strictly in order', async () => {
  const events = []
  const deps = dependencies(events)

  await expect(executeWalletCallBatch(input(), deps)).resolves.toEqual(hashes)
  expect(events).toEqual([
    'sign:0',
    `reserve:${hashes[0]}`,
    'broadcast:0',
    `submit:${hashes[0]}`,
    'sign:1',
    `reserve:${hashes[1]}`,
    'broadcast:1',
    `submit:${hashes[1]}`,
    'complete'
  ])
})

it('uses an immutable normalized snapshot instead of later caller mutations', async () => {
  const calls = [{ to: target.toUpperCase().replace('0X', '0x'), data: '0xABCD', value: '0xA' }]
  const deps = dependencies()
  deps.signCall.mockImplementationOnce(async (call) => {
    expect(Object.isFrozen(call)).toBe(true)
    expect(call).toEqual({ to: target, data: '0xabcd', value: '0xa' })
    calls[0].data = '0xffff'
    return { rawTransaction: rawTransactions[0] }
  })

  await executeWalletCallBatch(input(calls), deps)
  expect(deps.signCall.mock.calls[0][0].data).toBe('0xabcd')
})

it('keeps a mismatched broadcast hash pending for reconciliation and stops later calls', async () => {
  const events = []
  const deps = dependencies(events)
  deps.broadcast.mockResolvedValueOnce(`0x${'f'.repeat(64)}`)

  await expect(executeWalletCallBatch(input(), deps)).rejects.toThrow(/mismatched transaction hash/)
  expect(events).toEqual(['sign:0', `reserve:${hashes[0]}`])
  expect(deps.signCall).toHaveBeenCalledTimes(1)
  expect(deps.ledger.markTransactionSubmitted).not.toHaveBeenCalled()
  expect(deps.ledger.fail).not.toHaveBeenCalled()
})

it('leaves a rejected broadcast pending because RPC acceptance is ambiguous', async () => {
  const deps = dependencies()
  deps.broadcast.mockRejectedValueOnce(new Error('connection closed'))

  await expect(executeWalletCallBatch(input(), deps)).rejects.toThrow('connection closed')
  expect(deps.ledger.reserveTransaction).toHaveBeenCalledWith('example.test', account, 'batch-id', hashes[0])
  expect(deps.ledger.markTransactionSubmitted).not.toHaveBeenCalled()
  expect(deps.ledger.fail).not.toHaveBeenCalled()
  expect(deps.signCall).toHaveBeenCalledTimes(1)
})

it('leaves an accepted broadcast pending when its submitted-state write fails', async () => {
  const deps = dependencies()
  deps.ledger.markTransactionSubmitted.mockImplementationOnce(() => {
    throw new Error('persistence unavailable')
  })

  await expect(executeWalletCallBatch(input(), deps)).rejects.toThrow('persistence unavailable')
  expect(deps.ledger.fail).not.toHaveBeenCalled()
  expect(deps.signCall).toHaveBeenCalledTimes(1)
})

it('stops on signing failure before reserving or broadcasting', async () => {
  const events = []
  const deps = dependencies(events)
  deps.signCall.mockRejectedValueOnce(new Error('device declined'))

  await expect(executeWalletCallBatch(input(), deps)).rejects.toThrow('device declined')
  expect(events).toEqual(['fail'])
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
  expect(deps.broadcast).not.toHaveBeenCalled()
})

it('does not create a terminal lifecycle when signing fails before reservation', async () => {
  let batches = {}
  let operations = {}
  const operationLifecycles = new OperationLifecycleLedger({
    load: () => structuredClone(operations),
    save: (value) => {
      operations = structuredClone(value)
    }
  })
  const ledger = new WalletCallBatchLedger(
    {
      load: () => structuredClone(batches),
      save: (value) => {
        batches = structuredClone(value)
      }
    },
    operationLifecycles
  )
  ledger.create({ id: 'batch-id', origin: 'example.test', account, chainId: '0x1', callCount: 2 }).commit()

  await expect(
    executeWalletCallBatch(input(), {
      ledger,
      signCall: jest.fn(async () => {
        throw new Error('device declined')
      }),
      broadcast: jest.fn()
    })
  ).rejects.toThrow('device declined')
  expect(ledger.getStatus('example.test', account, 'batch-id').status).toBe(400)
  expect(operationLifecycles.listStored()).toEqual([])
})

it('fails terminally after a confirmed earlier submission and stops the remainder', async () => {
  const events = []
  const deps = dependencies(events)
  deps.signCall.mockImplementation(async (_call, index) => {
    events.push(`sign:${index}`)
    if (index === 1) throw new Error('second signature declined')
    return { rawTransaction: rawTransactions[index] }
  })

  await expect(executeWalletCallBatch(input(), deps)).rejects.toThrow('second signature declined')
  expect(events).toEqual([
    'sign:0',
    `reserve:${hashes[0]}`,
    'broadcast:0',
    `submit:${hashes[0]}`,
    'sign:1',
    'fail'
  ])
  expect(deps.broadcast).toHaveBeenCalledTimes(1)
})

it('bounds combined execution and ledger-close failures', async () => {
  const deps = dependencies()
  deps.signCall.mockRejectedValueOnce(new Error('x'.repeat(300)))
  deps.ledger.fail.mockImplementationOnce(() => {
    throw new Error('y'.repeat(100))
  })

  let error
  try {
    await executeWalletCallBatch(input(), deps)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  expect(error.message.length).toBeLessThanOrEqual(240)
  expect(error.message).toMatch(/ledger close failed/)
})

it.each([
  { calls: [] },
  { calls: Array.from({ length: 17 }, () => ({ data: '0x', value: '0x0' })) },
  { calls: [{ to: '0x1', data: '0x', value: '0x0' }] },
  { calls: [{ data: '0x0', value: '0x0' }] },
  { calls: [{ data: '0x', value: '0x00' }] },
  { calls: [{ data: '0x', value: `0x1${'0'.repeat(64)}` }] }
])('rejects invalid call snapshots before starting execution: %#', async ({ calls }) => {
  const deps = dependencies()

  await expect(executeWalletCallBatch(input(calls), deps)).rejects.toThrow()
  expect(deps.signCall).not.toHaveBeenCalled()
  expect(deps.ledger.fail).not.toHaveBeenCalled()
})
