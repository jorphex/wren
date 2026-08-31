import { ACTIVITY_RETENTION_MS } from '../../../../../main/store/state/types/activity'
import migration from '../../../../../main/store/migrate/migrations/76'

const now = 1_800_000_000_000
const activityId = '11111111-1111-4111-8111-111111111111'
const batchId = '22222222-2222-4222-8222-222222222222'
const account = `0x${'1'.repeat(40)}`
const hash = (value: string) => `0x${value.repeat(64)}`

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now))
afterEach(() => jest.restoreAllMocks())

const activity = (id: string, type: 'transaction' | 'walletCalls', completedAt: number) => ({
  id,
  account,
  origin: 'app.example',
  type,
  outcome: 'confirmed',
  chainId: 1,
  createdAt: completedAt - 100,
  completedAt
})

it('backfills compact references from matching retained transaction and Wallet Calls evidence', () => {
  const completedAt = now - 1_000
  const migrated = migration.migrate({
    main: {
      activity: [
        activity(activityId, 'transaction', completedAt),
        activity(batchId, 'walletCalls', completedAt)
      ],
      operationLifecycles: {
        [activityId]: {
          id: activityId,
          kind: 'transaction',
          account,
          origin: 'app.example',
          chainId: 1,
          state: 'confirmed',
          createdAt: completedAt - 100,
          updatedAt: completedAt,
          expiresAt: completedAt + 100_000,
          visibleInActivity: true,
          notification: {},
          transaction: { hash: hash('a'), nonce: '0x1' },
          receipt: {
            transactionHash: hash('a'),
            blockHash: hash('b'),
            blockNumber: '0x10',
            status: '0x1'
          }
        },
        [batchId]: {
          id: batchId,
          kind: 'walletCalls',
          account,
          origin: 'app.example',
          chainId: 1,
          state: 'confirmed',
          createdAt: completedAt - 100,
          updatedAt: completedAt,
          expiresAt: completedAt + 100_000,
          visibleInActivity: true,
          notification: {},
          walletCalls: { batchOperationId: batchId }
        }
      },
      walletCallBatches: {
        [hash('f')]: {
          id: hash('e'),
          operationId: batchId,
          origin: 'app.example',
          account,
          chainId: '0x1',
          atomic: false,
          callCount: 2,
          execution: 'failed',
          transactions: [
            { hash: hash('c'), state: 'submitted' },
            { hash: hash('d'), state: 'signed' }
          ],
          createdAt: completedAt - 100,
          updatedAt: completedAt,
          expiresAt: completedAt - 100 + 24 * 60 * 60 * 1000
        }
      }
    }
  }) as {
    main: { activityTransactionReferences: Record<string, Record<string, unknown>> }
  }

  expect(migrated.main.activityTransactionReferences[activityId]).toMatchObject({
    kind: 'transaction',
    expiresAt: completedAt + ACTIVITY_RETENTION_MS,
    transactions: [{ hash: hash('a'), canonicalBlock: { hash: hash('b'), number: '0x10' } }]
  })
  expect(migrated.main.activityTransactionReferences[batchId]).toMatchObject({
    kind: 'walletCalls',
    transactions: [{ hash: hash('c') }]
  })
})

it('does not invent references for mismatched or expired Activity evidence', () => {
  const completedAt = now - ACTIVITY_RETENTION_MS - 1
  const migrated = migration.migrate({
    main: {
      activity: [activity(activityId, 'transaction', completedAt)],
      operationLifecycles: {},
      walletCallBatches: {},
      activityTransactionReferences: { malformed: true }
    }
  }) as { main: { activityTransactionReferences: Record<string, unknown> } }

  expect(migrated.main.activityTransactionReferences).toEqual({})
})
