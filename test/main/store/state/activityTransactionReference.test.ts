import { ACTIVITY_RETENTION_MS } from '../../../../main/store/state/types/activity'
import {
  MAX_ACTIVITY_TRANSACTION_REFERENCES,
  activityTransactionReferenceForOperation,
  pruneActivityTransactionReferences,
  recordActivityTransactionReference
} from '../../../../main/store/state/types/activityTransactionReference'
import type { OperationLifecycle } from '../../../../main/store/state/types/operationLifecycle'
import type { WalletCallBatch } from '../../../../main/store/state/types/walletCallBatch'

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`
const hash = (value: string) => `0x${value.repeat(64)}`
const account = `0x${'1'.repeat(40)}`

const operation = (overrides: Partial<OperationLifecycle> = {}): OperationLifecycle => ({
  id: id(1),
  kind: 'transaction',
  account,
  origin: 'app.example',
  chainId: 1,
  state: 'confirmed',
  createdAt: 100,
  updatedAt: 200,
  expiresAt: 300,
  visibleInActivity: true,
  notification: {},
  transaction: { hash: hash('a'), nonce: '0x1' },
  receipt: {
    transactionHash: hash('a'),
    blockHash: hash('b'),
    blockNumber: '0x10',
    status: '0x1'
  },
  ...overrides
})

it('projects only the compact canonical evidence needed for an on-demand transaction lookup', () => {
  expect(activityTransactionReferenceForOperation(operation())).toEqual({
    id: id(1),
    kind: 'transaction',
    account,
    origin: 'app.example',
    chainId: 1,
    updatedAt: 200,
    expiresAt: 200 + ACTIVITY_RETENTION_MS,
    transactions: [
      {
        hash: hash('a'),
        canonicalBlock: { hash: hash('b'), number: '0x10' }
      }
    ]
  })
})

it('projects EIP-7702 revocation hashes without retaining revocation-specific metadata', () => {
  const reference = activityTransactionReferenceForOperation(
    operation({
      kind: 'eip7702Revoke',
      transaction: undefined,
      eip7702Revoke: { hash: hash('c'), expectedFinalNonce: '0x2' },
      receipt: {
        transactionHash: hash('c'),
        blockHash: hash('d'),
        blockNumber: '0x11',
        status: '0x1'
      }
    })
  )

  expect(reference).toMatchObject({
    kind: 'eip7702Revoke',
    transactions: [
      {
        hash: hash('c'),
        canonicalBlock: { hash: hash('d'), number: '0x11' }
      }
    ]
  })
  expect(JSON.stringify(reference)).not.toMatch(/expectedFinalNonce|nonce/u)
})

it('projects submitted Wallet Calls hashes while omitting signed reservations and receipt contents', () => {
  const batchOperationId = id(2)
  const walletOperation = operation({
    id: batchOperationId,
    kind: 'walletCalls',
    transaction: undefined,
    receipt: undefined,
    walletCalls: { batchOperationId }
  })
  const batch = {
    id: hash('f'),
    operationId: batchOperationId,
    origin: 'app.example',
    account,
    chainId: '0x1',
    atomic: false,
    callCount: 2,
    execution: 'failed',
    transactions: [
      {
        hash: hash('c'),
        state: 'submitted',
        receipt: {
          logs: [{ address: account, data: '0xdeadbeef', topics: [hash('d')] }],
          status: '0x1',
          blockHash: hash('e'),
          blockNumber: '0x20',
          gasUsed: '0x5208',
          transactionHash: hash('c')
        }
      },
      { hash: hash('9'), state: 'signed' }
    ],
    createdAt: 100,
    updatedAt: 250,
    expiresAt: 300
  } as WalletCallBatch

  const reference = activityTransactionReferenceForOperation(walletOperation, { [batch.id]: batch })
  expect(reference?.transactions).toEqual([
    {
      hash: hash('c'),
      canonicalBlock: { hash: hash('e'), number: '0x20' }
    }
  ])
  expect(JSON.stringify(reference)).not.toMatch(/deadbeef|topics|gasUsed|status/u)
})

it('retains references for 90 days, caps them with the newest entries, and drops invalid data', () => {
  const now = 1_000_000
  const references = Object.fromEntries(
    Array.from({ length: MAX_ACTIVITY_TRANSACTION_REFERENCES + 2 }, (_, index) => {
      const updatedAt = now - index
      return [
        id(index + 1),
        {
          id: id(index + 1),
          kind: 'transaction',
          account,
          origin: 'app.example',
          chainId: 1,
          updatedAt,
          expiresAt: updatedAt + ACTIVITY_RETENTION_MS,
          transactions: [{ hash: `0x${(index + 1).toString(16).padStart(64, '0')}` }]
        }
      ]
    })
  )
  references[id(1_000)] = { invalid: true }

  const pruned = pruneActivityTransactionReferences(references, now)
  expect(Object.keys(pruned)).toHaveLength(MAX_ACTIVITY_TRANSACTION_REFERENCES)
  expect(pruned[id(1)]).toBeDefined()
  expect(pruned[id(MAX_ACTIVITY_TRANSACTION_REFERENCES + 2)]).toBeUndefined()
  expect(pruned[id(1_000)]).toBeUndefined()
})

it('matches the Activity row boundary at exactly 90 days', () => {
  const reference = activityTransactionReferenceForOperation(operation({ createdAt: 0, updatedAt: 0 }))
  const references = { [id(1)]: reference }

  expect(pruneActivityTransactionReferences(references, ACTIVITY_RETENTION_MS)[id(1)]).toBeDefined()
  expect(pruneActivityTransactionReferences(references, ACTIVITY_RETENTION_MS + 1)).toEqual({})
})

it('allows canonical receipt refreshes but rejects an identity or hash rewrite', () => {
  const initial = activityTransactionReferenceForOperation(operation())
  const references = recordActivityTransactionReference({}, initial, 200)
  const refreshed = {
    ...initial,
    updatedAt: 201,
    expiresAt: 201 + ACTIVITY_RETENTION_MS,
    transactions: [{ hash: hash('a'), canonicalBlock: { hash: hash('c'), number: '0x11' } }]
  }
  expect(recordActivityTransactionReference(references, refreshed, 201)[id(1)]).toEqual(refreshed)
  expect(() =>
    recordActivityTransactionReference(references, { ...refreshed, transactions: [{ hash: hash('d') }] }, 201)
  ).toThrow(/identity/u)
})
