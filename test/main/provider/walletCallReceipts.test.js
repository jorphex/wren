import {
  collectWalletCallReceipt,
  collectWalletCallReceipts
} from '../../../main/provider/walletCallReceipts'
import { WalletCallBatchLedger } from '../../../main/provider/walletCallBatches'

const account = '0x1111111111111111111111111111111111111111'
const hash = (value) => `0x${value.repeat(64)}`

function candidate(overrides = {}) {
  return {
    origin: 'example.test',
    account,
    id: 'batch-id',
    chainId: '0x1',
    hash: hash('1'),
    ...overrides
  }
}

function receipt(overrides = {}) {
  return {
    logs: [],
    status: '0x1',
    blockHash: hash('b'),
    blockNumber: '0x1',
    gasUsed: '0x5208',
    transactionHash: hash('1'),
    ...overrides
  }
}

function dependencies() {
  return {
    ledger: { recordReceipt: jest.fn() },
    getTransactionReceipt: jest.fn().mockResolvedValue(null)
  }
}

function ledgerWithMemoryStorage() {
  let batches = {}
  return new WalletCallBatchLedger({
    load: () => JSON.parse(JSON.stringify(batches)),
    save: (value) => {
      batches = JSON.parse(JSON.stringify(value))
    }
  })
}

it('records only a schema-valid receipt bound to the submitted hash', async () => {
  const deps = dependencies()
  const transactionReceipt = receipt()
  deps.getTransactionReceipt.mockResolvedValueOnce(transactionReceipt)

  await expect(collectWalletCallReceipt(candidate(), deps)).resolves.toEqual({
    status: 'receipt-recorded'
  })
  expect(deps.ledger.recordReceipt).toHaveBeenCalledWith(
    'example.test',
    account,
    'batch-id',
    transactionReceipt
  )
})

it('selects bounded fee evidence from a full RPC receipt', async () => {
  const deps = dependencies()
  deps.getTransactionReceipt.mockResolvedValueOnce(
    receipt({
      type: '0x2',
      effectiveGasPrice: '0x3b9aca00',
      from: account,
      cumulativeGasUsed: '0x5208',
      logs: [
        {
          address: account,
          data: '0x',
          topics: [],
          blockNumber: '0x1',
          transactionHash: hash('1')
        }
      ]
    })
  )

  await expect(collectWalletCallReceipt(candidate(), deps)).resolves.toEqual({
    status: 'receipt-recorded'
  })
  expect(deps.ledger.recordReceipt).toHaveBeenCalledWith('example.test', account, 'batch-id', {
    logs: [{ address: account, data: '0x', topics: [] }],
    status: '0x1',
    type: '0x2',
    blockHash: hash('b'),
    blockNumber: '0x1',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x3b9aca00',
    transactionHash: hash('1')
  })
})

it('completes persisted batch status and removes the collected receipt candidate', async () => {
  const ledger = ledgerWithMemoryStorage()
  const now = Date.now()
  ledger.create({ origin: 'example.test', account, id: 'batch-id', chainId: '0x1', callCount: 1 }, now)
  ledger.recordTransaction('example.test', account, 'batch-id', hash('1'), now + 1)
  ledger.complete('example.test', account, 'batch-id', now + 2)
  expect(ledger.getStatus('example.test', account, 'batch-id', now + 3).status).toBe(100)

  await expect(
    collectWalletCallReceipts(ledger.listReceiptCandidates(now + 3), {
      ledger,
      getTransactionReceipt: jest.fn().mockResolvedValue(receipt())
    })
  ).resolves.toEqual([{ status: 'receipt-recorded' }])

  expect(ledger.listReceiptCandidates(now + 4)).toEqual([])
  expect(ledger.getStatus('example.test', account, 'batch-id', now + 4)).toMatchObject({
    status: 200,
    receipts: [{ transactionHash: hash('1') }]
  })
})

it('keeps a missing receipt pending without mutating persistence', async () => {
  const deps = dependencies()

  await expect(collectWalletCallReceipt(candidate(), deps)).resolves.toEqual({ status: 'pending' })
  expect(deps.ledger.recordReceipt).not.toHaveBeenCalled()
})

it.each([
  'not-a-receipt',
  receipt({ transactionHash: hash('2') }),
  receipt({ status: '0x2' }),
  receipt({ logs: [{ address: account, data: '0x0', topics: [] }] })
])('rejects malformed or mismatched receipt evidence without mutation: %#', async (value) => {
  const deps = dependencies()
  deps.getTransactionReceipt.mockResolvedValueOnce(value)

  const outcome = await collectWalletCallReceipt(candidate(), deps)
  expect(outcome).toMatchObject({
    status: 'error',
    reason: 'Transaction receipt is malformed or does not match the submitted hash'
  })
  expect(deps.ledger.recordReceipt).not.toHaveBeenCalled()
})

it('returns bounded retryable errors for lookup and persistence failures', async () => {
  const lookupFailure = dependencies()
  lookupFailure.getTransactionReceipt.mockRejectedValueOnce(new Error('x'.repeat(500)))
  const lookupOutcome = await collectWalletCallReceipt(candidate(), lookupFailure)
  expect(lookupOutcome.status).toBe('error')
  expect(lookupOutcome.reason).toHaveLength(240)
  expect(lookupFailure.ledger.recordReceipt).not.toHaveBeenCalled()

  const persistenceFailure = dependencies()
  persistenceFailure.getTransactionReceipt.mockResolvedValueOnce(receipt())
  persistenceFailure.ledger.recordReceipt.mockImplementationOnce(() => {
    throw new Error('receipt storage unavailable')
  })
  await expect(collectWalletCallReceipt(candidate(), persistenceFailure)).resolves.toEqual({
    status: 'error',
    reason: 'receipt storage unavailable'
  })
})

it('uses one immutable candidate snapshot across the asynchronous lookup', async () => {
  const deps = dependencies()
  const mutableCandidate = candidate()
  deps.getTransactionReceipt.mockImplementationOnce(async () => {
    mutableCandidate.account = '0x2222222222222222222222222222222222222222'
    mutableCandidate.id = 'redirected-batch'
    mutableCandidate.hash = hash('2')
    return receipt()
  })

  await expect(collectWalletCallReceipt(mutableCandidate, deps)).resolves.toEqual({
    status: 'receipt-recorded'
  })
  expect(deps.ledger.recordReceipt).toHaveBeenCalledWith('example.test', account, 'batch-id', receipt())
})

it.each([
  { origin: '' },
  { account: '0x1' },
  { id: String.fromCodePoint(0xa2).repeat(2049) },
  { chainId: '0x01' },
  { hash: hash('A') }
])('rejects invalid candidates before receipt lookup: %#', async (overrides) => {
  const deps = dependencies()

  await expect(collectWalletCallReceipt(candidate(overrides), deps)).resolves.toEqual({
    status: 'error',
    reason: 'Invalid wallet call evidence candidate'
  })
  expect(deps.getTransactionReceipt).not.toHaveBeenCalled()
})

it('collects receipts sequentially and isolates one failure from later candidates', async () => {
  const events = []
  const deps = dependencies()
  deps.getTransactionReceipt.mockImplementation(async (_chainId, transactionHash) => {
    events.push(`lookup:${transactionHash}`)
    if (transactionHash === hash('1')) throw new Error('first chain unavailable')
    return receipt({ transactionHash })
  })
  deps.ledger.recordReceipt.mockImplementation((_origin, _account, id) => events.push(`record:${id}`))

  await expect(
    collectWalletCallReceipts([candidate(), candidate({ id: 'batch-two', hash: hash('2') })], deps)
  ).resolves.toEqual([{ status: 'error', reason: 'first chain unavailable' }, { status: 'receipt-recorded' }])
  expect(events).toEqual([`lookup:${hash('1')}`, `lookup:${hash('2')}`, 'record:batch-two'])
})

it('snapshots every candidate before asynchronous queue processing', async () => {
  const deps = dependencies()
  const second = candidate({ id: 'batch-two', hash: hash('2') })
  const candidates = [candidate(), second]
  deps.getTransactionReceipt.mockImplementation(async (_chainId, transactionHash) => {
    if (transactionHash === hash('2')) return receipt({ transactionHash })
    candidates.push(candidate({ id: 'injected', hash: hash('2') }))
    second.id = 'redirected'
    second.hash = hash('3')
    return null
  })

  await expect(collectWalletCallReceipts(candidates, deps)).resolves.toEqual([
    { status: 'pending' },
    { status: 'receipt-recorded' }
  ])
  expect(deps.getTransactionReceipt).toHaveBeenCalledTimes(2)
  expect(deps.getTransactionReceipt).toHaveBeenLastCalledWith('0x1', hash('2'))
  expect(deps.ledger.recordReceipt).toHaveBeenCalledWith(
    'example.test',
    account,
    'batch-two',
    receipt({ transactionHash: hash('2') })
  )
})

it('rejects an oversized candidate queue before receipt lookup', async () => {
  const deps = dependencies()
  const candidates = Array.from({ length: 4097 }, (_, index) => candidate({ id: `batch-${index}` }))

  await expect(collectWalletCallReceipts(candidates, deps)).rejects.toThrow(/limit exceeded/)
  expect(deps.getTransactionReceipt).not.toHaveBeenCalled()
})
