import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'
import {
  MAX_OPERATION_LIFECYCLES,
  MAX_OPERATION_LIFECYCLE_AGE_MS
} from '../../../main/store/state/types/operationLifecycle'

const operation = (updatedAt = 10) => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'transaction' as const,
  account: `0x${'a'.repeat(40)}`,
  origin: 'app.example',
  chainId: 1,
  state: 'submitted' as const,
  createdAt: 10,
  updatedAt,
  expiresAt: 10 + MAX_OPERATION_LIFECYCLE_AGE_MS,
  visibleInActivity: true,
  notification: {},
  transaction: { hash: `0x${'b'.repeat(64)}`, nonce: '0x0' }
})

test('writes cloned valid lifecycle rows and preserves their identity', () => {
  let persisted: unknown = {}
  const save = jest.fn((value) => {
    persisted = value
  })
  const ledger = new OperationLifecycleLedger({ load: () => persisted, save })

  const input = operation(11)
  expect(ledger.put(input, 10)).toEqual(input)
  input.notification = { longPendingShownAt: 10 }
  expect(ledger.get(input.id, 10)?.notification).toEqual({})

  expect(() => ledger.put({ ...operation(12), origin: 'other.example' }, 12)).toThrow(
    'identity cannot change'
  )
  expect(() => ledger.put(operation(10), 10)).toThrow('cannot move backwards')
  expect(save).toHaveBeenCalledTimes(1)
})

test('drops invalid and expired loaded rows without exposing them', () => {
  const expired = { ...operation(), createdAt: 0, updatedAt: 0, expiresAt: 1 }
  let persisted: unknown = { [expired.id]: expired, malformed: { payload: 'secret' } }
  const save = jest.fn((value) => {
    persisted = value
  })
  const ledger = new OperationLifecycleLedger({ load: () => persisted, save })

  expect(ledger.list(2)).toEqual([])
  expect(persisted).toEqual({})
  expect(save).toHaveBeenCalledTimes(1)
})

test('fails closed when the durable ledger is at capacity', () => {
  const rows = Object.fromEntries(
    Array.from({ length: MAX_OPERATION_LIFECYCLES }, (_, index) => {
      const id = `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`
      return [id, { ...operation(), id }]
    })
  )
  const save = jest.fn()
  const ledger = new OperationLifecycleLedger({ load: () => rows, save })
  expect(() => ledger.put({ ...operation(), id: '00000000-0000-4000-8000-000000000999' }, 10)).toThrow(
    'limit reached'
  )
  expect(save).not.toHaveBeenCalled()
})

test('capacity eviction removes only the oldest handled terminal row', () => {
  const active = operation()
  const unhandled = {
    ...operation(),
    id: '00000000-0000-4000-8000-000000000002',
    state: 'confirmed' as const
  }
  const handled = {
    ...operation(),
    id: '00000000-0000-4000-8000-000000000003',
    state: 'failed' as const,
    notification: { terminalHandledAt: 10 }
  }
  let persisted = { [active.id]: active, [unhandled.id]: unhandled, [handled.id]: handled }
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })
  expect(ledger.evictOldestHandledTerminal(10)).toBe(true)
  expect(ledger.listStored().map(({ id }) => id)).toEqual([unhandled.id, active.id])
  expect(ledger.evictOldestHandledTerminal(10)).toBe(false)
})
