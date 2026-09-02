import { Interface } from 'ethers'

import {
  createActivityDetailsService,
  projectActivityReceiptEffects,
  projectActivityTransaction
} from '../../../main/activity/details'
import type { ActivityEntry } from '../../../main/store/state/types/activity'
import type { OperationLifecycle } from '../../../main/store/state/types/operationLifecycle'
import type { WalletCallBatch } from '../../../main/store/state/types/walletCallBatch'

const activityId = '11111111-1111-4111-8111-111111111111'
const batchOperationId = '22222222-2222-4222-8222-222222222222'
const account = `0x${'1'.repeat(40)}`
const recipient = `0x${'2'.repeat(40)}`
const token = `0x${'3'.repeat(40)}`
const hash = (character: string) => `0x${character.repeat(64)}`
const blockHash = hash('b')

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: activityId,
  account,
  origin: 'origin',
  type: 'transaction',
  outcome: 'confirmed',
  chainId: 1,
  createdAt: 100,
  completedAt: 200,
  ...overrides
})

const operation = (overrides: Partial<OperationLifecycle> = {}): OperationLifecycle => ({
  id: activityId,
  kind: 'transaction',
  account,
  origin: 'origin',
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
    blockHash,
    blockNumber: '0x10',
    status: '0x1'
  },
  ...overrides
})

const rpcTransaction = (overrides: Record<string, unknown> = {}) => ({
  hash: hash('a'),
  from: account,
  to: recipient,
  value: '0xde0b6b3a7640000',
  input: '0x',
  blockHash,
  blockNumber: '0x10',
  ...overrides
})

it('projects a canonical native value transfer without returning raw transaction input', () => {
  const action = projectActivityTransaction(rpcTransaction(), {
    hash: hash('a'),
    account,
    receipt: { blockHash, blockNumber: '0x10' }
  })

  expect(action).toEqual({
    transactionHash: hash('a'),
    kind: 'native-value-transfer',
    from: account,
    to: recipient,
    value: '1000000000000000000',
    inputBytes: 0,
    arguments: []
  })
  expect(action).not.toHaveProperty('input')
  expect(action).not.toHaveProperty('calldata')
})

it('decodes bounded standard call arguments but omits opaque byte arguments', () => {
  const iface = new Interface([
    'function safeTransferFrom(address from,address to,uint256 tokenId,bytes data)'
  ])
  const input = iface.encodeFunctionData('safeTransferFrom', [account, recipient, 42n, '0xdeadbeef'])
  const action = projectActivityTransaction(rpcTransaction({ to: token, value: '0x0', input }), {
    hash: hash('a'),
    account,
    receipt: { blockHash, blockNumber: '0x10' }
  })

  expect(action).toMatchObject({
    kind: 'contract-call',
    to: token,
    selector: input.slice(0, 10),
    method: 'safeTransferFrom',
    signature: 'safeTransferFrom(address,address,uint256,bytes)',
    argumentsTruncated: true,
    arguments: [
      { name: 'from', type: 'address', value: account },
      { name: 'to', type: 'address', value: recipient },
      { name: 'tokenId', type: 'uint256', value: '42' }
    ]
  })
  expect(JSON.stringify(action)).not.toContain('deadbeef')
})

it('shows an unknown contract selector without returning calldata', () => {
  const action = projectActivityTransaction(rpcTransaction({ value: '0x0', input: '0x12345678abcd' }), {
    hash: hash('a'),
    account
  })

  expect(action).toMatchObject({
    kind: 'contract-call',
    selector: '0x12345678',
    inputBytes: 6,
    arguments: []
  })
  expect(action).not.toHaveProperty('input')
})

it('projects bounded account-relevant token changes from the canonical receipt', () => {
  const iface = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)'])
  const zero = `0x${'0'.repeat(40)}`
  const burned = iface.encodeEventLog(iface.getEvent('Transfer')!, [account, zero, 7n])
  const received = iface.encodeEventLog(iface.getEvent('Transfer')!, [recipient, account, 5n])
  const unrelated = iface.encodeEventLog(iface.getEvent('Transfer')!, [recipient, token, 3n])

  expect(
    projectActivityReceiptEffects(
      {
        transactionHash: hash('a'),
        blockHash,
        blockNumber: '0x10',
        logs: [
          { address: token, topics: burned.topics, data: burned.data },
          { address: recipient, topics: received.topics, data: received.data },
          { address: token, topics: unrelated.topics, data: unrelated.data }
        ]
      },
      { hash: hash('a'), account, receipt: { blockHash, blockNumber: '0x10' } }
    )
  ).toMatchObject({
    assetChanges: [
      { type: 'transfer', standard: 'erc20', token, from: account, to: zero, amount: '7' },
      { type: 'transfer', standard: 'erc20', token: recipient, from: recipient, to: account, amount: '5' }
    ]
  })
})

it('attaches receipt-derived asset changes to confirmed Activity actions', async () => {
  const iface = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)'])
  const encoded = iface.encodeEventLog(iface.getEvent('Transfer')!, [recipient, account, 5n])
  const rpc = jest.fn(async (_chainId, method) =>
    method === 'eth_getTransactionByHash'
      ? rpcTransaction({ value: '0x0', input: '0x12345678' })
      : {
          transactionHash: hash('a'),
          blockHash,
          blockNumber: '0x10',
          logs: [{ address: token, topics: encoded.topics, data: encoded.data }]
        }
  )
  const service = createActivityDetailsService({
    activity: () => [entry()],
    references: () => ({}),
    operations: () => ({ [activityId]: operation() }),
    batches: () => ({}),
    rpc
  })

  await expect(service.get(activityId)).resolves.toMatchObject({
    success: true,
    actions: [
      {
        assetChanges: [
          { type: 'transfer', standard: 'erc20', token, from: recipient, to: account, amount: '5' }
        ]
      }
    ]
  })
  expect(rpc).toHaveBeenCalledWith(1, 'eth_getTransactionReceipt', [hash('a')])
})

it.each([
  ['hash', { hash: hash('f') }],
  ['account', { from: recipient }],
  ['block', { blockHash: hash('c') }]
])('rejects transaction evidence with a mismatched %s', (_label, overrides) => {
  expect(() =>
    projectActivityTransaction(rpcTransaction(overrides), {
      hash: hash('a'),
      account,
      receipt: { blockHash, blockNumber: '0x10' }
    })
  ).toThrow(/retained|canonical/u)
})

it('resolves hashes only from the retained operation and projects the action on demand', async () => {
  const rpc = jest.fn().mockResolvedValue(rpcTransaction())
  const service = createActivityDetailsService({
    activity: () => [entry()],
    references: () => ({}),
    operations: () => ({ [activityId]: operation() }),
    batches: () => ({}),
    rpc
  })

  await expect(service.get(activityId)).resolves.toMatchObject({
    success: true,
    partial: false,
    actions: [{ kind: 'native-value-transfer', value: '1000000000000000000' }]
  })
  expect(rpc).toHaveBeenCalledWith(1, 'eth_getTransactionByHash', [hash('a')])
})

it('resolves a compact Activity reference after the operation lifecycle expires', async () => {
  const rpc = jest.fn().mockResolvedValue(rpcTransaction())
  const service = createActivityDetailsService({
    activity: () => [entry()],
    references: () => ({
      [activityId]: {
        id: activityId,
        kind: 'transaction',
        account,
        origin: 'origin',
        chainId: 1,
        updatedAt: 200,
        expiresAt: 201,
        transactions: [
          {
            hash: hash('a'),
            canonicalBlock: { hash: blockHash, number: '0x10' }
          }
        ]
      }
    }),
    operations: () => ({}),
    batches: () => ({}),
    rpc,
    now: () => 200
  })

  await expect(service.get(activityId)).resolves.toMatchObject({
    success: true,
    partial: false,
    actions: [{ transactionHash: hash('a'), kind: 'native-value-transfer' }]
  })
  expect(rpc).toHaveBeenCalledWith(1, 'eth_getTransactionByHash', [hash('a')])
})

it('does not use a compact Activity reference after its retention window expires', async () => {
  const rpc = jest.fn()
  const service = createActivityDetailsService({
    activity: () => [entry()],
    references: () => ({
      [activityId]: {
        id: activityId,
        kind: 'transaction',
        account,
        origin: 'origin',
        chainId: 1,
        updatedAt: 200,
        expiresAt: 201,
        transactions: [{ hash: hash('a') }]
      }
    }),
    operations: () => ({}),
    batches: () => ({}),
    rpc,
    now: () => 202
  })

  await expect(service.get(activityId)).resolves.toEqual({
    success: false,
    error: 'evidence-unavailable'
  })
  expect(rpc).not.toHaveBeenCalled()
})

it('returns a partial Wallet Calls result when only some retained hashes are recoverable', async () => {
  const firstHash = hash('c')
  const secondHash = hash('d')
  const walletCallsOperation = operation({
    kind: 'walletCalls',
    transaction: undefined,
    receipt: undefined,
    walletCalls: { batchOperationId }
  })
  const batch = {
    id: hash('e'),
    operationId: batchOperationId,
    origin: 'origin',
    account,
    chainId: '0x1',
    atomic: false,
    callCount: 2,
    execution: 'pending',
    transactions: [
      { hash: firstHash, state: 'submitted' },
      { hash: secondHash, state: 'signed' }
    ],
    createdAt: 100,
    updatedAt: 200,
    expiresAt: 300
  } as WalletCallBatch
  const rpc = jest
    .fn()
    .mockImplementation(async (_chainId, _method, [requestedHash]) =>
      requestedHash === firstHash
        ? rpcTransaction({ hash: firstHash, value: '0x0', input: '0x12345678' })
        : null
    )
  const service = createActivityDetailsService({
    activity: () => [entry({ type: 'walletCalls' })],
    references: () => ({}),
    operations: () => ({ [activityId]: walletCallsOperation }),
    batches: () => ({ [batch.id]: batch }),
    rpc
  })

  await expect(service.get(activityId)).resolves.toMatchObject({
    success: true,
    partial: true,
    actions: [{ transactionHash: firstHash, kind: 'contract-call' }]
  })
  expect(rpc).toHaveBeenCalledTimes(2)
})

it('fails honestly when history, retained evidence, or configured-RPC evidence is unavailable', async () => {
  const missingHistory = createActivityDetailsService({
    activity: () => [],
    references: () => ({}),
    operations: () => ({}),
    batches: () => ({}),
    rpc: jest.fn()
  })
  await expect(missingHistory.get(activityId)).resolves.toEqual({ success: false, error: 'not-found' })

  const missingOperation = createActivityDetailsService({
    activity: () => [entry()],
    references: () => ({}),
    operations: () => ({}),
    batches: () => ({}),
    rpc: jest.fn()
  })
  await expect(missingOperation.get(activityId)).resolves.toEqual({
    success: false,
    error: 'evidence-unavailable'
  })

  const failedLookup = createActivityDetailsService({
    activity: () => [entry()],
    references: () => ({}),
    operations: () => ({ [activityId]: operation() }),
    batches: () => ({}),
    rpc: jest.fn().mockRejectedValue(new Error('private configured endpoint error'))
  })
  await expect(failedLookup.get(activityId)).resolves.toEqual({ success: false, error: 'lookup-failed' })
})
