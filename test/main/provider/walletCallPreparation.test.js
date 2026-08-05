import { GasFeesSource } from '../../../resources/domain/transaction'
import { MAX_UINT256, toRpcQuantity } from '../../../resources/domain/transaction/quantity'
import { prepareWalletCallBatch } from '../../../main/provider/walletCallPreparation'

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'

function input(overrides = {}) {
  return {
    account,
    chainId: '0x1',
    pendingNonce: '0x5',
    calls: [
      { to: target, data: '0xabcd', value: '0x0' },
      { data: '0x6000', value: '0x2' }
    ],
    ...overrides
  }
}

function filled(intent, overrides = {}, approvals = []) {
  return {
    tx: {
      ...intent,
      type: '0x2',
      gasLimit: '0x5208',
      maxFeePerGas: '0x10',
      maxPriorityFeePerGas: '0x1',
      gasFeesSource: GasFeesSource.Frame,
      ...overrides
    },
    approvals
  }
}

function dependencies(implementation = async (intent) => filled(intent)) {
  return { fillTransaction: jest.fn(implementation) }
}

it('prepares exact contiguous transactions sequentially and summarizes maximum fees', async () => {
  const events = []
  const deps = dependencies(async (intent, index) => {
    events.push(`start:${index}`)
    await Promise.resolve()
    events.push(`end:${index}`)
    return filled(intent)
  })

  const prepared = await prepareWalletCallBatch(input(), deps)

  expect(events).toEqual(['start:0', 'end:0', 'start:1', 'end:1'])
  expect(deps.fillTransaction.mock.calls.map(([intent]) => intent)).toEqual([
    { from: account, chainId: '0x1', nonce: '0x5', to: target, data: '0xabcd', value: '0x0' },
    { from: account, chainId: '0x1', nonce: '0x6', data: '0x6000', value: '0x2' }
  ])
  expect(prepared.calls.map(({ maxFee }) => maxFee)).toEqual(['0x52080', '0x52080'])
  expect(prepared.maxFee).toBe('0xa4100')
  expect(Object.isFrozen(prepared)).toBe(true)
  expect(Object.isFrozen(prepared.calls)).toBe(true)
  expect(prepared.calls.every(Object.isFrozen)).toBe(true)
  expect(prepared.calls.every(({ transaction }) => Object.isFrozen(transaction))).toBe(true)
})

it('uses an immutable normalized call snapshot across asynchronous filling', async () => {
  const source = input({
    account: account.toUpperCase().replace('0X', '0x'),
    chainId: '0x01'.replace('01', '1'),
    calls: [{ to: target.toUpperCase().replace('0X', '0x'), data: '0xABCD', value: '0xA' }]
  })
  const deps = dependencies(async (intent) => {
    source.account = '0x3333333333333333333333333333333333333333'
    source.calls[0].to = source.account
    source.calls[0].data = '0xffff'
    return filled(intent)
  })

  const prepared = await prepareWalletCallBatch(source, deps)
  expect(prepared.calls[0].transaction).toMatchObject({
    from: account,
    to: target,
    data: '0xabcd',
    value: '0xa'
  })
})

it('supports legacy fee transactions while stripping non-signing metadata', async () => {
  const deps = dependencies(async (intent) =>
    filled(intent, {
      type: '0x1',
      gasPrice: '0x20',
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
      recipientType: 'external',
      feesUpdated: true,
      warning: 'not signing data'
    })
  )

  const prepared = await prepareWalletCallBatch(input({ calls: [input().calls[0]] }), deps)
  expect(prepared.calls[0].transaction).toEqual({
    from: account,
    chainId: '0x1',
    nonce: '0x5',
    type: '0x1',
    gasLimit: '0x5208',
    to: target,
    data: '0xabcd',
    value: '0x0',
    gasPrice: '0x20',
    gasFeesSource: GasFeesSource.Frame
  })
})

it.each([
  ['from', '0x3333333333333333333333333333333333333333'],
  ['chainId', '0x2'],
  ['nonce', '0x9'],
  ['to', '0x3333333333333333333333333333333333333333'],
  ['data', '0xffff'],
  ['value', '0x1'],
  ['gasLimit', '0x0'],
  ['type', '0x3'],
  ['accessList', []]
])('rejects prepared intent or signing-surface substitution: %s', async (field, value) => {
  const deps = dependencies(async (intent) => filled(intent, { [field]: value }))

  await expect(prepareWalletCallBatch(input({ calls: [input().calls[0]] }), deps)).rejects.toThrow(
    /does not match/
  )
})

it('rejects EIP-1559 fee fields on legacy transactions', async () => {
  const deps = dependencies(async (intent) =>
    filled(intent, {
      type: '0x0',
      gasPrice: '0x1'
    })
  )

  await expect(prepareWalletCallBatch(input({ calls: [input().calls[0]] }), deps)).rejects.toThrow(
    /invalid gas fees/
  )
})

it('rejects a destination added to contract deployment intent', async () => {
  const deps = dependencies(async (intent) => filled(intent, { to: target }))
  await expect(prepareWalletCallBatch(input({ calls: [input().calls[1]] }), deps)).rejects.toThrow(
    /does not match/
  )
})

it.each([
  { gasLimit: '0x00' },
  { gasLimit: '0x1', maxFeePerGas: '0x00' },
  { gasLimit: '0x1', maxPriorityFeePerGas: '0x11' },
  { gasLimit: '0x1', maxFeePerGas: undefined },
  { gasFeesSource: 'Unknown' },
  { gasPrice: '0x1' },
  { r: '0x1' }
])('rejects malformed gas and fee metadata: %#', async (overrides) => {
  const deps = dependencies(async (intent) => filled(intent, overrides))
  await expect(prepareWalletCallBatch(input({ calls: [input().calls[0]] }), deps)).rejects.toThrow()
})

it.each([null, [], { tx: null, approvals: [] }, { tx: {}, approvals: null }])(
  'rejects malformed filler metadata: %#',
  async (metadata) => {
    const deps = dependencies(async () => metadata)
    await expect(prepareWalletCallBatch(input({ calls: [input().calls[0]] }), deps)).rejects.toThrow()
  }
)

it('fails closed when transaction filling requires another approval', async () => {
  const deps = dependencies(async (intent) => filled(intent, {}, [{ type: 'gasLimitApproval' }]))
  await expect(prepareWalletCallBatch(input({ calls: [input().calls[0]] }), deps)).rejects.toThrow(
    /unsupported transaction approval/
  )
})

it('enforces per-transaction and aggregate Wren fee limits', async () => {
  const overLimit = toRpcQuantity(2n * 10n ** 18n + 1n)
  const perTransaction = dependencies(async (intent) =>
    filled(intent, {
      type: '0x0',
      gasLimit: '0x1',
      gasPrice: overLimit,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined
    })
  )
  await expect(prepareWalletCallBatch(input({ calls: [input().calls[0]] }), perTransaction)).rejects.toThrow(
    /maximum fee exceeds Wren hard limit/
  )

  const eachFee = 11n * 10n ** 17n
  const aggregate = dependencies(async (intent) =>
    filled(intent, {
      type: '0x0',
      gasLimit: '0x1',
      gasPrice: toRpcQuantity(eachFee),
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined
    })
  )
  await expect(prepareWalletCallBatch(input(), aggregate)).rejects.toThrow(
    /batch maximum fee exceeds Wren hard limit/
  )
})

it('rejects nonce overflow before filling any transaction', async () => {
  const deps = dependencies()
  await expect(
    prepareWalletCallBatch(input({ pendingNonce: toRpcQuantity(MAX_UINT256) }), deps)
  ).rejects.toThrow(/nonce range exceeds/)
  expect(deps.fillTransaction).not.toHaveBeenCalled()
})

it.each([
  { account: '0x1' },
  { chainId: '0x0' },
  { chainId: '0x01' },
  { chainId: toRpcQuantity(BigInt(Number.MAX_SAFE_INTEGER) + 1n) },
  { pendingNonce: '0x00' },
  { calls: [] },
  { calls: [{ to: '0x1', data: '0x', value: '0x0' }] }
])('rejects malformed input before filling: %#', async (overrides) => {
  const deps = dependencies()
  await expect(prepareWalletCallBatch(input(overrides), deps)).rejects.toThrow()
  expect(deps.fillTransaction).not.toHaveBeenCalled()
})

it('stops at the first fill failure and bounds diagnostics', async () => {
  const deps = dependencies(async (_intent, index) => {
    if (index === 0) throw new Error('x'.repeat(500))
    throw new Error('later call should not run')
  })

  let error
  try {
    await prepareWalletCallBatch(input(), deps)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toHaveLength(240)
  expect(deps.fillTransaction).toHaveBeenCalledTimes(1)
})
