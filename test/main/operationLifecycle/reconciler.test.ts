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
  'eth_getBlockByNumber:latest': { number: latest, hash: latestHash },
  [`eth_getBlockByNumber:${latest}`]: { number: latest, hash: latestHash }
})

test('ordinary transactions require 13 inclusive confirmations and canonical block evidence', async () => {
  const confirming = fixture(operation(), canonical('0x1', '0x10'))
  await expect(confirming.reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({
    state: 'confirming'
  })
  const confirmed = fixture(operation(), canonical('0x1', '0x11'))
  await expect(confirmed.reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({
    state: 'confirmed',
    receipt: { blockHash, status: '0x1' }
  })

  const noncanonical = fixture(operation(), {
    ...canonical('0x1', '0x11'),
    'eth_getBlockByNumber:0x5': { number: '0x5', hash: `0x${'e'.repeat(64)}` }
  })
  await expect(noncanonical.reconciler.reconcile(operation().id, 20)).resolves.toMatchObject({
    state: 'reorged'
  })
})

test('same-state confirmation polls preserve lifecycle timestamps while emitting live detail', async () => {
  const subject = fixture(operation(), canonical('0x1', '0x10'))
  const first = await subject.reconciler.reconcile(operation().id, 20)
  expect(first).toMatchObject({ state: 'confirming', updatedAt: 20 })

  const second = await subject.reconciler.reconcile(operation().id, 30)
  expect(second).toMatchObject({ state: 'confirming', updatedAt: 20 })
  expect(subject.ledger.get(operation().id, 30)?.updatedAt).toBe(20)
  expect(subject.observer).toHaveBeenLastCalledWith(
    expect.objectContaining({
      previous: expect.objectContaining({ updatedAt: 20 }),
      current: expect.objectContaining({ updatedAt: 20 }),
      confirmations: 12
    })
  )
})

test('receipt disappearance marks reorg then returns to submitted without fabricating failure', async () => {
  const withReceipt = operation({
    state: 'confirming',
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

test('RPC outages preserve the exact lifecycle state and evidence', async () => {
  const current = operation({ state: 'confirming' })
  const { reconciler, ledger, observer } = fixture(current, {
    [`eth_getTransactionReceipt:${hash}`]: new Error('offline')
  })
  await expect(reconciler.reconcile(current.id, 20)).resolves.toEqual(current)
  expect(ledger.get(current.id, 20)).toEqual(current)
  expect(observer).not.toHaveBeenCalled()
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
