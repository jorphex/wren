import type {
  OperationLifecycle,
  OperationLifecycles
} from '../../../main/store/state/types/operationLifecycle'
import { MAX_OPERATION_LIFECYCLE_AGE_MS } from '../../../main/store/state/types/operationLifecycle'
import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'

const mocks = {
  recordActivity: jest.fn(),
  notify: jest.fn(() => true)
}

jest.mock('../../../main/store/action', () => ({
  requireStoreAction: () => mocks.recordActivity
}))
jest.mock('../../../main/notifications/transaction', () => ({
  notifyWalletActivity: (...args: unknown[]) => mocks.notify(...args)
}))

import {
  LONG_PENDING_NOTIFICATION_MS,
  OperationLifecycleProjection
} from '../../../main/operationLifecycle/projection'

const operation = (overrides: Partial<OperationLifecycle> = {}): OperationLifecycle => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'transaction',
  account: `0x${'a'.repeat(40)}`,
  origin: 'app.example',
  chainId: 1,
  state: 'submitted',
  createdAt: 10,
  updatedAt: 10,
  expiresAt: 10 + MAX_OPERATION_LIFECYCLE_AGE_MS,
  visibleInActivity: true,
  notification: {},
  transaction: { hash: `0x${'b'.repeat(64)}`, nonce: '0x1' },
  ...overrides
})

const fixture = (initial: OperationLifecycle) => {
  let persisted: OperationLifecycles = { [initial.id]: initial }
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })
  return { ledger, projection: new OperationLifecycleProjection(ledger), persisted: () => persisted }
}

beforeEach(() => {
  mocks.recordActivity.mockReset()
  mocks.notify.mockReset().mockReturnValue(true)
})

test('projects one stable privacy-only row for every lifecycle state', () => {
  const { projection } = fixture(operation({ state: 'reorged', updatedAt: 20 }))
  projection.project(operation().id, 20)

  expect(mocks.recordActivity).toHaveBeenCalledWith({
    id: operation().id,
    account: operation().account,
    origin: 'app.example',
    type: 'transaction',
    outcome: 'reorged',
    createdAt: 10,
    completedAt: 20,
    chainId: 1
  })
  expect(JSON.stringify(mocks.recordActivity.mock.calls)).not.toMatch(/hash|nonce|value|calldata/i)
  expect(mocks.notify).not.toHaveBeenCalled()
})

test('persists at most one long-pending notification across projection restarts', () => {
  const now = 10 + LONG_PENDING_NOTIFICATION_MS
  const { ledger, projection } = fixture(operation())
  projection.project(operation().id, now)
  new OperationLifecycleProjection(ledger).project(operation().id, now + 1)

  expect(mocks.notify).toHaveBeenCalledTimes(1)
  expect(mocks.notify).toHaveBeenCalledWith(operation().id, operation().account, 'long-pending')
  expect(ledger.listStored()[0]?.notification.longPendingShownAt).toBe(now)
  expect(ledger.listStored()[0]?.updatedAt).toBe(10)
})

test.each([
  ['confirmed', 'confirmed'],
  ['verified-clearance', 'confirmed'],
  ['failed', 'failed'],
  ['replaced', 'replaced']
] as const)('persists terminal handling and emits private %s notification once', (state, notice) => {
  const current = operation({ state, updatedAt: 20 })
  const { ledger, projection } = fixture(current)
  projection.project(current.id, 21)
  new OperationLifecycleProjection(ledger).project(current.id, 22)

  expect(mocks.notify).toHaveBeenCalledTimes(1)
  expect(mocks.notify).toHaveBeenCalledWith(current.id, current.account, notice)
  expect(ledger.listStored()[0]?.notification.terminalHandledAt).toBe(21)
  expect(ledger.listStored()[0]?.updatedAt).toBe(20)
})

test('records stopped expiry without notifying and removes handled expired metadata', () => {
  const current = operation({ state: 'stopped', createdAt: 0, updatedAt: 20, expiresAt: 20 })
  const { ledger, projection } = fixture(current)
  projection.project(current.id, 21)

  expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'stopped' }))
  expect(mocks.notify).not.toHaveBeenCalled()
  expect(ledger.listStored()).toEqual([])
})

test('records unverified EIP-7702 clearance without a misleading terminal notification', () => {
  const current = operation({
    kind: 'eip7702Revoke',
    transaction: undefined,
    eip7702Revoke: { hash: `0x${'b'.repeat(64)}`, expectedFinalNonce: '0x2' },
    state: 'clearance-unverified',
    createdAt: 0,
    updatedAt: 20,
    expiresAt: 20
  })
  const { ledger, projection } = fixture(current)
  projection.project(current.id, 21)

  expect(mocks.recordActivity).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'eip7702Revoke', outcome: 'clearance-unverified' })
  )
  expect(mocks.notify).not.toHaveBeenCalled()
  expect(ledger.listStored()).toEqual([])
})

test('periodic projection does not recreate cleared handled or unchanged pending history', () => {
  const handled = operation({
    state: 'confirmed',
    notification: { terminalHandledAt: 20 },
    updatedAt: 20
  })
  const terminal = fixture(handled)
  terminal.projection.projectAll(21)
  expect(mocks.recordActivity).not.toHaveBeenCalled()

  const pending = fixture(operation())
  pending.projection.projectAll(20)
  expect(mocks.recordActivity).not.toHaveBeenCalled()

  pending.projection.project(operation().id, 21)
  expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ id: operation().id }))
})
