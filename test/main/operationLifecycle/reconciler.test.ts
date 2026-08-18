import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'
import { OperationLifecycleReconciler } from '../../../main/operationLifecycle/reconciler'
import {
  MAX_OPERATION_LIFECYCLE_AGE_MS,
  type OperationLifecycle,
  type OperationLifecycles
} from '../../../main/store/state/types/operationLifecycle'

const account = `0x${'a'.repeat(40)}`
const hash = `0x${'b'.repeat(64)}`
const blockHash = `0x${'c'.repeat(64)}`
const latestHash = `0x${'d'.repeat(64)}`

const operation = (overrides: Partial<OperationLifecycle> = {}): OperationLifecycle => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'transaction',
  account,
  origin: 'app.example',
  chainId: 1,
  state: 'submitted',
  createdAt: 10,
  updatedAt: 10,
  expiresAt: 10 + MAX_OPERATION_LIFECYCLE_AGE_MS,
  visibleInActivity: true,
  notification: {},
  transaction: { hash, nonce: '0x1' },
  ...overrides
})

const fixture = (initial: OperationLifecycle, responses: Record<string, unknown>) => {
  let stored: OperationLifecycles = { [initial.id]: initial }
  const ledger = new OperationLifecycleLedger({
    load: () => stored,
    save: (value) => {
      stored = value
    }
  })
  const rpc = jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    const key = `${method}:${String(params[0] ?? '')}`
    const response = responses[key] ?? responses[method]
    if (response instanceof Error) throw response
    return response
  })
  const observer = jest.fn()
  return { ledger, rpc, observer, reconciler: new OperationLifecycleReconciler(ledger, rpc, observer) }
}

const canonical = (status: '0x0' | '0x1' = '0x1', latest = '0x10') => ({
  [`eth_getTransactionReceipt:${hash}`]: {
    transactionHash: hash,
    blockHash,
    blockNumber: '0x5',
    status,
    gasUsed: '0x5208'
  },
  'eth_getBlockByNumber:0x5': { number: '0x5', hash: blockHash },
  'eth_getBlockByNumber:latest': { number: latest, hash: latest === '0x5' ? blockHash : latestHash },
  [`eth_getBlockByNumber:${latest}`]: {
    number: latest,
    hash: latest === '0x5' ? blockHash : latestHash
  }
})

test('ordinary transactions resolve on their first canonical receipt and keep monitoring settlement', async () => {
  const confirmed = fixture(operation(), canonical('0x1', '0x5'))
  await expect(confirmed.reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({
    state: 'confirmed',
    receipt: { blockHash, status: '0x1' },
    settlement: { status: 'monitoring' }
  })
  expect(
    confirmed.rpc.mock.calls.some(
      ([, method, params]) => method === 'eth_getBlockByNumber' && params[0] === 'finalized'
    )
  ).toBe(false)

  const failed = fixture(operation(), canonical('0x0', '0x5'))
  await expect(failed.reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({
    state: 'failed',
    receipt: { status: '0x0' },
    settlement: { status: 'monitoring' }
  })

  const noncanonical = fixture(operation(), {
    ...canonical('0x1', '0x5'),
    'eth_getBlockByNumber:0x5': { number: '0x5', hash: `0x${'e'.repeat(64)}` }
  })
  await expect(noncanonical.reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({
    state: 'reorged'
  })
})

test('background settlement uses a finalized head without moving user completion time', async () => {
  const subject = fixture(operation(), {
    ...canonical('0x1', '0x6'),
    'eth_getBlockByNumber:finalized': { number: '0x5', hash: blockHash }
  })
  const first = await subject.reconciler.reconcile(operation().id, 20)
  expect(first).toMatchObject({ state: 'confirmed', updatedAt: 20, settlement: { status: 'monitoring' } })

  const second = await subject.reconciler.reconcile(operation().id, 30)
  expect(second).toMatchObject({
    state: 'confirmed',
    updatedAt: 20,
    settlement: { status: 'complete', basis: 'finalized' }
  })
  expect(subject.ledger.get(operation().id, 30)?.updatedAt).toBe(20)
  expect(subject.observer).toHaveBeenLastCalledWith(
    expect.objectContaining({
      previous: expect.objectContaining({ updatedAt: 20 }),
      current: expect.objectContaining({ updatedAt: 20 }),
      confirmations: 2,
      pendingEvidence: false
    })
  )
})

test('finalized settlement rejects a receipt block that changes during the evidence read', async () => {
  let receiptBlockReads = 0
  const responses = canonical('0x1', '0x6')
  let stored: OperationLifecycles = { [operation().id]: operation() }
  const ledger = new OperationLifecycleLedger({ load: () => stored, save: (value) => (stored = value) })
  const rpc = jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
      return { number: '0x5', hash: `0x${'f'.repeat(64)}` }
    }
    if (method === 'eth_getBlockByNumber' && params[0] === '0x5') {
      receiptBlockReads += 1
      return {
        number: '0x5',
        hash: receiptBlockReads <= 2 ? blockHash : `0x${'e'.repeat(64)}`
      }
    }
    return responses[`${method}:${String(params[0] ?? '')}`] ?? responses[method]
  })
  const reconciler = new OperationLifecycleReconciler(ledger, rpc)

  await reconciler.reconcile(operation().id, 20)
  await expect(reconciler.reconcile(operation().id, 30)).resolves.toMatchObject({ state: 'reorged' })
  expect(ledger.get(operation().id, 30)).not.toHaveProperty('receipt')
  expect(ledger.get(operation().id, 30)).not.toHaveProperty('settlement')
})

test('background settlement falls back to 13 canonical inclusions', async () => {
  const subject = fixture(operation(), canonical('0x1', '0x11'))
  await subject.reconciler.reconcile(operation().id, 20)
  await expect(subject.reconciler.reconcile(operation().id, 30)).resolves.toMatchObject({
    state: 'confirmed',
    updatedAt: 20,
    settlement: { status: 'complete', basis: 'confirmations' }
  })
  expect(
    subject.rpc.mock.calls.filter(
      ([, method, params]) => method === 'eth_getBlockByNumber' && params[0] === 'finalized'
    )
  ).toHaveLength(0)
})

test('an unavailable finalized tag leaves background settlement pending below the fallback', async () => {
  const subject = fixture(operation(), canonical('0x1', '0x6'))
  await subject.reconciler.reconcile(operation().id, 20)
  await expect(subject.reconciler.reconcile(operation().id, 30)).resolves.toMatchObject({
    state: 'confirmed',
    updatedAt: 20,
    settlement: { status: 'monitoring' }
  })
  expect(subject.ledger.get(operation().id, 30)?.updatedAt).toBe(20)
})

test('background settlement expiry preserves the user outcome and stops further monitoring', async () => {
  const expired = operation({
    state: 'confirmed',
    createdAt: 0,
    updatedAt: 5,
    expiresAt: 10,
    receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1' },
    settlement: { status: 'monitoring' }
  })
  const { reconciler, rpc } = fixture(expired, {})
  await expect(reconciler.reconcile(expired.id, 10)).resolves.toMatchObject({
    state: 'confirmed',
    updatedAt: 5,
    settlement: { status: 'complete', basis: 'expired' }
  })
  expect(rpc).not.toHaveBeenCalled()
})

test('receipt disappearance marks reorg then returns to submitted without fabricating failure', async () => {
  const withReceipt = operation({
    state: 'confirmed',
    settlement: { status: 'monitoring' },
    receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1' }
  })
  const first = fixture(withReceipt, { [`eth_getTransactionReceipt:${hash}`]: null })
  const reorged = await first.reconciler.reconcile(withReceipt.id, 20)
  expect(reorged).toMatchObject({ state: 'reorged' })
  expect(reorged).not.toHaveProperty('receipt')
  const second = fixture(reorged as OperationLifecycle, { [`eth_getTransactionReceipt:${hash}`]: null })
  await expect(second.reconciler.reconcile(withReceipt.id, 21)).resolves.toMatchObject({
    state: 'submitted'
  })
})

test('changed receipt evidence requires one reorg pass before accepting its new canonical block', async () => {
  const withReceipt = operation({
    state: 'confirmed',
    settlement: { status: 'monitoring' },
    receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1' }
  })
  const movedBlockHash = `0x${'e'.repeat(64)}`
  const movedResponses = {
    [`eth_getTransactionReceipt:${hash}`]: {
      transactionHash: hash,
      blockHash: movedBlockHash,
      blockNumber: '0x6',
      status: '0x1'
    },
    'eth_getBlockByNumber:0x6': { number: '0x6', hash: movedBlockHash },
    'eth_getBlockByNumber:latest': { number: '0x6', hash: movedBlockHash }
  }
  const first = fixture(withReceipt, movedResponses)
  const reorged = await first.reconciler.reconcile(withReceipt.id, 20)
  expect(reorged).toMatchObject({ state: 'reorged' })
  expect(reorged).not.toHaveProperty('receipt')

  const second = fixture(reorged as OperationLifecycle, movedResponses)
  await expect(second.reconciler.reconcile(withReceipt.id, 21)).resolves.toMatchObject({
    state: 'confirmed',
    receipt: { blockNumber: '0x6', blockHash: movedBlockHash },
    settlement: { status: 'monitoring' }
  })
})

test('RPC outages preserve the exact lifecycle state and evidence', async () => {
  const current = operation({
    state: 'confirmed',
    settlement: { status: 'monitoring' },
    receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1' }
  })
  const { reconciler, ledger, observer } = fixture(current, {
    [`eth_getTransactionReceipt:${hash}`]: new Error('offline')
  })
  await expect(reconciler.reconcile(current.id, 20)).resolves.toEqual(current)
  expect(ledger.get(current.id, 20)).toEqual(current)
  expect(observer).toHaveBeenCalledWith(
    expect.objectContaining({ previous: current, current, pendingEvidence: false })
  )
})

test.each([
  ['ordinary transaction', operation()],
  [
    'EIP-7702 revocation',
    operation({
      kind: 'eip7702Revoke',
      transaction: undefined,
      eip7702Revoke: { hash, expectedFinalNonce: '0x2' }
    })
  ]
] as const)(
  '%s restart reconciliation reads evidence only and never rebroadcasts',
  async (_kind, current) => {
    const rpc = jest.fn(async (_chainId: number, method: string) => {
      if (method === 'eth_sendRawTransaction') throw new Error('must not rebroadcast')
      if (method === 'eth_getTransactionReceipt') return null
      throw new Error(`Unexpected method ${method}`)
    })
    let stored: OperationLifecycles = { [current.id]: current }
    const ledger = new OperationLifecycleLedger({ load: () => stored, save: (value) => (stored = value) })
    const reconciler = new OperationLifecycleReconciler(ledger, rpc)

    await expect(reconciler.reconcileAll(20)).resolves.toBeUndefined()
    expect(ledger.get(current.id, 20)).toMatchObject({ state: 'submitted' })
    expect(rpc).toHaveBeenCalledWith(1, 'eth_getTransactionReceipt', [hash])
    expect(rpc.mock.calls.map(([, method]) => method)).not.toContain('eth_sendRawTransaction')
  }
)

test('an ordinary canonical receipt publishes a terminal outcome instead of pending evidence', async () => {
  const subject = fixture(operation(), canonical('0x1', '0x5'))
  await subject.reconciler.reconcile(operation().id, 20)
  expect(subject.observer).toHaveBeenLastCalledWith(
    expect.objectContaining({
      current: expect.objectContaining({ state: 'confirmed' }),
      confirmations: 1,
      pendingEvidence: false
    })
  )
})

test('EIP-7702 keeps canonical nonterminal receipts as positive pending evidence', async () => {
  const current = operation({
    kind: 'eip7702Revoke',
    transaction: undefined,
    eip7702Revoke: { hash, expectedFinalNonce: '0x2' }
  })
  const subject = fixture(current, canonical('0x1', '0xf'))
  await subject.reconciler.reconcile(current.id, 20)
  expect(subject.observer).toHaveBeenLastCalledWith(
    expect.objectContaining({
      current: expect.objectContaining({ state: 'confirming' }),
      pendingEvidence: true
    })
  )
})

test('a known confirmed sibling with the same account, chain, and nonce replaces a pending tx', async () => {
  let stored: OperationLifecycles = {
    [operation().id]: operation(),
    '00000000-0000-4000-8000-000000000002': operation({
      id: '00000000-0000-4000-8000-000000000002',
      state: 'confirmed',
      transaction: { hash: `0x${'e'.repeat(64)}`, nonce: '0x1' }
    })
  }
  const ledger = new OperationLifecycleLedger({ load: () => stored, save: (value) => (stored = value) })
  const rpc = jest.fn()
  const reconciler = new OperationLifecycleReconciler(ledger, rpc)
  await expect(reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({ state: 'replaced' })
  expect(rpc).not.toHaveBeenCalled()
})

test('an unfinalized same-nonce sibling does not irreversibly replace a pending tx', async () => {
  let stored: OperationLifecycles = {
    [operation().id]: operation(),
    '00000000-0000-4000-8000-000000000002': operation({
      id: '00000000-0000-4000-8000-000000000002',
      state: 'confirmed',
      transaction: { hash: `0x${'e'.repeat(64)}`, nonce: '0x1' },
      receipt: {
        transactionHash: `0x${'e'.repeat(64)}`,
        blockHash,
        blockNumber: '0x5',
        status: '0x1'
      },
      settlement: { status: 'monitoring' }
    })
  }
  const ledger = new OperationLifecycleLedger({ load: () => stored, save: (value) => (stored = value) })
  const rpc = jest.fn(async () => null)
  const reconciler = new OperationLifecycleReconciler(ledger, rpc)

  await expect(reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({ state: 'submitted' })
  expect(rpc).toHaveBeenCalledWith(1, 'eth_getTransactionReceipt', [hash])
})

test('a duplicate lifecycle row for the same transaction hash is not a replacement', async () => {
  let stored: OperationLifecycles = {
    [operation().id]: operation(),
    '00000000-0000-4000-8000-000000000002': operation({
      id: '00000000-0000-4000-8000-000000000002',
      state: 'confirmed'
    })
  }
  const ledger = new OperationLifecycleLedger({ load: () => stored, save: (value) => (stored = value) })
  const rpc = jest.fn(async () => null)
  const reconciler = new OperationLifecycleReconciler(ledger, rpc)
  await expect(reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({ state: 'submitted' })
  expect(rpc).toHaveBeenCalledWith(1, 'eth_getTransactionReceipt', [hash])
})

test('a failed canonical same-nonce transaction still replaces the older transaction', async () => {
  let stored: OperationLifecycles = {
    [operation().id]: operation(),
    '00000000-0000-4000-8000-000000000002': operation({
      id: '00000000-0000-4000-8000-000000000002',
      transaction: { hash: `0x${'9'.repeat(64)}`, nonce: '0x1' },
      state: 'failed'
    })
  }
  const ledger = new OperationLifecycleLedger({ load: () => stored, save: (value) => (stored = value) })
  const rpc = jest.fn()
  const reconciler = new OperationLifecycleReconciler(ledger, rpc)

  await expect(reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({ state: 'replaced' })
  expect(rpc).not.toHaveBeenCalled()
})

test('expiry persists a stopped result until its terminal projection is handled', async () => {
  const expired = operation({ createdAt: 0, updatedAt: 0, expiresAt: 10 })
  const { reconciler, ledger, observer, rpc } = fixture(expired, {})
  await expect(reconciler.reconcile(expired.id, 10)).resolves.toMatchObject({ state: 'stopped' })
  expect(ledger.listStored()).toEqual([expect.objectContaining({ id: expired.id, state: 'stopped' })])
  expect(observer).toHaveBeenCalledWith(
    expect.objectContaining({ previous: expired, current: expect.objectContaining({ state: 'stopped' }) })
  )
  expect(rpc).not.toHaveBeenCalled()
})

test('expired confirmed EIP-7702 evidence becomes clearance-unverified instead of success', async () => {
  const expired = operation({
    kind: 'eip7702Revoke',
    transaction: undefined,
    eip7702Revoke: { hash, expectedFinalNonce: '0x2' },
    state: 'confirming',
    createdAt: 0,
    updatedAt: 5,
    expiresAt: 10,
    receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1' }
  })
  const { reconciler, rpc } = fixture(expired, {})
  await expect(reconciler.reconcile(expired.id, 10)).resolves.toMatchObject({
    state: 'clearance-unverified'
  })
  expect(rpc).not.toHaveBeenCalled()
})

test('EIP-7702 clearance requires stable block-bound no-code evidence regardless of receipt status', async () => {
  const revoke = operation({
    kind: 'eip7702Revoke',
    transaction: undefined,
    eip7702Revoke: { hash, expectedFinalNonce: '0x2' }
  })
  const cleared = fixture(revoke, { ...canonical('0x0'), eth_getCode: '0x' })
  await expect(cleared.reconciler.reconcile(revoke.id, 20)).resolves.toMatchObject({
    state: 'verified-clearance',
    receipt: { status: '0x0' }
  })

  const remains = fixture(revoke, {
    ...canonical('0x1'),
    eth_getCode: `0xef0100${'f'.repeat(40)}`
  })
  await expect(remains.reconciler.reconcile(revoke.id, 20)).resolves.toMatchObject({
    state: 'failed',
    receipt: { status: '0x1' }
  })
})

test('EIP-7702 does not claim clearance when code evidence is unavailable or changes mid-read', async () => {
  const revoke = operation({
    kind: 'eip7702Revoke',
    transaction: undefined,
    eip7702Revoke: { hash, expectedFinalNonce: '0x2' }
  })
  const unavailable = fixture(revoke, { ...canonical('0x1'), eth_getCode: 'not-code' })
  await expect(unavailable.reconciler.reconcile(revoke.id, 20)).resolves.toMatchObject({
    state: 'confirming',
    receipt: { status: '0x1' }
  })

  const responses = canonical('0x1')
  const { ledger } = fixture(revoke, responses)
  const rpc = jest.fn(async (_chainId: number, method: string, params: readonly unknown[] = []) => {
    if (method === 'eth_getCode') return '0x'
    if (method === 'eth_getBlockByNumber' && params[0] === '0x10') {
      return { number: '0x10', hash: `0x${'e'.repeat(64)}` }
    }
    return responses[`${method}:${String(params[0] ?? '')}`] ?? responses[method]
  })
  const reconciler = new OperationLifecycleReconciler(ledger, rpc)
  await expect(reconciler.reconcile(revoke.id, 20)).resolves.toMatchObject({ state: 'reorged' })
})
