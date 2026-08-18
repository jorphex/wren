import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'
import { WalletCallBatchLedger } from '../../../main/provider/walletCallBatches'
import {
  isWalletCallLifecycleCandidate,
  WalletCallLifecycleReconciler
} from '../../../main/provider/walletCallLifecycleReconciliation'

const account = '0x1111111111111111111111111111111111111111'
const origin = 'example.test'
const hash = (value: string) => `0x${value.repeat(64)}`

const memoryStorage = <T>(initial: T) => {
  let value = JSON.parse(JSON.stringify(initial)) as T
  return {
    load: jest.fn(() => JSON.parse(JSON.stringify(value)) as T),
    save: jest.fn((next: T) => {
      value = JSON.parse(JSON.stringify(next)) as T
    }),
    value: () => JSON.parse(JSON.stringify(value)) as T
  }
}

const receipt = (
  transactionHash: string,
  status: '0x0' | '0x1' = '0x1',
  overrides: Record<string, unknown> = {}
) => ({
  logs: [],
  status,
  type: '0x2' as const,
  blockHash: hash('b'),
  blockNumber: '0x10',
  gasUsed: '0x5208',
  effectiveGasPrice: '0x1',
  transactionHash,
  ...overrides
})

function fixture(callCount = 2) {
  const batchStorage = memoryStorage({})
  const operationStorage = memoryStorage({})
  const operations = new OperationLifecycleLedger(operationStorage)
  const batches = new WalletCallBatchLedger(batchStorage, operations)
  const admission = batches.create({ origin, account, chainId: '0x1', callCount }, 1_000)
  admission.commit()
  const operationId = admission.batch.operationId as string
  return { batchStorage, operationStorage, operations, batches, admission, operationId }
}

function canonicalRpc(
  receipts: Record<string, ReturnType<typeof receipt> | null>,
  latest = '0x20',
  finalized?: string
) {
  return jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    if (method === 'eth_getTransactionReceipt') return receipts[String(params[0])] ?? null
    if (method === 'eth_getTransactionByHash') return null
    if (method === 'eth_getBlockByNumber' && params[0] === 'latest') {
      return { number: latest, hash: hash('c') }
    }
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return finalized ? { number: finalized, hash: hash('f') } : null
    }
    if (method === 'eth_getBlockByNumber') return { number: params[0], hash: hash('b') }
    throw new Error(`Unexpected ${method}`)
  })
}

test('creates one stable lifecycle before a signed reservation can be broadcast', () => {
  const { batches, operations, admission, operationId } = fixture(1)
  batches.reserveTransaction(origin, account, admission.batch.id, hash('1'), 1_001)

  expect(admission.batch.operationId).toBe(operationId)
  expect(batches.get(origin, account, admission.batch.id, 1_002)).toMatchObject({
    operationId,
    transactions: [{ hash: hash('1'), state: 'signed' }]
  })
  expect(operations.get(operationId, 1_002)).toEqual(
    expect.objectContaining({
      id: operationId,
      kind: 'walletCalls',
      state: 'submitted',
      account,
      origin,
      walletCalls: { batchOperationId: operationId }
    })
  )
  expect(JSON.stringify(operations.get(operationId, 1_002))).not.toContain('calls')
  expect(batches.getStatus(origin, account, admission.batch.id, 1_002).status).toBe(100)
})

test('starts the network-pending clock at first signing, not at request admission', () => {
  const { batches, operations, admission, operationId } = fixture(1)
  const signedAt = 10 * 60 * 1000
  batches.reserveTransaction(origin, account, admission.batch.id, hash('1'), signedAt)

  const operation = operations.get(operationId, signedAt + 1)
  expect(operation).toMatchObject({ createdAt: signedAt, updatedAt: signedAt })
  expect(operation?.expiresAt).toBe(admission.batch.expiresAt)
})

test('reconciles every transaction after restart and confirms a complete batch at one receipt', async () => {
  const original = fixture(2)
  original.batches.recordTransaction(origin, account, original.admission.batch.id, hash('1'), 1_001)
  original.batches.recordTransaction(origin, account, original.admission.batch.id, hash('2'), 1_002)
  original.batches.complete(origin, account, original.admission.batch.id, 1_003)

  const operations = new OperationLifecycleLedger(original.operationStorage)
  const batches = new WalletCallBatchLedger(original.batchStorage, operations)
  const rpc = canonicalRpc({ [hash('1')]: receipt(hash('1')), [hash('2')]: receipt(hash('2')) }, '0x10')
  const observer = jest.fn()
  const reconciler = new WalletCallLifecycleReconciler(batches, operations, rpc, observer)

  await expect(reconciler.reconcileAll(2_000)).resolves.toEqual([
    { operationId: original.operationId, status: 'updated' }
  ])
  expect(operations.get(original.operationId, 2_001)).toMatchObject({
    state: 'confirmed',
    settlement: { status: 'monitoring' }
  })
  expect(batches.getStatus(origin, account, original.admission.batch.id, 2_001).status).toBe(200)
  expect(rpc.mock.calls.filter((call) => call[1] === 'eth_getTransactionReceipt')).toHaveLength(2)
  expect(observer).toHaveBeenCalledWith(
    expect.objectContaining({
      current: expect.objectContaining({ state: 'confirmed' }),
      confirmations: 1,
      pendingEvidence: false
    })
  )
})

test('continues after user confirmation until a finalized head covers every receipt', async () => {
  const state = fixture(2)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('2'), 1_002)
  state.batches.complete(origin, account, state.admission.batch.id, 1_003)
  const reconciler = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: receipt(hash('1')), [hash('2')]: receipt(hash('2')) }, '0x11', '0x10')
  )

  await reconciler.reconcileAll(2_000)
  await reconciler.reconcileAll(3_000)
  expect(state.operations.get(state.operationId, 3_001)).toMatchObject({
    state: 'confirmed',
    updatedAt: 2_000,
    settlement: { status: 'complete', basis: 'finalized' }
  })
})

test('does not settle a batch when its receipt block changes during finalized evidence', async () => {
  const state = fixture(1)
  const transactionHash = hash('1')
  state.batches.recordTransaction(origin, account, state.admission.batch.id, transactionHash, 1_001)
  state.batches.complete(origin, account, state.admission.batch.id, 1_002)
  let receiptBlockReads = 0
  const rpc = jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    if (method === 'eth_getTransactionReceipt') return receipt(transactionHash)
    if (method === 'eth_getBlockByNumber' && params[0] === 'latest') {
      return { number: '0x11', hash: hash('c') }
    }
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return { number: '0x10', hash: hash('f') }
    }
    if (method === 'eth_getBlockByNumber' && params[0] === '0x10') {
      receiptBlockReads += 1
      return { number: '0x10', hash: receiptBlockReads <= 2 ? hash('b') : hash('d') }
    }
    throw new Error(`Unexpected ${method}`)
  })
  const reconciler = new WalletCallLifecycleReconciler(state.batches, state.operations, rpc)

  await reconciler.reconcileAll(2_000)
  await reconciler.reconcileAll(3_000)
  expect(state.operations.get(state.operationId, 3_001)).toMatchObject({ state: 'reorged' })
  expect(
    state.batches.get(origin, account, state.admission.batch.id, 3_001).transactions[0]?.receipt
  ).toBeUndefined()
})

test('falls back to 13 canonical inclusions when finality tags are unavailable', async () => {
  const state = fixture(1)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.complete(origin, account, state.admission.batch.id, 1_002)
  const rpc = canonicalRpc({ [hash('1')]: receipt(hash('1')) }, '0x1c')
  const reconciler = new WalletCallLifecycleReconciler(state.batches, state.operations, rpc)

  await reconciler.reconcileAll(2_000)
  await reconciler.reconcileAll(3_000)
  expect(state.operations.get(state.operationId, 3_001)).toMatchObject({
    state: 'confirmed',
    updatedAt: 2_000,
    settlement: { status: 'complete', basis: 'confirmations' }
  })
  expect(
    rpc.mock.calls.some(
      ([, method, params]) => method === 'eth_getBlockByNumber' && params[0] === 'finalized'
    )
  ).toBe(false)
})

test('does not confirm an incomplete batch even when its submitted transaction is final', async () => {
  const state = fixture(2)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  const reconciler = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: receipt(hash('1')) })
  )

  await reconciler.reconcileAll(2_000)
  expect(state.operations.get(state.operationId, 2_001)?.state).toBe('confirming')
  expect(state.batches.getStatus(origin, account, state.admission.batch.id, 2_001).status).toBe(100)
})

test('continues receipt and finality evidence for a failed partial prefix after restart without resuming calls', async () => {
  const original = fixture(3)
  original.batches.recordTransaction(origin, account, original.admission.batch.id, hash('1'), 1_001)
  original.batches.fail(origin, account, original.admission.batch.id, 1_002)

  const operations = new OperationLifecycleLedger(original.operationStorage)
  const batches = new WalletCallBatchLedger(original.batchStorage, operations)
  const rpc = canonicalRpc({ [hash('1')]: receipt(hash('1')) }, '0x11', '0x10')
  const reconciler = new WalletCallLifecycleReconciler(batches, operations, rpc)

  await expect(reconciler.reconcileAll(2_000)).resolves.toEqual([
    { operationId: original.operationId, status: 'updated' }
  ])
  expect(batches.get(origin, account, original.admission.batch.id, 2_001)).toMatchObject({
    execution: 'failed',
    callCount: 3,
    transactions: [{ hash: hash('1'), state: 'submitted', receipt: expect.any(Object) }]
  })
  expect(operations.get(original.operationId, 2_001)).toMatchObject({
    state: 'failed',
    settlement: { status: 'monitoring' }
  })
  await reconciler.reconcileAll(3_000)
  expect(operations.get(original.operationId, 3_001)).toMatchObject({
    state: 'failed',
    settlement: { status: 'complete', basis: 'finalized' }
  })
  expect(rpc.mock.calls.filter((call) => call[1] === 'eth_getTransactionReceipt')).toHaveLength(2)
})

test('retries a failed partial prefix after a transient restart RPC outage', async () => {
  const original = fixture(2)
  original.batches.recordTransaction(origin, account, original.admission.batch.id, hash('1'), 1_001)
  original.batches.fail(origin, account, original.admission.batch.id, 1_002)
  const operations = new OperationLifecycleLedger(original.operationStorage)
  const batches = new WalletCallBatchLedger(original.batchStorage, operations)

  await expect(
    new WalletCallLifecycleReconciler(batches, operations, async () => {
      throw new Error('temporary offline')
    }).reconcileAll(2_000)
  ).resolves.toEqual([{ operationId: original.operationId, status: 'error', reason: 'temporary offline' }])
  expect(operations.get(original.operationId, 2_001)?.state).toBe('failed')

  await expect(
    new WalletCallLifecycleReconciler(
      batches,
      operations,
      canonicalRpc({ [hash('1')]: receipt(hash('1')) })
    ).reconcileAll(3_000)
  ).resolves.toEqual([{ operationId: original.operationId, status: 'updated' }])
  expect(operations.get(original.operationId, 3_001)).toMatchObject({
    state: 'failed',
    settlement: { status: 'monitoring' }
  })
})

test('does not poll a failed batch with no signed or submitted prefix', async () => {
  const state = fixture(2)
  state.batches.fail(origin, account, state.admission.batch.id, 1_001)
  const operation = state.operations.get(state.operationId, 2_000)
  expect(operation).toBeUndefined()
  const failedOperation = {
    kind: 'walletCalls',
    state: 'failed',
    settlement: { status: 'monitoring' }
  } as Parameters<typeof isWalletCallLifecycleCandidate>[0]
  expect(isWalletCallLifecycleCandidate(failedOperation, false)).toBe(false)
  expect(isWalletCallLifecycleCandidate(failedOperation, true)).toBe(true)

  const rpc = jest.fn(async () => null)
  await expect(
    new WalletCallLifecycleReconciler(state.batches, state.operations, rpc).reconcileAll(2_000)
  ).resolves.toEqual([])
  expect(rpc).not.toHaveBeenCalled()
})

test('clears reorged receipt evidence for a failed partial prefix and keeps the unsent suffix absent', async () => {
  const state = fixture(3)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.fail(origin, account, state.admission.batch.id, 1_002)
  await new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: receipt(hash('1')) }, '0x11')
  ).reconcileAll(2_000)

  await new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: null })
  ).reconcileAll(3_000)
  expect(state.operations.get(state.operationId, 3_001)?.state).toBe('reorged')
  expect(state.batches.get(origin, account, state.admission.batch.id, 3_001)).toMatchObject({
    execution: 'failed',
    callCount: 3,
    transactions: [{ hash: hash('1'), state: 'submitted' }]
  })
  expect(
    state.batches.get(origin, account, state.admission.batch.id, 3_001).transactions[0]?.receipt
  ).toBeUndefined()
})

test('marks a final mixed-result batch failed without changing truthful external status', async () => {
  const state = fixture(2)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('2'), 1_002)
  state.batches.complete(origin, account, state.admission.batch.id, 1_003)
  const reconciler = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({
      [hash('1')]: receipt(hash('1'), '0x1'),
      [hash('2')]: receipt(hash('2'), '0x0')
    })
  )

  await reconciler.reconcileAll(2_000)
  expect(state.operations.get(state.operationId, 2_001)?.state).toBe('failed')
  expect(state.batches.getStatus(origin, account, state.admission.batch.id, 2_001).status).toBe(600)
})

test('clears disappeared receipt evidence, reports a reorg, and continues checking', async () => {
  const state = fixture(1)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.complete(origin, account, state.admission.batch.id, 1_002)
  const first = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: receipt(hash('1')) }, '0x11')
  )
  await first.reconcileAll(2_000)
  expect(state.operations.get(state.operationId, 2_001)).toMatchObject({
    state: 'confirmed',
    settlement: { status: 'monitoring' }
  })
  expect(
    state.batches.get(origin, account, state.admission.batch.id, 2_001).transactions[0]?.receipt
  ).toBeDefined()

  const observer = jest.fn()
  const second = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: null }),
    observer
  )
  await second.reconcileAll(3_000)
  expect(state.operations.get(state.operationId, 3_001)?.state).toBe('reorged')
  expect(
    state.batches.get(origin, account, state.admission.batch.id, 3_001).transactions[0]?.receipt
  ).toBeUndefined()
  expect(observer).toHaveBeenCalledWith(
    expect.objectContaining({ current: expect.objectContaining({ state: 'reorged' }) })
  )
})

test('rejects a block-hash mismatch as a reorg instead of replacing trusted receipt evidence', async () => {
  const state = fixture(1)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.complete(origin, account, state.admission.batch.id, 1_002)
  state.batches.recordReceipt(origin, account, state.admission.batch.id, receipt(hash('1')), 1_003)
  const mismatched = receipt(hash('1'), '0x1', { blockHash: hash('d') })
  const rpc = canonicalRpc({ [hash('1')]: mismatched })

  await new WalletCallLifecycleReconciler(state.batches, state.operations, rpc).reconcileAll(2_000)
  expect(state.operations.get(state.operationId, 2_001)?.state).toBe('reorged')
  expect(
    state.batches.get(origin, account, state.admission.batch.id, 2_001).transactions[0]?.receipt
  ).toBeUndefined()
})

test('observes one reorg pass before accepting changed canonical receipt evidence', async () => {
  const state = fixture(1)
  const transactionHash = hash('1')
  const firstReceipt = receipt(transactionHash, '0x1', {
    blockHash: hash('a'),
    blockNumber: '0x10'
  })
  const movedReceipt = receipt(transactionHash, '0x1', {
    blockHash: hash('b'),
    blockNumber: '0x11'
  })
  state.batches.recordTransaction(origin, account, state.admission.batch.id, transactionHash, 1_001)
  state.batches.complete(origin, account, state.admission.batch.id, 1_002)
  state.batches.recordReceipt(origin, account, state.admission.batch.id, firstReceipt, 1_003)
  const rpc = jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    if (method === 'eth_getTransactionReceipt') return movedReceipt
    if (method === 'eth_getBlockByNumber' && params[0] === 'latest') {
      return { number: '0x20', hash: hash('c') }
    }
    if (method === 'eth_getBlockByNumber') {
      return { number: '0x11', hash: hash('b') }
    }
    throw new Error(`Unexpected ${method}`)
  })
  const observer = jest.fn()
  const reconciler = new WalletCallLifecycleReconciler(state.batches, state.operations, rpc, observer)

  await reconciler.reconcileAll(2_000)
  expect(state.operations.get(state.operationId, 2_001)?.state).toBe('reorged')
  expect(
    state.batches.get(origin, account, state.admission.batch.id, 2_001).transactions[0]?.receipt
  ).toEqual(movedReceipt)
  expect(observer).toHaveBeenCalledWith(
    expect.objectContaining({ current: expect.objectContaining({ state: 'reorged' }) })
  )

  await reconciler.reconcileAll(3_000)
  expect(state.operations.get(state.operationId, 3_001)?.state).toBe('confirmed')
})

test('keeps durable evidence unchanged during an RPC outage', async () => {
  const state = fixture(1)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  state.batches.complete(origin, account, state.admission.batch.id, 1_002)
  await new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: receipt(hash('1')) }, '0x11')
  ).reconcileAll(2_000)
  const before = state.batches.get(origin, account, state.admission.batch.id, 2_001)
  const outage = jest.fn(async () => {
    throw new Error('offline')
  })

  await expect(
    new WalletCallLifecycleReconciler(state.batches, state.operations, outage).reconcileAll(3_000)
  ).resolves.toEqual([{ operationId: state.operationId, status: 'error', reason: 'offline' }])
  expect(state.operations.get(state.operationId, 3_001)).toMatchObject({
    state: 'confirmed',
    settlement: { status: 'monitoring' }
  })
  expect(state.batches.get(origin, account, state.admission.batch.id, 3_001)).toEqual(before)
})

test('requires a current canonical receipt before reporting Wallet Call pending evidence', async () => {
  const state = fixture(1)
  state.batches.recordTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  const observer = jest.fn()
  const missing = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: null }),
    observer
  )

  await missing.reconcileAll(2_000)
  expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({ pendingEvidence: false }))

  const canonical = new WalletCallLifecycleReconciler(
    state.batches,
    state.operations,
    canonicalRpc({ [hash('1')]: receipt(hash('1')) }, '0x10'),
    observer
  )
  await canonical.reconcileAll(3_000)
  expect(observer).toHaveBeenLastCalledWith(
    expect.objectContaining({
      current: expect.objectContaining({ state: 'confirming' }),
      pendingEvidence: true
    })
  )
})

test('leaves signed broadcast-unclear evidence pending externally and never rebroadcasts', async () => {
  const state = fixture(1)
  state.batches.reserveTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  const rpc = canonicalRpc({ [hash('1')]: null })
  await new WalletCallLifecycleReconciler(state.batches, state.operations, rpc).reconcileAll(2_000)

  expect(state.batches.get(origin, account, state.admission.batch.id, 2_001).transactions).toEqual([
    { hash: hash('1'), state: 'signed' }
  ])
  expect(state.batches.getStatus(origin, account, state.admission.batch.id, 2_001).status).toBe(100)
  expect(rpc.mock.calls.map((call) => call[1])).toEqual([
    'eth_getTransactionReceipt',
    'eth_getTransactionByHash'
  ])
})

test('turns an expired wallet-call lifecycle into a durable stopped outcome', async () => {
  const state = fixture(1)
  state.batches.reserveTransaction(origin, account, state.admission.batch.id, hash('1'), 1_001)
  const expiresAt = state.admission.batch.expiresAt
  const rpc = jest.fn()
  const reconciler = new WalletCallLifecycleReconciler(state.batches, state.operations, rpc)

  await reconciler.reconcileAll(expiresAt)
  expect(state.operations.listStored().find(({ id }) => id === state.operationId)?.state).toBe('stopped')
  expect(rpc).not.toHaveBeenCalled()
})
