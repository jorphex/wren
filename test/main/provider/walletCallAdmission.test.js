import { WalletCallBatchLedger } from '../../../main/provider/walletCallBatches'
import { admitWalletCallBatch } from '../../../main/provider/walletCallAdmission'

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'

function memoryStorage() {
  let batches = {}
  return {
    load: jest.fn(() => JSON.parse(JSON.stringify(batches))),
    save: jest.fn((value) => {
      batches = JSON.parse(JSON.stringify(value))
    }),
    value: () => JSON.parse(JSON.stringify(batches))
  }
}

function payload(overrides = {}) {
  return {
    id: 7,
    jsonrpc: '2.0',
    method: 'wallet_sendCalls',
    params: [
      {
        version: '2.0.0',
        chainId: '0xa',
        atomicRequired: false,
        calls: [
          {
            to: target.toUpperCase().replace('0X', '0x'),
            data: '0xABCD',
            capabilities: { futureFeature: { optional: true, ignored: 'value' } }
          }
        ],
        ...overrides
      }
    ]
  }
}

function input(overrides = {}) {
  return {
    handlerId: 'handler-id',
    origin: 'example.test',
    account: account.toUpperCase().replace('0X', '0x'),
    payload: payload(),
    ...overrides
  }
}

function dependencies() {
  const storage = memoryStorage()
  const ledger = new WalletCallBatchLedger(storage)
  const requests = []
  return {
    storage,
    ledger,
    requests,
    deps: {
      ledger,
      addRequest: jest.fn((request) => requests.push(request))
    }
  }
}

it('atomically persists a generated batch and canonical review request', () => {
  const { ledger, requests, deps } = dependencies()

  const admitted = admitWalletCallBatch(input(), deps)

  expect(admitted).toMatchObject({
    handlerId: 'handler-id',
    origin: 'example.test',
    account,
    chainId: '0xa'
  })
  expect(admitted.id).toMatch(/^0x[0-9a-f]{64}$/)
  expect(Object.isFrozen(admitted)).toBe(true)
  expect(ledger.getStatus('example.test', account, admitted.id).status).toBe(100)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({
    type: 'walletCalls',
    handlerId: 'handler-id',
    account,
    origin: 'example.test',
    activityId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    ),
    batchId: admitted.id,
    chainId: '0xa',
    calls: [{ to: target, data: '0xabcd', value: '0x0' }],
    preparation: { status: 'pending' },
    simulation: { status: 'pending', calls: [] },
    payload: {
      id: 7,
      jsonrpc: '2.0',
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          from: account,
          chainId: '0xa',
          atomicRequired: false,
          calls: [{ to: target, data: '0xabcd', value: '0x0' }]
        }
      ]
    }
  })
})

it('preserves a supplied public id and rejects a scoped duplicate before request creation', () => {
  const { deps } = dependencies()
  const source = input({ payload: payload({ id: 'app-batch', from: account }) })

  expect(admitWalletCallBatch(source, deps).id).toBe('app-batch')
  expect(() => admitWalletCallBatch({ ...source, handlerId: 'second-handler' }, deps)).toThrow(
    expect.objectContaining({ code: 5720 })
  )
  expect(deps.addRequest).toHaveBeenCalledTimes(1)
})

it('rejects a sender mismatch before persistence', () => {
  const { storage, deps } = dependencies()
  const source = input({
    payload: payload({ from: '0x3333333333333333333333333333333333333333' })
  })

  expect(() => admitWalletCallBatch(source, deps)).toThrow(expect.objectContaining({ code: 4100 }))
  expect(storage.value()).toEqual({})
  expect(deps.addRequest).not.toHaveBeenCalled()
})

it('does not create a request when ledger persistence fails', () => {
  const { deps } = dependencies()
  deps.ledger.create = jest.fn(() => {
    throw new Error('wallet-call persistence unavailable')
  })

  expect(() => admitWalletCallBatch(input(), deps)).toThrow(/persistence unavailable/)
  expect(deps.addRequest).not.toHaveBeenCalled()
})

it('enforces retained-batch capacity before request creation', () => {
  const { ledger, deps } = dependencies()
  for (let index = 0; index < 64; index += 1) {
    const created = ledger.create({
      id: `retained-${index}`,
      origin: 'example.test',
      account,
      chainId: '0xa',
      callCount: 1
    })
    created.commit()
  }

  expect(() => admitWalletCallBatch(input(), deps)).toThrow(expect.objectContaining({ code: 5740 }))
  expect(deps.addRequest).not.toHaveBeenCalled()
})

it.each([
  [
    'throws',
    () => {
      throw new Error('request store unavailable')
    },
    /request store unavailable/
  ],
  ['returns false', () => false, /not admitted/]
])('rolls back the new batch when request admission %s', (_label, addRequest, message) => {
  const { storage, deps } = dependencies()
  deps.addRequest.mockImplementation(addRequest)

  expect(() => admitWalletCallBatch(input(), deps)).toThrow(message)
  expect(storage.value()).toEqual({})
})

it('reports both admission and rollback failures without masking persistence risk', () => {
  const batch = {
    id: 'batch-id',
    operationId: '00000000-0000-4000-8000-000000000001',
    origin: 'example.test',
    account,
    chainId: '0xa',
    atomic: false,
    callCount: 1,
    execution: 'pending',
    transactions: [],
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 86_400_001
  }
  const deps = {
    ledger: {
      create: () => ({
        batch,
        commit: jest.fn(),
        rollback: () => {
          throw new Error('persistence offline')
        }
      })
    },
    addRequest: () => {
      throw new Error('request rejected')
    }
  }

  expect(() => admitWalletCallBatch(input(), deps)).toThrow(
    /admission failed: request rejected; rollback failed: persistence offline/
  )
})

it('rolls back mismatched ledger metadata before creating a request', () => {
  const { deps } = dependencies()
  const rollback = jest.fn()
  deps.ledger.create = jest.fn(() => ({
    batch: {
      id: 'batch-id',
      origin: 'redirected.test',
      account,
      chainId: '0xa',
      atomic: false,
      callCount: 1,
      execution: 'pending',
      transactions: [],
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 86_400_001
    },
    commit: jest.fn(),
    rollback
  }))

  expect(() => admitWalletCallBatch(input(), deps)).toThrow(/mismatched batch metadata/)
  expect(rollback).toHaveBeenCalledTimes(1)
  expect(deps.addRequest).not.toHaveBeenCalled()
})

it('uses snapshotted dependencies and parsed values despite caller mutation', () => {
  const source = input()
  const { requests, deps } = dependencies()
  const originalAddRequest = deps.addRequest
  const originalCreate = deps.ledger.create.bind(deps.ledger)
  deps.ledger.create = jest.fn((metadata) => {
    source.account = '0x3333333333333333333333333333333333333333'
    source.payload.params[0].calls[0].data = '0xffff'
    deps.addRequest = jest.fn(() => {
      throw new Error('redirected request store')
    })
    return originalCreate(metadata)
  })

  const admitted = admitWalletCallBatch(source, deps)

  expect(admitted.account).toBe(account)
  expect(requests[0].calls[0].data).toBe('0xabcd')
  expect(originalAddRequest).toHaveBeenCalledTimes(1)
})
