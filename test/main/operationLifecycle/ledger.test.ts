import { OperationLifecycleLedger } from '../../../main/operationLifecycle/ledger'
import {
  MAX_OPERATION_LIFECYCLES,
  MAX_OPERATION_LIFECYCLE_AGE_MS
} from '../../../main/store/state/types/operationLifecycle'
import { WREN_DEPLOY_ORIGIN, WREN_INTERNAL_ORIGIN, originIdForName } from '../../../resources/domain/origin'

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

test('does not allow durable deployment evidence to change after admission', () => {
  let persisted: unknown = {}
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })
  const deployment = {
    version: 1 as const,
    inspectionId: 'a'.repeat(32),
    initcodeHash: `0x${'c'.repeat(64)}`,
    initcodeBytes: 12,
    value: '0x0'
  }
  const admitted = {
    ...operation(),
    origin: originIdForName(WREN_DEPLOY_ORIGIN),
    transaction: { ...operation().transaction, deployment }
  }
  ledger.put(admitted, 10)
  expect(() =>
    ledger.put(
      {
        ...admitted,
        updatedAt: 11,
        transaction: {
          ...admitted.transaction,
          deployment: { ...deployment, initcodeHash: `0x${'d'.repeat(64)}` }
        }
      },
      11
    )
  ).toThrow('transaction evidence cannot change')

  for (const transaction of [
    { ...admitted.transaction, hash: `0x${'d'.repeat(64)}` },
    { ...admitted.transaction, nonce: '0x1' },
    {
      ...admitted.transaction,
      replacementOf: '00000000-0000-4000-8000-000000000002'
    }
  ]) {
    expect(() => ledger.put({ ...admitted, updatedAt: 11, transaction }, 11)).toThrow(
      'transaction evidence cannot change'
    )
  }
})

test('accepts only exact managed speed-up lineage or internal cancellation', () => {
  let persisted: unknown = {}
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })
  const deployment = {
    version: 1 as const,
    inspectionId: 'a'.repeat(32),
    initcodeHash: `0x${'c'.repeat(64)}`,
    initcodeBytes: 12,
    value: '0x0'
  }
  const original = {
    ...operation(),
    origin: originIdForName(WREN_DEPLOY_ORIGIN),
    transaction: { ...operation().transaction, deployment }
  }
  ledger.put(original, 10)

  const speed = {
    ...operation(11),
    id: '00000000-0000-4000-8000-000000000002',
    origin: originIdForName(WREN_DEPLOY_ORIGIN),
    transaction: {
      hash: `0x${'d'.repeat(64)}`,
      nonce: original.transaction.nonce,
      replacementOf: original.id,
      deployment
    }
  }
  expect(ledger.put(speed, 11)).toMatchObject({ transaction: { deployment } })

  const cancel = {
    ...operation(12),
    id: '00000000-0000-4000-8000-000000000003',
    origin: originIdForName(WREN_INTERNAL_ORIGIN),
    transaction: {
      hash: `0x${'e'.repeat(64)}`,
      nonce: original.transaction.nonce,
      replacementOf: original.id
    }
  }
  expect(ledger.put(cancel, 12)).toMatchObject({ origin: originIdForName(WREN_INTERNAL_ORIGIN) })

  expect(() =>
    ledger.put(
      {
        ...speed,
        id: '00000000-0000-4000-8000-000000000004',
        transaction: {
          ...speed.transaction,
          hash: `0x${'f'.repeat(64)}`,
          deployment: { ...deployment, value: '0x1' }
        }
      },
      12
    )
  ).toThrow('deployment replacement evidence does not match')
  expect(() =>
    ledger.put(
      {
        ...cancel,
        id: '00000000-0000-4000-8000-000000000005',
        origin: 'foreign-origin',
        transaction: { ...cancel.transaction, hash: `0x${'9'.repeat(64)}` }
      },
      12
    )
  ).toThrow('requires exact evidence or internal cancellation')

  for (const [id, mismatch] of [
    ['00000000-0000-4000-8000-000000000006', { account: `0x${'b'.repeat(40)}` }],
    ['00000000-0000-4000-8000-000000000007', { chainId: 10 }],
    ['00000000-0000-4000-8000-000000000008', { transaction: { ...speed.transaction, nonce: '0x1' } }]
  ] as const) {
    expect(() =>
      ledger.put(
        {
          ...speed,
          id,
          ...mismatch,
          transaction: {
            ...speed.transaction,
            hash: `0x${id.slice(-1).repeat(64)}`,
            ...('transaction' in mismatch ? mismatch.transaction : {})
          }
        },
        12
      )
    ).toThrow('replacement identity does not match')
  }
})

test('sanitizes orphaned, divergent, and cyclic replacement graphs from stored reads', () => {
  const parent = operation()
  const orphan = {
    ...operation(11),
    id: '00000000-0000-4000-8000-000000000002',
    transaction: {
      hash: `0x${'c'.repeat(64)}`,
      nonce: '0x0',
      replacementOf: '00000000-0000-4000-8000-000000000099'
    }
  }
  const divergent = {
    ...operation(12),
    id: '00000000-0000-4000-8000-000000000003',
    chainId: 10,
    transaction: {
      hash: `0x${'d'.repeat(64)}`,
      nonce: '0x0',
      replacementOf: parent.id
    }
  }
  const cycleA = {
    ...operation(13),
    id: '00000000-0000-4000-8000-000000000004',
    transaction: {
      hash: `0x${'e'.repeat(64)}`,
      nonce: '0x0',
      replacementOf: '00000000-0000-4000-8000-000000000005'
    }
  }
  const cycleB = {
    ...operation(14),
    id: '00000000-0000-4000-8000-000000000005',
    transaction: {
      hash: `0x${'f'.repeat(64)}`,
      nonce: '0x0',
      replacementOf: cycleA.id
    }
  }
  let persisted: unknown = {
    [parent.id]: parent,
    [orphan.id]: orphan,
    [divergent.id]: divergent,
    [cycleA.id]: cycleA,
    [cycleB.id]: cycleB
  }
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })

  expect(ledger.listStored().map(({ id }) => id)).toEqual([parent.id])
  expect(persisted).toEqual({ [parent.id]: parent })
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

test('reserves pre-broadcast capacity without allowing another operation to consume it', () => {
  const rows = Object.fromEntries(
    Array.from({ length: MAX_OPERATION_LIFECYCLES - 1 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`
      return [id, { ...operation(), id }]
    })
  )
  let persisted = rows
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })
  const reservedId = '00000000-0000-4000-8000-000000000999'
  const competingId = '00000000-0000-4000-8000-000000000998'

  expect(ledger.reserve(reservedId, 10)).toBe(true)
  expect(() => ledger.put({ ...operation(), id: competingId }, 10)).toThrow('limit reached')
  expect(ledger.put({ ...operation(), id: reservedId }, 10)).toMatchObject({ id: reservedId })
  expect(ledger.releaseReservation(reservedId)).toBe(false)
})

test('releases an unused pre-broadcast reservation', () => {
  const ledger = new OperationLifecycleLedger({ load: () => ({}), save: jest.fn() })
  const id = operation().id
  expect(ledger.reserve(id, 10)).toBe(true)
  expect(ledger.releaseReservation(id)).toBe(true)
  expect(ledger.reserve(id, 10)).toBe(true)
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

test.each([
  ['ordinary replacement', 'app.example', undefined],
  ['managed speed-up', originIdForName(WREN_DEPLOY_ORIGIN), 'deployment'],
  ['internal cancellation', originIdForName(WREN_INTERNAL_ORIGIN), undefined]
] as const)('retains a referenced parent until its %s descendant is removed', (_label, origin, marker) => {
  const deployment = {
    version: 1 as const,
    inspectionId: 'a'.repeat(32),
    initcodeHash: `0x${'c'.repeat(64)}`,
    initcodeBytes: 12,
    value: '0x0'
  }
  const parent = {
    ...operation(),
    ...(marker || origin === originIdForName(WREN_INTERNAL_ORIGIN)
      ? { origin: originIdForName(WREN_DEPLOY_ORIGIN) }
      : {}),
    state: 'replaced' as const,
    notification: { terminalHandledAt: 10 },
    transaction: { ...operation().transaction, ...(marker ? { deployment } : {}) }
  }
  const child = {
    ...operation(11),
    id: '00000000-0000-4000-8000-000000000002',
    origin,
    state: 'confirmed' as const,
    transaction: {
      hash: `0x${'d'.repeat(64)}`,
      nonce: parent.transaction.nonce,
      replacementOf: parent.id,
      ...(marker ? { deployment } : {})
    }
  }
  let persisted = { [parent.id]: parent, [child.id]: child }
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })

  expect(ledger.remove(parent.id, 12)).toBe(false)
  expect(ledger.evictOldestHandledTerminal(12)).toBe(false)
  expect(ledger.listStored().map(({ id }) => id)).toEqual([child.id, parent.id])

  expect(ledger.remove(child.id, 12)).toBe(true)
  expect(ledger.evictOldestHandledTerminal(12)).toBe(true)
  expect(ledger.listStored()).toEqual([])
})

test.each([
  ['ordinary replacement', 'app.example', undefined],
  ['managed speed-up', originIdForName(WREN_DEPLOY_ORIGIN), 'deployment'],
  ['internal cancellation', originIdForName(WREN_INTERNAL_ORIGIN), undefined]
] as const)('retains an expired %s ancestor while its descendant is active', (_label, origin, marker) => {
  const deployment = {
    version: 1 as const,
    inspectionId: 'a'.repeat(32),
    initcodeHash: `0x${'c'.repeat(64)}`,
    initcodeBytes: 12,
    value: '0x0'
  }
  const parent = {
    ...operation(),
    ...(marker || origin === originIdForName(WREN_INTERNAL_ORIGIN)
      ? { origin: originIdForName(WREN_DEPLOY_ORIGIN) }
      : {}),
    state: 'replaced' as const,
    createdAt: 0,
    updatedAt: 5,
    expiresAt: 10,
    notification: { terminalHandledAt: 5 },
    transaction: { ...operation().transaction, ...(marker ? { deployment } : {}) }
  }
  const child = {
    ...operation(11),
    id: '00000000-0000-4000-8000-000000000002',
    origin,
    createdAt: 5,
    updatedAt: 11,
    expiresAt: 20,
    transaction: {
      hash: `0x${'d'.repeat(64)}`,
      nonce: parent.transaction.nonce,
      replacementOf: parent.id,
      ...(marker ? { deployment } : {})
    }
  }
  let persisted = { [parent.id]: parent, [child.id]: child }
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })

  expect(ledger.list(12).map(({ id }) => id)).toEqual([child.id, parent.id])
  expect(ledger.put({ ...child, updatedAt: 12 }, 12)).toMatchObject({ id: child.id })
  expect(ledger.evictOldestHandledTerminal(12)).toBe(false)
  expect(ledger.list(12).map(({ id }) => id)).toEqual([child.id, parent.id])

  expect(ledger.remove(child.id, 12)).toBe(true)
  expect(ledger.list(12)).toEqual([])
})

test('capacity eviction preserves terminal outcomes still under background monitoring', () => {
  const monitoring = {
    ...operation(),
    state: 'confirmed' as const,
    receipt: {
      transactionHash: `0x${'b'.repeat(64)}`,
      blockHash: `0x${'c'.repeat(64)}`,
      blockNumber: '0xa',
      status: '0x1' as const
    },
    settlement: { status: 'monitoring' as const },
    notification: { terminalHandledAt: 10 }
  }
  let persisted = { [monitoring.id]: monitoring }
  const ledger = new OperationLifecycleLedger({
    load: () => persisted,
    save: (value) => {
      persisted = value
    }
  })

  expect(ledger.evictOldestHandledTerminal(10)).toBe(false)
  expect(ledger.listStored()).toEqual([monitoring])
})
