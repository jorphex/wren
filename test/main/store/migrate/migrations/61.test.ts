import migration from '../../../../../main/store/migrate/migrations/61'
import { MAX_OPERATION_LIFECYCLE_AGE_MS } from '../../../../../main/store/state/types/operationLifecycle'
import { createState } from '../setup'

const account = `0x${'a'.repeat(40)}`
const hash = `0x${'b'.repeat(64)}`
const blockHash = `0x${'c'.repeat(64)}`

test('extracts only valid transaction and revocation evidence before discarding persisted requests', () => {
  const state = createState(60)
  state.main.accounts[account] = {
    activeRequestId: 'transaction',
    requests: {
      transaction: {
        activityId: '00000000-0000-4000-8000-000000000001',
        type: 'transaction',
        account,
        origin: 'app.example',
        created: 10,
        status: 'confirming',
        data: { chainId: '0x1', nonce: '0xa', calldata: 'must-not-survive' },
        payload: { params: ['must-not-survive'] },
        tx: {
          hash,
          receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1', logs: [] }
        }
      },
      revoke: {
        activityId: '00000000-0000-4000-8000-000000000002',
        type: 'eip7702Revoke',
        account,
        origin: 'wren',
        created: 20,
        status: 'verifying',
        chainId: '0xa',
        evidence: { latestNonce: '0xf', delegate: 'must-not-survive' },
        tx: { hash: `0x${'d'.repeat(64)}` }
      },
      malformed: {
        activityId: 'not-a-uuid',
        type: 'transaction',
        account,
        origin: 'app.example',
        created: 30,
        status: 'verifying',
        data: { chainId: '0x1', nonce: '0x0' },
        tx: { hash }
      }
    }
  }

  const migrated = migration.migrate(state) as typeof state & {
    main: { operationLifecycles: Record<string, Record<string, unknown>> }
  }
  expect(migrated.main.accounts[account]).toHaveProperty('requests', {})
  expect(migrated.main.accounts[account]).not.toHaveProperty('activeRequestId')
  expect(Object.keys(migrated.main.operationLifecycles)).toEqual([
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001'
  ])
  expect(migrated.main.operationLifecycles['00000000-0000-4000-8000-000000000001']).toMatchObject({
    kind: 'transaction',
    account,
    chainId: 1,
    state: 'confirming',
    createdAt: 10,
    expiresAt: 10 + MAX_OPERATION_LIFECYCLE_AGE_MS,
    transaction: { hash, nonce: '0xa' },
    receipt: { transactionHash: hash, blockHash, blockNumber: '0x5', status: '0x1' }
  })
  expect(migrated.main.operationLifecycles['00000000-0000-4000-8000-000000000002']).toMatchObject({
    kind: 'eip7702Revoke',
    chainId: 10,
    state: 'submitted',
    eip7702Revoke: { hash: `0x${'d'.repeat(64)}`, expectedFinalNonce: '0x11' }
  })
  expect(JSON.stringify(migrated.main.operationLifecycles)).not.toMatch(
    /must-not-survive|payload|calldata|logs|delegate/
  )
})

test('discards unproven request evidence and preserves malformed input for framework rejection', () => {
  const state = createState(60)
  state.main.accounts[account] = {
    requests: {
      unsigned: {
        activityId: '00000000-0000-4000-8000-000000000003',
        type: 'transaction',
        account,
        origin: 'app.example',
        created: 10,
        status: 'pending',
        data: { chainId: '0x1', nonce: '0x0' }
      }
    }
  }
  const migrated = migration.migrate(state) as typeof state & {
    main: { operationLifecycles: Record<string, unknown> }
  }
  expect(migrated.main.operationLifecycles).toEqual({})
  expect(migrated.main.accounts[account]).toHaveProperty('requests', {})
  expect(migration.migrate(null)).toBeNull()
})

test('deduplicates lifecycle ids and keeps only the newest 500 valid rows deterministically', () => {
  const state = createState(60)
  const requests = Object.fromEntries(
    Array.from({ length: 502 }, (_, index) => {
      const sequence = index + 1
      return [
        `request-${sequence.toString().padStart(3, '0')}`,
        {
          activityId: `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
          type: 'transaction',
          account,
          origin: 'app.example',
          created: sequence,
          status: 'verifying',
          data: { chainId: '0x1', nonce: `0x${sequence.toString(16)}` },
          tx: { hash }
        }
      ]
    })
  )
  requests['request-duplicate'] = {
    ...requests['request-502'],
    activityId: '00000000-0000-4000-8000-000000000500',
    created: 999
  }
  state.main.accounts[account] = { requests }

  const first = migration.migrate(state) as typeof state & {
    main: { operationLifecycles: Record<string, { createdAt: number }> }
  }
  const second = migration.migrate(state) as typeof first
  expect(first.main.operationLifecycles).toEqual(second.main.operationLifecycles)
  expect(Object.keys(first.main.operationLifecycles)).toHaveLength(500)
  expect(first.main.operationLifecycles['00000000-0000-4000-8000-000000000001']).toBeUndefined()
  expect(first.main.operationLifecycles['00000000-0000-4000-8000-000000000502']).toBeDefined()
  expect(first.main.operationLifecycles['00000000-0000-4000-8000-000000000500']?.createdAt).toBe(500)
})
