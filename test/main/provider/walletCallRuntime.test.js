import { TransactionFactory } from '@ethereumjs/tx'
import { privateToAddress } from '@ethereumjs/util'

import { GasFeesSource } from '../../../resources/domain/transaction'
import chainConfig from '../../../main/chains/config'
import { hashSignedTransaction } from '../../../main/provider/walletCallExecution'
import { executeWalletCallRuntime } from '../../../main/provider/walletCallRuntime'

const privateKey = Buffer.from('1'.padStart(64, '0'), 'hex')
const account = `0x${privateToAddress(privateKey).toString('hex')}`
const target = '0x2222222222222222222222222222222222222222'
const calls = [
  { to: target, data: '0xabcd', value: '0x0' },
  { data: '0x6000', value: '0x2' }
]

function transaction(index, call) {
  return {
    from: account,
    chainId: '0xa',
    nonce: `0x${(5 + index).toString(16)}`,
    type: '0x2',
    gasLimit: '0x5208',
    ...(call.to ? { to: call.to } : {}),
    data: call.data,
    value: call.value,
    maxFeePerGas: '0x10',
    maxPriorityFeePerGas: '0x1',
    gasFeesSource: GasFeesSource.Frame
  }
}

function sign(prepared, key = privateKey) {
  const { from: _from, gasFeesSource: _source, ...data } = prepared
  const signed = TransactionFactory.fromTxData(data, { common: chainConfig(10, 'london') }).sign(key)
  return `0x${signed.serialize().toString('hex')}`
}

function input() {
  const requestCalls = calls.map((call) => ({ ...call }))
  return {
    id: 'batch-id',
    origin: 'example.test',
    account,
    chainId: '0xa',
    calls: requestCalls,
    preparation: {
      calls: requestCalls.map((call, index) => ({
        transaction: transaction(index, call),
        maxFee: '0x52080'
      })),
      maxFee: '0xa4100'
    }
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
    accounts: {
      signTransactionForAccount: jest.fn((accountId, prepared, callback) => {
        events.push(`sign:${accountId}:${prepared.nonce}`)
        callback(null, sign(prepared))
      })
    },
    connection: {
      send: jest.fn((payload, callback, chain) => {
        events.push(`send:${chain.id}:${payload.id}`)
        callback({ id: payload.id, jsonrpc: '2.0', result: hashSignedTransaction(payload.params[0]) })
      })
    },
    ledger
  }
}

it('signs with the pinned account and broadcasts sequentially to the exact chain', async () => {
  const events = []
  const deps = dependencies(events)
  const hashes = calls.map((call, index) => hashSignedTransaction(sign(transaction(index, call))))

  await expect(executeWalletCallRuntime(input(), deps)).resolves.toEqual(hashes)

  expect(deps.accounts.signTransactionForAccount.mock.calls.map(([id]) => id)).toEqual([account, account])
  expect(deps.connection.send.mock.calls.map(([_payload, _callback, chain]) => chain)).toEqual([
    { type: 'ethereum', id: 10 },
    { type: 'ethereum', id: 10 }
  ])
  expect(deps.connection.send.mock.calls.map(([payload]) => payload)).toEqual(
    hashes.map((_hash, index) => ({
      id: index + 1,
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [expect.any(String)]
    }))
  )
  expect(
    deps.connection.send.mock.calls.map(([payload]) => hashSignedTransaction(payload.params[0]))
  ).toEqual(hashes)
  expect(events).toEqual([
    `sign:${account}:0x5`,
    `reserve:${hashes[0]}`,
    'send:10:1',
    `submit:${hashes[0]}`,
    `sign:${account}:0x6`,
    `reserve:${hashes[1]}`,
    'send:10:2',
    `submit:${hashes[1]}`,
    'complete'
  ])
})

it('rechecks before every signer invocation and stops after first-call policy drift', async () => {
  const deps = dependencies()
  let checks = 0
  let signerInvocations = 0
  deps.assertBeforeSign = jest.fn(() => {
    checks += 1
    if (checks === 2) throw Object.assign(new Error('Request origin is no longer authorized'), { code: 4100 })
  })
  deps.accounts.signTransactionForAccount.mockImplementation((_accountId, prepared, callback, beforeSign) => {
    beforeSign()
    signerInvocations += 1
    callback(null, sign(prepared))
  })

  await expect(executeWalletCallRuntime(input(), deps)).rejects.toMatchObject({
    code: 4100,
    message: 'Request origin is no longer authorized'
  })
  expect(deps.assertBeforeSign).toHaveBeenCalledTimes(2)
  expect(signerInvocations).toBe(1)
  expect(deps.connection.send).toHaveBeenCalledTimes(1)
  expect(deps.ledger.markTransactionSubmitted).toHaveBeenCalledTimes(1)
  expect(deps.ledger.complete).not.toHaveBeenCalled()
  expect(deps.ledger.fail).toHaveBeenCalledTimes(1)
})

it('records each concrete destination only after its broadcast is accepted', async () => {
  const deps = dependencies()
  deps.recordSubmittedTarget = jest.fn()

  await expect(executeWalletCallRuntime(input(), deps)).resolves.toHaveLength(2)

  expect(deps.recordSubmittedTarget).toHaveBeenCalledTimes(1)
  expect(deps.recordSubmittedTarget).toHaveBeenCalledWith(target, expect.any(Number))
})

it('does not let outbound-address persistence failures change broadcast settlement', async () => {
  const deps = dependencies()
  deps.recordSubmittedTarget = jest.fn(() => {
    throw new Error('address memory unavailable')
  })

  await expect(executeWalletCallRuntime(input(), deps)).resolves.toHaveLength(2)
  expect(deps.ledger.complete).toHaveBeenCalledTimes(1)
})

it('snapshots input and runtime method references before asynchronous work', async () => {
  const source = input()
  const deps = dependencies()
  const originalSigner = deps.accounts.signTransactionForAccount
  const originalSend = deps.connection.send
  let signatures = 0
  originalSigner.mockImplementation((_accountId, prepared, callback) => {
    signatures += 1
    if (signatures === 1) {
      source.account = target
      source.chainId = '0x1'
      source.calls[1].data = '0xffff'
      source.preparation.calls[1].transaction.data = '0xffff'
      deps.accounts.signTransactionForAccount = jest.fn(() => {
        throw new Error('redirected signer')
      })
      deps.connection.send = jest.fn(() => {
        throw new Error('redirected connection')
      })
    }
    callback(null, sign(prepared))
  })

  await expect(executeWalletCallRuntime(source, deps)).resolves.toHaveLength(2)
  expect(originalSigner).toHaveBeenCalledTimes(2)
  expect(originalSend).toHaveBeenCalledTimes(2)
})

it('publishes durable evidence before a broadcast callback can stall', async () => {
  const source = input()
  source.calls = [source.calls[0]]
  source.preparation.calls = [source.preparation.calls[0]]
  source.preparation.maxFee = '0x52080'
  const deps = dependencies()
  deps.evidenceAvailable = jest.fn()
  let broadcastCallback
  deps.connection.send.mockImplementation((_payload, callback) => {
    broadcastCallback = callback
  })

  const execution = executeWalletCallRuntime(source, deps)
  for (let index = 0; index < 10; index += 1) await Promise.resolve()

  expect(deps.ledger.reserveTransaction).toHaveBeenCalledTimes(1)
  expect(deps.evidenceAvailable).toHaveBeenCalledTimes(1)
  expect(deps.ledger.markTransactionSubmitted).not.toHaveBeenCalled()

  const payload = deps.connection.send.mock.calls[0][0]
  broadcastCallback({ id: payload.id, jsonrpc: '2.0', result: hashSignedTransaction(payload.params[0]) })
  await expect(execution).resolves.toHaveLength(1)
  expect(deps.evidenceAvailable).toHaveBeenCalledTimes(2)
})

it('does not let evidence notification failures interrupt execution', async () => {
  const deps = dependencies()
  deps.evidenceAvailable = jest.fn(() => {
    throw new Error('poller unavailable')
  })

  await expect(executeWalletCallRuntime(input(), deps)).resolves.toHaveLength(2)
  expect(deps.evidenceAvailable).toHaveBeenCalledTimes(4)
})

it.each([
  ['callback error', (callback) => callback(new Error('device declined')), /device declined/],
  [
    'thrown error',
    () => {
      throw new Error('device disconnected')
    },
    /device disconnected/
  ],
  ['missing bytes', (callback) => callback(null), /no signed transaction/]
])('rejects signer %s before broadcast', async (_label, signResult, message) => {
  const deps = dependencies()
  deps.accounts.signTransactionForAccount.mockImplementation((_account, _transaction, callback) =>
    signResult(callback)
  )

  await expect(executeWalletCallRuntime(input(), deps)).rejects.toThrow(message)
  expect(deps.connection.send).not.toHaveBeenCalled()
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
  expect(deps.ledger.fail).toHaveBeenCalledTimes(1)
})

it('ignores duplicate signer and connection callbacks', async () => {
  const source = input()
  source.calls = [source.calls[0]]
  source.preparation.calls = [source.preparation.calls[0]]
  source.preparation.maxFee = '0x52080'
  const deps = dependencies()
  deps.accounts.signTransactionForAccount.mockImplementation((_account, prepared, callback) => {
    callback(null, sign(prepared))
    callback(new Error('late signer error'))
  })
  deps.connection.send.mockImplementation((payload, callback) => {
    callback({ result: hashSignedTransaction(payload.params[0]) })
    callback({ error: { message: 'late RPC error' } })
  })

  await expect(executeWalletCallRuntime(source, deps)).resolves.toHaveLength(1)
  expect(deps.ledger.complete).toHaveBeenCalledTimes(1)
})

it.each([
  ['RPC error', (callback) => callback({ error: { code: -32000, message: 'connection closed' } })],
  [
    'thrown error',
    (_callback) => {
      throw new Error('socket unavailable')
    }
  ],
  ['missing hash', (callback) => callback({ result: undefined })]
])('retains the signed reservation after broadcast %s', async (_label, sendResult) => {
  const deps = dependencies()
  deps.recordSubmittedTarget = jest.fn()
  deps.connection.send.mockImplementation((_payload, callback) => sendResult(callback))

  await expect(executeWalletCallRuntime(input(), deps)).rejects.toThrow()
  expect(deps.ledger.reserveTransaction).toHaveBeenCalledTimes(1)
  expect(deps.ledger.markTransactionSubmitted).not.toHaveBeenCalled()
  expect(deps.ledger.fail).not.toHaveBeenCalled()
  expect(deps.recordSubmittedTarget).not.toHaveBeenCalled()
})

it('rejects signer output that does not match the prepared account', async () => {
  const deps = dependencies()
  const otherKey = Buffer.from('2'.padStart(64, '0'), 'hex')
  deps.accounts.signTransactionForAccount.mockImplementation((_account, prepared, callback) =>
    callback(null, sign(prepared, otherKey))
  )

  await expect(executeWalletCallRuntime(input(), deps)).rejects.toThrow(/does not match prepared/i)
  expect(deps.connection.send).not.toHaveBeenCalled()
  expect(deps.ledger.reserveTransaction).not.toHaveBeenCalled()
})
