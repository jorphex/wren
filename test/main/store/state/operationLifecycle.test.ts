import {
  MAX_OPERATION_LIFECYCLES,
  MAX_OPERATION_LIFECYCLE_AGE_MS,
  OperationLifecycleSchema,
  pruneOperationLifecycles
} from '../../../../main/store/state/types/operationLifecycle'

const id = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
const transaction = (index = 1) => ({
  id: id(index),
  kind: 'transaction' as const,
  account: `0x${'a'.repeat(40)}`,
  origin: 'app.example',
  chainId: 1,
  state: 'submitted' as const,
  createdAt: index,
  updatedAt: index,
  expiresAt: index + MAX_OPERATION_LIFECYCLE_AGE_MS,
  visibleInActivity: true,
  notification: {},
  transaction: { hash: `0x${'b'.repeat(64)}`, nonce: '0x0' }
})

test('accepts only bounded payload-free operation metadata', () => {
  expect(OperationLifecycleSchema.parse(transaction())).toEqual(transaction())
  expect(() =>
    OperationLifecycleSchema.parse({ ...transaction(), payload: { params: ['private calldata'] } })
  ).toThrow()
  expect(() =>
    OperationLifecycleSchema.parse({
      ...transaction(),
      kind: 'walletCalls',
      walletCalls: { batchOperationId: id(2) }
    })
  ).toThrow()
  expect(() =>
    OperationLifecycleSchema.parse({
      ...transaction(),
      expiresAt: transaction().createdAt + MAX_OPERATION_LIFECYCLE_AGE_MS + 1
    })
  ).toThrow()
})

test('requires receipt evidence to match its operation transaction', () => {
  const receipt = {
    transactionHash: transaction().transaction.hash,
    blockHash: `0x${'c'.repeat(64)}`,
    blockNumber: '0xa',
    status: '0x1' as const
  }
  expect(OperationLifecycleSchema.parse({ ...transaction(), receipt }).receipt).toEqual(receipt)
  expect(() =>
    OperationLifecycleSchema.parse({
      ...transaction(),
      receipt: { ...receipt, transactionHash: `0x${'d'.repeat(64)}` }
    })
  ).toThrow()
})

test('accepts only bounded background settlement metadata on ordinary terminal outcomes', () => {
  const receipt = {
    transactionHash: transaction().transaction.hash,
    blockHash: `0x${'c'.repeat(64)}`,
    blockNumber: '0xa',
    status: '0x1' as const
  }
  expect(
    OperationLifecycleSchema.parse({
      ...transaction(),
      state: 'confirmed',
      receipt,
      settlement: { status: 'monitoring' }
    }).settlement
  ).toEqual({ status: 'monitoring' })
  expect(
    OperationLifecycleSchema.parse({
      ...transaction(),
      state: 'failed',
      receipt: { ...receipt, status: '0x0' },
      settlement: { status: 'complete', basis: 'finalized' }
    }).settlement
  ).toEqual({ status: 'complete', basis: 'finalized' })
  expect(() =>
    OperationLifecycleSchema.parse({
      ...transaction(),
      receipt,
      settlement: { status: 'monitoring' }
    })
  ).toThrow()
  expect(() =>
    OperationLifecycleSchema.parse({
      ...transaction(),
      state: 'confirmed',
      settlement: { status: 'monitoring' }
    })
  ).toThrow()
  expect(() =>
    OperationLifecycleSchema.parse({
      ...transaction(),
      kind: 'eip7702Revoke',
      transaction: undefined,
      eip7702Revoke: { hash: transaction().transaction.hash, expectedFinalNonce: '0x1' },
      state: 'failed',
      settlement: { status: 'monitoring' }
    })
  ).toThrow()
})

test('prunes malformed, expired, mismatched, and excess lifecycle rows deterministically', () => {
  const operations = Object.fromEntries(
    Array.from({ length: MAX_OPERATION_LIFECYCLES + 2 }, (_, offset) => {
      const operation = transaction(offset + 1)
      return [operation.id, operation]
    })
  )
  operations['not-a-uuid'] = transaction(900)
  const expired = transaction(901)
  operations[expired.id] = { ...expired, createdAt: 0, updatedAt: 0, expiresAt: 1 }

  const pruned = pruneOperationLifecycles(operations, 2)
  expect(Object.keys(pruned)).toHaveLength(MAX_OPERATION_LIFECYCLES)
  expect(pruned[id(MAX_OPERATION_LIFECYCLES + 2)]).toBeDefined()
  expect(pruned[id(1)]).toBeUndefined()
  expect(pruned['not-a-uuid']).toBeUndefined()
  expect(pruned[expired.id]).toBeUndefined()
})
