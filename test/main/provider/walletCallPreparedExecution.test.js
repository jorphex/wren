import { TransactionFactory } from '@ethereumjs/tx'
import { privateToAddress } from '@ethereumjs/util'

import { GasFeesSource } from '../../../resources/domain/transaction'
import chainConfig from '../../../main/chains/config'
import {
  executePreparedWalletCallBatch,
  snapshotPreparedWalletCallExecutionInput
} from '../../../main/provider/walletCallPreparedExecution'
import { hashSignedTransaction } from '../../../main/provider/walletCallExecution'

const privateKey = Buffer.from('1'.padStart(64, '0'), 'hex')
const account = `0x${privateToAddress(privateKey).toString('hex')}`
const target = '0x2222222222222222222222222222222222222222'

function transaction(index, call, overrides = {}) {
  return {
    from: account,
    chainId: '0x1',
    nonce: `0x${(5 + index).toString(16)}`,
    type: '0x2',
    gasLimit: '0x5208',
    ...(call.to ? { to: call.to } : {}),
    data: call.data,
    value: call.value,
    maxFeePerGas: '0x10',
    maxPriorityFeePerGas: '0x1',
    gasFeesSource: GasFeesSource.Frame,
    ...overrides
  }
}

function signPrepared(prepared, key = privateKey) {
  const { from: _from, gasFeesSource: _gasFeesSource, ...txData } = prepared
  const common = chainConfig(parseInt(prepared.chainId, 16), prepared.type === '0x2' ? 'london' : 'berlin')
  const signed = TransactionFactory.fromTxData(txData, { common }).sign(key)
  return `0x${signed.serialize().toString('hex')}`
}

function signUnprotectedLegacy(prepared) {
  const { from: _from, gasFeesSource: _gasFeesSource, chainId: _chainId, ...txData } = prepared
  const signed = TransactionFactory.fromTxData(txData, { common: chainConfig(1, 'chainstart') }).sign(
    privateKey
  )
  return `0x${signed.serialize().toString('hex')}`
}

function singleCallInput(type) {
  const source = input()
  source.calls = [source.calls[0]]
  const legacy = type !== '0x2'
  source.preparation.calls = [
    {
      transaction: transaction(0, source.calls[0], {
        type,
        ...(legacy
          ? {
              gasPrice: '0x10',
              maxFeePerGas: undefined,
              maxPriorityFeePerGas: undefined
            }
          : {})
      }),
      maxFee: '0x52080'
    }
  ]
  source.preparation.maxFee = '0x52080'
  return source
}

const defaultCalls = [
  { to: target, data: '0xabcd', value: '0x0' },
  { data: '0x6000', value: '0x2' }
]
const rawTransactions = defaultCalls.map((call, index) => signPrepared(transaction(index, call)))
const hashes = rawTransactions.map(hashSignedTransaction)

function input(overrides = {}) {
  const calls = defaultCalls.map((call) => ({ ...call }))
  return {
    id: 'batch-id',
    origin: 'example.test',
    account,
    chainId: '0x1',
    calls,
    preparation: {
      calls: calls.map((call, index) => ({ transaction: transaction(index, call), maxFee: '0x52080' })),
      maxFee: '0xa4100'
    },
    ...overrides
  }
}

function dependencies(events = []) {
  const ledger = {
    reserveTransaction: jest.fn((_origin, _account, _id, hash) => events.push(`reserve:${hash}`)),
    markTransactionSubmitted: jest.fn((_origin, _account, _id, hash) => events.push(`submit:${hash}`)),
    complete: jest.fn(() => events.push('complete')),
    fail: jest.fn(() => events.push('fail'))
  }
  return {
    ledger,
    signTransaction: jest.fn(async (_transaction, index) => {
      events.push(`sign:${index}`)
      return { rawTransaction: signPrepared(_transaction) }
    }),
    broadcast: jest.fn(async (rawTransaction, index) => {
      events.push(`broadcast:${index}`)
      return hashSignedTransaction(rawTransaction)
    })
  }
}

it('returns a canonical detached and deeply frozen approval snapshot', () => {
  const source = input()
  source.account = `0x${source.account.slice(2).toUpperCase()}`

  const snapshot = snapshotPreparedWalletCallExecutionInput(source)

  expect(snapshot).toEqual({
    ...input(),
    account,
    calls: defaultCalls,
    preparation: input().preparation
  })
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(snapshot.calls)).toBe(true)
  expect(Object.isFrozen(snapshot.calls[0])).toBe(true)
  expect(Object.isFrozen(snapshot.preparation)).toBe(true)
  expect(Object.isFrozen(snapshot.preparation.calls)).toBe(true)
  expect(Object.isFrozen(snapshot.preparation.calls[0])).toBe(true)
  expect(Object.isFrozen(snapshot.preparation.calls[0].transaction)).toBe(true)

  source.calls[0].data = '0xffff'
  source.preparation.calls[0].transaction.data = '0xffff'
  source.preparation.calls[0].maxFee = '0x1'

  expect(snapshot.calls[0].data).toBe('0xabcd')
  expect(snapshot.preparation.calls[0]).toMatchObject({
    transaction: { data: '0xabcd' },
    maxFee: '0x52080'
  })
})

it('signs only frozen snapshots of the exact prepared transactions in order', async () => {
  const source = input()
  const events = []
  const deps = dependencies(events)
  const originalSigner = deps.signTransaction
  originalSigner.mockImplementation(async (prepared, index) => {
    events.push(`sign:${index}`)
    expect(Object.isFrozen(prepared)).toBe(true)
    if (index === 0) {
      source.preparation.calls[1].transaction.to = target
      source.preparation.calls[1].transaction.data = '0xffff'
      deps.signTransaction = jest.fn(() => Promise.reject(new Error('redirected signer')))
      deps.broadcast = jest.fn(() => Promise.reject(new Error('redirected broadcast')))
      deps.ledger.reserveTransaction = jest.fn(() => {
        throw new Error('redirected ledger')
      })
    }
    return { rawTransaction: signPrepared(prepared) }
  })

  await expect(executePreparedWalletCallBatch(source, deps)).resolves.toEqual(hashes)
  expect(originalSigner.mock.calls.map(([prepared]) => prepared)).toEqual([
    transaction(0, source.calls[0]),
    transaction(1, source.calls[1])
  ])
  expect(events).toEqual([
    'sign:0',
    `reserve:${hashes[0]}`,
    'broadcast:0',
    `submit:${hashes[0]}`,
    'sign:1',
    `reserve:${hashes[1]}`,
    'broadcast:1',
    `submit:${hashes[1]}`,
    'complete'
  ])
})

it.each(['0x0', '0x1', '0x2'])('verifies a signer-produced type %s transaction', async (type) => {
  const source = singleCallInput(type)
  const deps = dependencies()

  await expect(executePreparedWalletCallBatch(source, deps)).resolves.toHaveLength(1)
  expect(deps.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ type, nonce: '0x5' }), 0)
})

it.each(['0x0', '0x1', '0x2'])(
  'verifies a signer-produced type %s transaction on a custom chain',
  async (type) => {
    const source = singleCallInput(type)
    source.chainId = '0x2105'
    source.preparation.calls[0].transaction.chainId = '0x2105'
    const deps = dependencies()

    await expect(executePreparedWalletCallBatch(source, deps)).resolves.toHaveLength(1)
  }
)

it.each([
  ['account', '0x3333333333333333333333333333333333333333'],
  ['chainId', '0x2'],
  ['to', '0x3333333333333333333333333333333333333333'],
  ['data', '0xffff'],
  ['value', '0x1'],
  ['gasLimit', '0x0'],
  ['type', '0x3'],
  ['r', `0x${'1'.repeat(64)}`]
])('rejects prepared transaction substitution before signing: %s', async (field, value) => {
  const source = input()
  if (field === 'account') source.preparation.calls[0].transaction.from = value
  else if (field === 'chainId') source.preparation.calls[0].transaction.chainId = value
  else source.preparation.calls[0].transaction[field] = value
  const deps = dependencies()

  await expect(executePreparedWalletCallBatch(source, deps)).rejects.toThrow()
  expect(deps.signTransaction).not.toHaveBeenCalled()
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
})

it.each([
  ['non-contiguous nonces', (source) => (source.preparation.calls[1].transaction.nonce = '0x7')],
  ['per-call fee', (source) => (source.preparation.calls[0].maxFee = '0x1')],
  ['aggregate fee', (source) => (source.preparation.maxFee = '0x1')],
  ['malformed destination', (source) => (source.preparation.calls[0].transaction.to = {})],
  ['missing prepared call', (source) => source.preparation.calls.pop()]
])('fails closed for %s before invoking execution', async (_label, mutate) => {
  const source = input()
  mutate(source)
  const deps = dependencies()

  await expect(executePreparedWalletCallBatch(source, deps)).rejects.toThrow()
  expect(deps.signTransaction).not.toHaveBeenCalled()
  expect(deps.ledger.fail).not.toHaveBeenCalled()
})

it('reapplies Wren hard fee limits before invoking the signer', async () => {
  const source = singleCallInput('0x2')
  const excessiveFee = 2n * 10n ** 18n + 1n
  source.preparation.calls[0].transaction.gasLimit = '0x1'
  source.preparation.calls[0].transaction.maxFeePerGas = `0x${excessiveFee.toString(16)}`
  source.preparation.calls[0].maxFee = `0x${excessiveFee.toString(16)}`
  source.preparation.maxFee = `0x${excessiveFee.toString(16)}`
  const deps = dependencies()

  await expect(executePreparedWalletCallBatch(source, deps)).rejects.toThrow(/hard limit/)
  expect(deps.signTransaction).not.toHaveBeenCalled()
  expect(deps.ledger.fail).not.toHaveBeenCalled()
})

it('rejects an aggregate fee over the hard limit when each call is individually allowed', async () => {
  const source = input()
  const eachFee = 11n * 10n ** 17n
  source.preparation.calls.forEach((prepared) => {
    prepared.transaction.gasLimit = '0x1'
    prepared.transaction.maxFeePerGas = `0x${eachFee.toString(16)}`
    prepared.maxFee = `0x${eachFee.toString(16)}`
  })
  source.preparation.maxFee = `0x${(eachFee * 2n).toString(16)}`
  const deps = dependencies()

  await expect(executePreparedWalletCallBatch(source, deps)).rejects.toThrow(/batch fee.*hard limit/)
  expect(deps.signTransaction).not.toHaveBeenCalled()
})

it('preserves ambiguous broadcast reconciliation semantics', async () => {
  const deps = dependencies()
  deps.broadcast.mockRejectedValueOnce(new Error('connection closed'))

  await expect(executePreparedWalletCallBatch(input(), deps)).rejects.toThrow('connection closed')
  expect(deps.ledger.reserveTransaction).toHaveBeenCalledWith('example.test', account, 'batch-id', hashes[0])
  expect(deps.ledger.fail).not.toHaveBeenCalled()
  expect(deps.signTransaction).toHaveBeenCalledTimes(1)
})

it.each([
  ['value', (prepared) => ({ ...prepared, value: '0x1' })],
  ['nonce', (prepared) => ({ ...prepared, nonce: '0x6' })],
  ['gas limit', (prepared) => ({ ...prepared, gasLimit: '0x5209' })],
  ['maximum fee', (prepared) => ({ ...prepared, maxFeePerGas: '0x11' })],
  ['priority fee', (prepared) => ({ ...prepared, maxPriorityFeePerGas: '0x2' })],
  ['chain', (prepared) => ({ ...prepared, chainId: '0x2' })],
  ['destination', (prepared) => ({ ...prepared, to: account })],
  ['calldata', (prepared) => ({ ...prepared, data: '0xffff' })]
])('rejects signer-produced %s substitution before reservation or broadcast', async (_field, alter) => {
  const deps = dependencies()
  deps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signPrepared(alter(prepared))
  }))

  await expect(executePreparedWalletCallBatch(input(), deps)).rejects.toThrow(
    /does not match prepared transaction/
  )
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
  expect(deps.broadcast).not.toHaveBeenCalled()
  expect(deps.ledger.fail).toHaveBeenCalledTimes(1)
})

it('rejects a signer-produced transaction from another account', async () => {
  const otherKey = Buffer.from('2'.padStart(64, '0'), 'hex')
  const deps = dependencies()
  deps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signPrepared(prepared, otherKey)
  }))

  await expect(executePreparedWalletCallBatch(input(), deps)).rejects.toThrow(
    /does not match prepared transaction/
  )
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
})

it('rejects signer-produced type and legacy gas-price substitution', async () => {
  const typeSource = singleCallInput('0x2')
  const typeDeps = dependencies()
  typeDeps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signPrepared({
      ...prepared,
      type: '0x1',
      gasPrice: prepared.maxFeePerGas,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined
    })
  }))
  await expect(executePreparedWalletCallBatch(typeSource, typeDeps)).rejects.toThrow(
    /does not match prepared transaction/
  )

  const legacySource = singleCallInput('0x0')
  const legacyDeps = dependencies()
  legacyDeps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signPrepared({ ...prepared, gasPrice: '0x11' })
  }))
  await expect(executePreparedWalletCallBatch(legacySource, legacyDeps)).rejects.toThrow(
    /does not match prepared transaction/
  )
})

it('rejects a signer-produced legacy transaction for another chain', async () => {
  const source = singleCallInput('0x0')
  const deps = dependencies()
  deps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signPrepared({ ...prepared, chainId: '0x2' })
  }))

  await expect(executePreparedWalletCallBatch(source, deps)).rejects.toThrow(
    /does not match prepared transaction/
  )
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
})

it('rejects an access list added by the signer', async () => {
  const deps = dependencies()
  deps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signPrepared({
      ...prepared,
      accessList: [{ address: target, storageKeys: [] }]
    })
  }))

  await expect(executePreparedWalletCallBatch(input(), deps)).rejects.toThrow(
    /does not match prepared transaction/
  )
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
  expect(deps.broadcast).not.toHaveBeenCalled()
})

it('rejects an unprotected legacy signature', async () => {
  const source = singleCallInput('0x0')
  const deps = dependencies()
  deps.signTransaction.mockImplementationOnce(async (prepared) => ({
    rawTransaction: signUnprotectedLegacy(prepared)
  }))

  await expect(executePreparedWalletCallBatch(source, deps)).rejects.toThrow(
    /does not match prepared transaction/
  )
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
  expect(deps.broadcast).not.toHaveBeenCalled()
})

it('fails terminally when signing stops after an earlier confirmed submission', async () => {
  const deps = dependencies()
  deps.signTransaction.mockImplementation(async (_prepared, index) => {
    if (index === 1) throw new Error('second signature declined')
    return { rawTransaction: signPrepared(_prepared) }
  })

  await expect(executePreparedWalletCallBatch(input(), deps)).rejects.toThrow('second signature declined')
  expect(deps.ledger.markTransactionSubmitted).toHaveBeenCalledTimes(1)
  expect(deps.ledger.fail).toHaveBeenCalledTimes(1)
})
