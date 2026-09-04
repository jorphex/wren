import {
  assertAccountCodeEvidenceStable,
  buildEthCall,
  buildSimulationCall,
  parseCallTrace,
  parseDelegationIndicator,
  parseNativeBalanceChanges,
  parseProxyImplementationChanges,
  parseSimulateCallsResult,
  parseSimulateResult,
  simulateTransaction,
  simulateWalletCalls
} from '../../../main/transaction/simulation'

const transaction = {
  chainId: '0x1',
  type: '0x2',
  nonce: '0x7',
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  gasLimit: '0x5208',
  value: '0x1',
  data: '0x1234',
  maxFeePerGas: '0x64',
  maxPriorityFeePerGas: '0x2',
  gasFeesSource: 'Frame'
}

const emptyCodeHash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const noCodeEvidence = (account, role, callIndexes) => ({
  status: 'no-code',
  source: 'eth_getCode',
  trust: 'configured-rpc',
  account,
  codeHash: emptyCodeHash,
  role,
  ...(callIndexes ? { callIndexes } : {})
})
const transactionAccountCodeEvidence = {
  source: 'configured-rpc',
  sender: noCodeEvidence(transaction.from, 'sender'),
  targets: [noCodeEvidence(transaction.to, 'target', [0])]
}

it('binds signing revalidation to exact target presence and reviewed call index', () => {
  const sender = noCodeEvidence(transaction.from, 'sender')
  const creationEvidence = { source: 'configured-rpc', sender, targets: [] }

  expect(() => assertAccountCodeEvidenceStable(transactionAccountCodeEvidence, creationEvidence)).toThrow(
    expect.objectContaining({ code: 'account-code-evidence-changed' })
  )

  const evidenceForOtherCall = {
    ...transactionAccountCodeEvidence,
    targets: [noCodeEvidence(transaction.to, 'target', [1])]
  }
  expect(() =>
    assertAccountCodeEvidenceStable(evidenceForOtherCall, transactionAccountCodeEvidence, 0)
  ).toThrow(expect.objectContaining({ code: 'account-code-evidence-changed' }))
  expect(() => assertAccountCodeEvidenceStable(evidenceForOtherCall, creationEvidence, 0)).not.toThrow()
})

const approvalSpender = '0x3333333333333333333333333333333333333333'
const approvalAmount = 42n
const approvalData = `0x095ea7b3${'0'.repeat(24)}${approvalSpender.slice(2)}${approvalAmount
  .toString(16)
  .padStart(64, '0')}`
const approvalTransaction = { ...transaction, data: approvalData }
const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const storageAddress = (address) => `0x${'0'.repeat(24)}${address.slice(2)}`

const simulateSuccess = [
  {
    calls: [{ status: '0x1', gasUsed: '0x5208', returnData: '0x', logs: [] }]
  }
]

const unsupportedNativeBalanceChanges = {
  status: 'unavailable',
  source: 'debug_traceCall',
  reason: 'Configured RPC does not support native balance-change tracing'
}

const unsupportedProxyImplementationCheck = {
  status: 'unavailable',
  source: 'debug_traceCall',
  standard: 'ERC-1967',
  slot: implementationSlot,
  reason: 'Configured RPC does not support ERC-1967 net implementation-slot tracing'
}

const callFrame = (overrides = {}) => ({
  type: 'CALL',
  from: transaction.from,
  to: transaction.to,
  value: transaction.value,
  input: transaction.data,
  ...overrides
})

function rpcError(code, message) {
  return { id: 1, jsonrpc: '2.0', error: { code, message } }
}

const withAccountCode =
  (send, response = { result: '0x' }, traceResponse = rpcError(-32601, 'Method not found')) =>
  (payload, callback, targetChain) => {
    if (payload.method === 'eth_getCode') {
      callback({ id: payload.id, jsonrpc: '2.0', ...response })
      return
    }
    if (payload.method === 'debug_traceCall') {
      callback({ ...traceResponse, id: payload.id })
      return
    }

    send(payload, callback, targetChain)
  }

it('strictly parses only an exact EIP-7702 delegation indicator', () => {
  const delegate = 'aA'.repeat(20)

  expect(parseDelegationIndicator(`0xef0100${delegate}`)).toBe(`0x${delegate.toLowerCase()}`)
  expect(parseDelegationIndicator(`0xEF0100${delegate}`)).toBe(`0x${delegate.toLowerCase()}`)
  expect(parseDelegationIndicator(`0xef0100${delegate}00`)).toBeUndefined()
  expect(parseDelegationIndicator(`0x6000${delegate}`)).toBeUndefined()
  expect(parseDelegationIndicator('0xef0100zz')).toBeUndefined()
})

it('builds bounded single-call RPC inputs from transaction data', () => {
  expect(buildSimulationCall(transaction)).toEqual({
    type: '0x2',
    nonce: '0x7',
    from: transaction.from,
    to: transaction.to,
    gas: '0x5208',
    value: '0x1',
    input: '0x1234',
    maxPriorityFeePerGas: '0x2',
    maxFeePerGas: '0x64'
  })
  expect(buildEthCall(transaction)).toEqual({
    from: transaction.from,
    to: transaction.to,
    gas: '0x5208',
    value: '0x1',
    data: '0x1234',
    maxPriorityFeePerGas: '0x2',
    maxFeePerGas: '0x64'
  })
})

it('canonicalizes transaction quantities and omits placeholder gas from simulation calls', () => {
  expect(
    buildSimulationCall({
      ...transaction,
      type: '0x02',
      nonce: '0x007',
      gasLimit: '0x005208',
      value: '0x01',
      maxPriorityFeePerGas: '0x02',
      maxFeePerGas: '0x064'
    })
  ).toMatchObject({
    type: '0x2',
    nonce: '0x7',
    gas: '0x5208',
    value: '0x1',
    maxPriorityFeePerGas: '0x2',
    maxFeePerGas: '0x64'
  })
  expect(buildSimulationCall({ ...transaction, gasLimit: '0x00' })).not.toHaveProperty('gas')
  expect(buildSimulationCall({ ...transaction, gasLimit: '0x0' })).not.toHaveProperty('gas')
})

it('preserves an exact access list in configured-RPC simulation input', () => {
  const accessList = [
    {
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      storageKeys: [`0x${'bb'.repeat(32)}`]
    }
  ]

  expect(buildSimulationCall({ ...transaction, accessList })).toMatchObject({ accessList })
  expect(buildEthCall({ ...transaction, accessList })).toMatchObject({ accessList })
})

it('strictly parses bounded native balance changes, creations, and deletions', () => {
  const created = '0x3333333333333333333333333333333333333333'
  const deleted = '0x4444444444444444444444444444444444444444'
  const mixedCaseSender = `0x${transaction.from.slice(2).toUpperCase()}`

  expect(
    parseNativeBalanceChanges({
      pre: {
        [mixedCaseSender]: { balance: '0xa', nonce: 1 },
        [transaction.to]: { balance: '0x5' },
        [deleted]: { balance: '0x2' }
      },
      post: {
        [mixedCaseSender]: { balance: '0x7' },
        [transaction.to]: { nonce: 2 },
        [created]: { balance: '0x5' }
      }
    })
  ).toEqual({
    changes: [
      { account: transaction.from, before: '10', after: '7', change: '-3' },
      { account: created, before: '0', after: '5', change: '5' },
      { account: deleted, before: '2', after: '0', change: '-2' }
    ],
    truncated: false
  })
})

it('fails closed on malformed native balance changes and bounds account output', () => {
  expect(parseNativeBalanceChanges({ pre: [], post: {} })).toBeUndefined()
  expect(parseNativeBalanceChanges({ pre: { invalid: { balance: '0x1' } }, post: {} })).toBeUndefined()
  expect(
    parseNativeBalanceChanges({ pre: { [transaction.from]: { balance: '0x01' } }, post: {} })
  ).toBeUndefined()
  expect(
    parseNativeBalanceChanges({
      pre: { [transaction.from]: { nonce: 1 } },
      post: { [transaction.from]: { balance: '0x1' } }
    })
  ).toBeUndefined()
  expect(
    parseNativeBalanceChanges({
      pre: {
        '0xaabbccddaabbccddaabbccddaabbccddaabbccdd': { balance: '0x1' },
        '0xAABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD': { balance: '0x1' }
      },
      post: {}
    })
  ).toBeUndefined()

  const pre = {}
  const post = {}
  for (let index = 0; index < 129; index += 1) {
    const address = `0x${index.toString(16).padStart(40, '0')}`
    pre[address] = { balance: '0x0' }
    post[address] = { balance: '0x1' }
  }
  const bounded = parseNativeBalanceChanges({ pre, post })
  expect(bounded).toMatchObject({ truncated: true })
  expect(bounded.changes).toHaveLength(128)

  const oversized = {}
  for (let index = 0; index < 1025; index += 1) {
    oversized[`0x${index.toString(16).padStart(40, '0')}`] = { balance: '0x0' }
  }
  expect(parseNativeBalanceChanges({ pre: oversized, post: {} })).toBeUndefined()
})

it('strictly parses bounded ERC-1967 implementation-slot changes', () => {
  const changedProxy = '0x3333333333333333333333333333333333333333'
  const initializedProxy = '0x4444444444444444444444444444444444444444'
  const clearedProxy = '0x5555555555555555555555555555555555555555'
  const before = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const after = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  expect(
    parseProxyImplementationChanges({
      pre: {
        [changedProxy]: { storage: { [implementationSlot]: storageAddress(before) } },
        [clearedProxy]: { storage: { [implementationSlot]: storageAddress(before) } }
      },
      post: {
        [changedProxy]: { storage: { [implementationSlot.toUpperCase()]: storageAddress(after) } },
        [initializedProxy]: { storage: { [implementationSlot]: storageAddress(after) } },
        [clearedProxy]: { storage: {} }
      }
    })
  ).toEqual({
    changes: [
      {
        proxy: changedProxy,
        kind: 'changed',
        beforeValue: storageAddress(before),
        afterValue: storageAddress(after),
        beforeImplementation: before,
        afterImplementation: after
      },
      {
        proxy: initializedProxy,
        kind: 'initialized',
        beforeValue: `0x${'0'.repeat(64)}`,
        afterValue: storageAddress(after),
        beforeImplementation: '0x0000000000000000000000000000000000000000',
        afterImplementation: after
      },
      {
        proxy: clearedProxy,
        kind: 'cleared',
        beforeValue: storageAddress(before),
        afterValue: `0x${'0'.repeat(64)}`,
        beforeImplementation: before,
        afterImplementation: '0x0000000000000000000000000000000000000000'
      }
    ],
    truncated: false
  })
})

it('rejects malformed ERC-1967 evidence and bounds reported changes', () => {
  expect(parseProxyImplementationChanges({ pre: [], post: {} })).toBeUndefined()
  const noncanonical = `0x01${'00'.repeat(31)}`
  expect(
    parseProxyImplementationChanges({
      pre: { [transaction.to]: { storage: {} } },
      post: { [transaction.to]: { storage: { [implementationSlot]: noncanonical } } }
    })
  ).toEqual({
    changes: [
      {
        proxy: transaction.to,
        kind: 'initialized',
        beforeValue: `0x${'0'.repeat(64)}`,
        afterValue: noncanonical,
        beforeImplementation: '0x0000000000000000000000000000000000000000'
      }
    ],
    truncated: false
  })
  expect(
    parseProxyImplementationChanges({
      pre: { [transaction.to]: { storage: { [implementationSlot]: `0x01${'00'.repeat(31)}` } } },
      post: { [transaction.to]: { storage: { [implementationSlot]: `0x${'00'.repeat(31)}` } } }
    })
  ).toBeUndefined()
  expect(
    parseProxyImplementationChanges({
      pre: {
        [transaction.to]: {
          storage: {
            [implementationSlot]: storageAddress(transaction.from),
            [implementationSlot.toUpperCase()]: storageAddress(transaction.from)
          }
        }
      },
      post: { [transaction.to]: { storage: {} } }
    })
  ).toBeUndefined()

  const pre = {}
  const post = {}
  for (let index = 0; index < 33; index += 1) {
    const proxy = `0x${(index + 1).toString(16).padStart(40, '0')}`
    pre[proxy] = { storage: { [implementationSlot]: storageAddress(transaction.from) } }
    post[proxy] = { storage: { [implementationSlot]: storageAddress(transaction.to) } }
  }
  expect(parseProxyImplementationChanges({ pre, post })).toMatchObject({
    changes: expect.arrayContaining([
      expect.objectContaining({
        proxy: '0x0000000000000000000000000000000000000001',
        beforeImplementation: transaction.from,
        afterImplementation: transaction.to
      })
    ]),
    truncated: true
  })
  expect(parseProxyImplementationChanges({ pre, post }).changes).toHaveLength(32)

  const oversizedStorage = { [implementationSlot]: storageAddress(transaction.from) }
  for (let index = 0; index < 8192; index += 1) {
    oversizedStorage[`0x${index.toString(16).padStart(64, '0')}`] = `0x${'0'.repeat(64)}`
  }
  expect(
    parseProxyImplementationChanges({
      pre: { [transaction.to]: { storage: oversizedStorage } },
      post: { [transaction.to]: { storage: {} } }
    })
  ).toBeUndefined()
})

it('strictly parses bounded nested calls without exposing raw trace data', () => {
  const firstTarget = '0x3333333333333333333333333333333333333333'
  const delegate = '0x4444444444444444444444444444444444444444'
  const created = '0x5555555555555555555555555555555555555555'
  const result = parseCallTrace(
    callFrame({
      calls: [
        callFrame({
          from: transaction.to,
          to: firstTarget,
          value: '0x2',
          input: '0xabcdef01dead',
          output: `0x${'ff'.repeat(64)}`,
          calls: [
            callFrame({
              type: 'DELEGATECALL',
              from: firstTarget,
              to: delegate,
              value: '0x0',
              input: '0x12345678',
              error: `execution reverted: ${'x'.repeat(300)}`
            })
          ]
        }),
        callFrame({
          type: 'CREATE',
          from: transaction.to,
          to: created,
          value: '0x0',
          input: '0x60006000'
        })
      ]
    }),
    transaction
  )

  expect(result).toEqual({
    truncated: false,
    calls: [
      {
        type: 'CALL',
        depth: 1,
        from: transaction.to,
        to: firstTarget,
        value: '2',
        inputBytes: 6,
        selector: '0xabcdef01'
      },
      {
        type: 'DELEGATECALL',
        depth: 2,
        from: firstTarget,
        to: delegate,
        value: '0',
        inputBytes: 4,
        selector: '0x12345678',
        failure: expect.stringMatching(/^execution reverted:/)
      },
      {
        type: 'CREATE',
        depth: 1,
        from: transaction.to,
        to: created,
        value: '0',
        inputBytes: 4
      }
    ]
  })
  expect(result.calls[1].failure).toHaveLength(240)
  expect(JSON.stringify(result)).not.toContain('f'.repeat(64))
  expect(result.calls.every((call) => !Object.hasOwn(call, 'input') && !Object.hasOwn(call, 'output'))).toBe(
    true
  )
})

it('includes a correlated top-level contract creation', () => {
  const deployment = { ...transaction, to: undefined, value: '0x0', data: '0x60006000' }
  const created = '0x5555555555555555555555555555555555555555'

  expect(
    parseCallTrace(
      callFrame({
        type: 'CREATE',
        to: created,
        value: deployment.value,
        input: deployment.data
      }),
      deployment
    )
  ).toEqual({
    truncated: false,
    calls: [
      {
        type: 'CREATE',
        depth: 0,
        from: transaction.from,
        to: created,
        value: '0',
        inputBytes: 4
      }
    ]
  })
})

it.each([
  ['sender', callFrame({ from: '0x9999999999999999999999999999999999999999' })],
  ['destination', callFrame({ to: '0x9999999999999999999999999999999999999999' })],
  ['value', callFrame({ value: '0x2' })],
  ['calldata', callFrame({ input: '0x123456' })],
  ['root type', callFrame({ type: 'DELEGATECALL' })],
  ['unknown frame type', callFrame({ calls: [callFrame({ type: 'FUTURECALL' })] })],
  ['malformed address', callFrame({ calls: [callFrame({ from: 'not-an-address' })] })],
  ['malformed input', callFrame({ calls: [callFrame({ input: '0x0' })] })],
  ['malformed children', callFrame({ calls: {} })]
])('rejects an uncorrelated or malformed call trace: %s', (_label, trace) => {
  expect(parseCallTrace(trace, transaction)).toBeUndefined()
})

it('bounds call-trace output, depth, children, and aggregate calldata', () => {
  const repeated = Array.from({ length: 101 }, () => callFrame({ from: transaction.to }))
  expect(parseCallTrace(callFrame({ calls: repeated }), transaction)).toMatchObject({
    truncated: true,
    calls: expect.any(Array)
  })
  expect(parseCallTrace(callFrame({ calls: repeated }), transaction).calls).toHaveLength(100)

  let deep = callFrame({ from: transaction.to })
  for (let depth = 0; depth < 34; depth += 1) {
    deep = callFrame({ from: transaction.to, calls: [deep] })
  }
  expect(parseCallTrace(callFrame({ calls: [deep] }), transaction)).toMatchObject({ truncated: true })

  const tooManyChildren = Array.from({ length: 257 }, () => callFrame({ from: transaction.to }))
  expect(parseCallTrace(callFrame({ calls: tooManyChildren }), transaction)).toMatchObject({
    truncated: true
  })

  const largeInput = `0x${'00'.repeat(128 * 1024)}`
  expect(
    parseCallTrace(
      callFrame({
        calls: Array.from({ length: 4 }, () => callFrame({ from: transaction.to, input: largeInput }))
      }),
      transaction
    )
  ).toBeUndefined()
})

it('strictly parses one successful simulation call', () => {
  expect(parseSimulateResult(simulateSuccess)).toEqual({
    status: 'succeeded',
    source: 'eth_simulateV1',
    gasUsed: '0x5208'
  })

  expect(parseSimulateResult([{ calls: [...simulateSuccess[0].calls, simulateSuccess[0].calls[0]] }])).toBe(
    undefined
  )
  expect(parseSimulateResult([{ calls: [{ ...simulateSuccess[0].calls[0], gasUsed: '0x00' }] }])).toBe(
    undefined
  )
})

it('strictly parses an exact ordered simulation call count', () => {
  const first = simulateSuccess[0].calls[0]
  const second = { ...first, gasUsed: '0x5300' }

  expect(parseSimulateCallsResult([{ calls: [first, second] }], 2)).toEqual([
    { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x5208' },
    { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x5300' }
  ])
  expect(parseSimulateCallsResult([{ calls: [first] }], 2)).toBeUndefined()
  expect(parseSimulateCallsResult([{ calls: [first, { ...second, returnData: '0x0' }] }], 2)).toBeUndefined()
  expect(parseSimulateCallsResult([{ calls: [first] }], 0)).toBeUndefined()
  expect(parseSimulateCallsResult([{ calls: [first] }], 1.5)).toBeUndefined()
  expect(parseSimulateCallsResult([{ calls: Array(17).fill(first) }], 17)).toBeUndefined()
})

it('retains only bounded semantic evidence for nonempty simulation return data', () => {
  const call = simulateSuccess[0].calls[0]
  expect(
    parseSimulateCallsResult(
      [
        {
          calls: [
            { ...call, returnData: `0x${'0'.repeat(63)}1` },
            { ...call, returnData: `0x${'0'.repeat(64)}` },
            { ...call, returnData: '0x1234' }
          ]
        }
      ],
      3
    )
  ).toEqual([
    expect.objectContaining({ returnDataKind: 'abi-bool-true' }),
    expect.objectContaining({ returnDataKind: 'abi-bool-false' }),
    expect.objectContaining({ returnDataKind: 'other' })
  ])
})

it('attaches normalized effects only to a successful eth_simulateV1 result', () => {
  const addressTopic = (address) => `0x${'0'.repeat(24)}${address.slice(2)}`
  const amount = 10n.toString(16).padStart(64, '0')
  const result = parseSimulateResult([
    {
      calls: [
        {
          status: '0x1',
          gasUsed: '0x5208',
          returnData: '0x',
          logs: [
            {
              address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                addressTopic(transaction.from),
                addressTopic(transaction.to)
              ],
              data: `0x${amount}`
            }
          ]
        }
      ]
    }
  ])

  expect(result).toMatchObject({
    status: 'succeeded',
    source: 'eth_simulateV1',
    effects: [
      {
        type: 'transfer',
        standard: 'erc20',
        from: transaction.from,
        to: transaction.to,
        amount: '10'
      }
    ]
  })
})

it('parses a bounded revert result', () => {
  const reason = 'execution reverted: ' + 'x'.repeat(500)
  const result = parseSimulateResult([
    {
      calls: [
        {
          status: '0x0',
          gasUsed: '0x42',
          returnData: '0x',
          error: { code: 3, message: reason }
        }
      ]
    }
  ])

  expect(result).toMatchObject({ status: 'reverted', source: 'eth_simulateV1', gasUsed: '0x42' })
  expect(result.reason).toHaveLength(240)
})

it('uses eth_simulateV1 without falling back when it succeeds', async () => {
  const send = jest.fn((payload, callback) => callback({ id: 1, jsonrpc: '2.0', result: simulateSuccess }))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    advancedChecks: { status: 'partly-unavailable' },
    status: 'succeeded',
    source: 'eth_simulateV1',
    gasUsed: '0x5208',
    nativeBalanceChanges: unsupportedNativeBalanceChanges,
    proxyImplementationCheck: unsupportedProxyImplementationCheck
  })
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(
    {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_simulateV1',
      params: [
        {
          blockStateCalls: [{ calls: [buildSimulationCall(transaction)] }],
          validation: false
        },
        'latest'
      ]
    },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
})

it('publishes a successful core result before bounded advanced checks settle', async () => {
  const traceRequests = []
  let publishCore
  const corePublished = new Promise((resolve) => {
    publishCore = resolve
  })
  const onCoreResult = jest.fn((result) => publishCore(result))
  const send = jest.fn((payload, callback) => {
    if (payload.method === 'eth_simulateV1') {
      callback({ id: payload.id, jsonrpc: '2.0', result: simulateSuccess })
    } else if (payload.method === 'eth_getCode') {
      callback({ id: payload.id, jsonrpc: '2.0', result: '0x' })
    } else if (payload.method === 'debug_traceCall') {
      traceRequests.push({ payload, callback })
    }
  })
  let finalSettled = false
  const pending = simulateTransaction(transaction, { send, onCoreResult }).then((result) => {
    finalSettled = true
    return result
  })

  await expect(corePublished).resolves.toMatchObject({
    status: 'succeeded',
    source: 'eth_simulateV1',
    advancedChecks: { status: 'pending' }
  })
  expect(onCoreResult).toHaveBeenCalledTimes(1)
  expect(onCoreResult.mock.calls[0][0]).not.toHaveProperty('nativeBalanceChanges')
  expect(onCoreResult.mock.calls[0][0]).not.toHaveProperty('proxyImplementationCheck')
  expect(onCoreResult.mock.calls[0][0]).not.toHaveProperty('callTrace')
  expect(finalSettled).toBe(false)
  expect(traceRequests).toHaveLength(2)

  for (const { payload, callback } of traceRequests) {
    const tracer = payload.params[2].tracer
    callback({
      id: payload.id,
      jsonrpc: '2.0',
      result:
        tracer === 'prestateTracer'
          ? { pre: {}, post: {} }
          : callFrame({
              calls: [
                callFrame({
                  from: transaction.to,
                  to: '0x3333333333333333333333333333333333333333'
                })
              ]
            })
    })
  }

  await expect(pending).resolves.toMatchObject({
    status: 'succeeded',
    advancedChecks: { status: 'complete' },
    nativeBalanceChanges: { status: 'succeeded' },
    proxyImplementationCheck: { status: 'succeeded' },
    callTrace: { source: 'debug_traceCall' }
  })
})

it('attaches exact configured-RPC native balance changes after execution succeeds', async () => {
  const send = jest.fn((payload, callback) => {
    const result =
      payload.method === 'eth_getCode'
        ? '0x'
        : payload.method === 'debug_traceCall'
          ? {
              pre: { [transaction.from]: { balance: '0xa' } },
              post: { [transaction.from]: { balance: '0x7' } }
            }
          : simulateSuccess
    callback({ id: payload.id, jsonrpc: '2.0', result })
  })

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'succeeded',
    nativeBalanceChanges: {
      status: 'succeeded',
      source: 'debug_traceCall',
      changes: [{ account: transaction.from, before: '10', after: '7', change: '-3' }]
    }
  })
  expect(send).toHaveBeenCalledWith(
    {
      id: 4,
      jsonrpc: '2.0',
      method: 'debug_traceCall',
      params: [
        buildEthCall(transaction),
        'latest',
        {
          tracer: 'prestateTracer',
          timeout: expect.stringMatching(/^[1-9][0-9]*ms$/),
          tracerConfig: { diffMode: true, disableCode: true, disableStorage: false }
        }
      ]
    },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
})

it('attaches exact configured-RPC ERC-1967 implementation changes after execution succeeds', async () => {
  const before = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const after = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const send = jest.fn((payload, callback) => {
    const tracer = payload.params?.[2]?.tracer
    const result =
      payload.method === 'eth_getCode'
        ? '0x'
        : tracer === 'prestateTracer'
          ? {
              pre: {
                [transaction.to]: {
                  balance: '0x0',
                  storage: { [implementationSlot]: storageAddress(before) }
                }
              },
              post: {
                [transaction.to]: { storage: { [implementationSlot]: storageAddress(after) } }
              }
            }
          : tracer === 'callTracer'
            ? callFrame()
            : simulateSuccess
    callback({ id: payload.id, jsonrpc: '2.0', result })
  })

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'succeeded',
    proxyImplementationCheck: {
      status: 'succeeded',
      source: 'debug_traceCall',
      standard: 'ERC-1967',
      slot: implementationSlot,
      changes: [
        {
          proxy: transaction.to,
          kind: 'changed',
          beforeValue: storageAddress(before),
          afterValue: storageAddress(after),
          beforeImplementation: before,
          afterImplementation: after
        }
      ]
    }
  })
})

it('attaches a correlated configured-RPC call trace after execution succeeds', async () => {
  const internalTarget = '0x3333333333333333333333333333333333333333'
  const trace = callFrame({
    calls: [
      callFrame({
        from: transaction.to,
        to: internalTarget,
        value: '0x0',
        input: '0xabcdef01deadbeef'
      })
    ]
  })
  const send = jest.fn((payload, callback) => {
    const tracer = payload.params?.[2]?.tracer
    const result =
      payload.method === 'eth_getCode'
        ? '0x'
        : tracer === 'prestateTracer'
          ? { pre: {}, post: {} }
          : tracer === 'callTracer'
            ? trace
            : simulateSuccess
    callback({ id: payload.id, jsonrpc: '2.0', result })
  })

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'succeeded',
    callTrace: {
      source: 'debug_traceCall',
      calls: [
        {
          type: 'CALL',
          depth: 1,
          from: transaction.to,
          to: internalTarget,
          value: '0',
          inputBytes: 8,
          selector: '0xabcdef01'
        }
      ]
    }
  })
  expect(send).toHaveBeenCalledWith(
    {
      id: 5,
      jsonrpc: '2.0',
      method: 'debug_traceCall',
      params: [
        buildEthCall(transaction),
        'latest',
        {
          tracer: 'callTracer',
          timeout: expect.stringMatching(/^[1-9][0-9]*ms$/),
          tracerConfig: { onlyTopCall: false, withLog: false }
        }
      ]
    },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
  expect(JSON.stringify((await simulateTransaction(transaction, { send })).callTrace)).not.toContain(
    'deadbeef'
  )
})

it('omits unsupported, malformed, and uncorrelated call-trace evidence', async () => {
  const responses = [
    rpcError(-32601, 'Method not found'),
    { id: 999, jsonrpc: '2.0', result: callFrame() },
    { id: 5, jsonrpc: '1.0', result: callFrame() },
    { id: 5, jsonrpc: '2.0', result: { type: 'CALL' } },
    {
      id: 5,
      jsonrpc: '2.0',
      result: callFrame({ to: '0x9999999999999999999999999999999999999999' })
    }
  ]

  for (const callTraceResponse of responses) {
    const send = jest.fn((payload, callback) => {
      const tracer = payload.params?.[2]?.tracer
      if (payload.method === 'eth_getCode') callback({ id: payload.id, jsonrpc: '2.0', result: '0x' })
      else if (tracer === 'prestateTracer') {
        callback({ id: payload.id, jsonrpc: '2.0', result: { pre: {}, post: {} } })
      } else if (tracer === 'callTracer') callback(callTraceResponse)
      else callback({ id: payload.id, jsonrpc: '2.0', result: simulateSuccess })
    })

    await expect(simulateTransaction(transaction, { send })).resolves.not.toHaveProperty('callTrace')
  }
})

it('qualifies malformed and unsupported native balance traces without weakening execution evidence', async () => {
  const malformed = withAccountCode(
    jest.fn((_payload, callback) => callback({ result: simulateSuccess })),
    {
      result: '0x'
    },
    {
      id: 4,
      jsonrpc: '2.0',
      result: { pre: [], post: {} }
    }
  )
  await expect(simulateTransaction(transaction, { send: malformed })).resolves.toMatchObject({
    status: 'succeeded',
    nativeBalanceChanges: {
      status: 'failed',
      source: 'debug_traceCall',
      reason: 'RPC returned an invalid native balance-change result'
    },
    proxyImplementationCheck: {
      status: 'failed',
      reason: 'RPC returned an invalid or oversized ERC-1967 implementation-slot result'
    }
  })

  const unsupported = withAccountCode(
    jest.fn((_payload, callback) => callback({ result: simulateSuccess })),
    { result: '0x' },
    rpcError(-32004, 'Trace method unavailable')
  )
  await expect(simulateTransaction(transaction, { send: unsupported })).resolves.toMatchObject({
    status: 'succeeded',
    nativeBalanceChanges: unsupportedNativeBalanceChanges,
    proxyImplementationCheck: unsupportedProxyImplementationCheck
  })
})

it('shares the execution timeout budget with native balance tracing', async () => {
  const send = jest.fn((payload, callback) => {
    if (payload.method === 'eth_simulateV1') {
      setTimeout(() => callback({ id: payload.id, jsonrpc: '2.0', result: simulateSuccess }), 20)
    } else if (payload.method === 'eth_getCode') {
      callback({ id: payload.id, jsonrpc: '2.0', result: '0x' })
    }
  })
  const pending = simulateTransaction(transaction, { send, timeoutMs: 25 })

  jest.advanceTimersByTime(20)
  await Promise.resolve()
  jest.advanceTimersByTime(5)

  await expect(pending).resolves.toMatchObject({
    status: 'succeeded',
    nativeBalanceChanges: {
      status: 'unavailable',
      source: 'debug_traceCall',
      reason: 'Native balance-change trace exceeded the simulation time budget'
    },
    proxyImplementationCheck: {
      status: 'unavailable',
      reason: 'ERC-1967 net implementation-slot trace exceeded the simulation time budget'
    }
  })
})

it('does not request native balance tracing when execution does not succeed', async () => {
  const send = jest.fn((payload, callback) => {
    const response =
      payload.method === 'eth_getCode'
        ? { id: payload.id, jsonrpc: '2.0', result: '0x' }
        : rpcError(3, 'execution reverted: denied')
    callback(response)
  })

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'reverted',
    source: 'eth_simulateV1'
  })
  expect(send.mock.calls.map(([payload]) => payload.method)).not.toContain('debug_traceCall')
})

it('attaches exact configured-RPC delegation evidence for the selected sender', async () => {
  const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const send = jest.fn((payload, callback) => {
    const account = payload.params?.[0]
    callback({
      id: payload.id,
      jsonrpc: '2.0',
      result:
        payload.method !== 'eth_getCode'
          ? simulateSuccess
          : account === transaction.from
            ? `0xef0100${delegate.slice(2)}`
            : account === delegate
              ? '0x6000'
              : '0x'
    })
  })

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'succeeded',
    delegation: {
      status: 'delegated',
      source: 'eth_getCode',
      account: transaction.from,
      delegate
    },
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: {
        status: 'delegated',
        role: 'sender',
        account: transaction.from,
        delegate,
        delegateCodeStatus: 'contract',
        delegateCodeHash: expect.any(String)
      },
      targets: [{ status: 'no-code', role: 'target', account: transaction.to, callIndexes: [0] }]
    }
  })
  expect(send).toHaveBeenCalledWith(
    {
      id: 30,
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [transaction.from, 'latest']
    },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
})

it('distinguishes a nondelegated sender from a delegated transaction recipient', async () => {
  const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const send = jest.fn((payload, callback) => {
    const account = payload.params?.[0]
    callback({
      id: payload.id,
      jsonrpc: '2.0',
      result:
        payload.method !== 'eth_getCode'
          ? simulateSuccess
          : account === transaction.to
            ? `0xef0100${delegate.slice(2)}`
            : account === delegate
              ? '0x6000'
              : '0x'
    })
  })

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'succeeded',
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: { status: 'no-code', role: 'sender', account: transaction.from },
      targets: [
        {
          status: 'delegated',
          role: 'target',
          account: transaction.to,
          callIndexes: [0],
          delegate,
          delegateCodeStatus: 'contract',
          delegateCodeHash: expect.any(String)
        }
      ]
    }
  })
})

it('reports malformed configured-RPC account code as unavailable', async () => {
  const send = jest.fn((payload, callback) =>
    callback({
      id: payload.id,
      jsonrpc: '2.0',
      result: payload.method === 'eth_getCode' ? 'not-code' : simulateSuccess
    })
  )

  await expect(simulateTransaction(transaction, { send })).resolves.toMatchObject({
    status: 'succeeded',
    delegation: {
      status: 'unavailable',
      source: 'eth_getCode',
      reason: 'RPC returned invalid account code'
    }
  })
})

it('bounds a nonresponsive account delegation check without weakening execution evidence', async () => {
  const send = jest.fn((payload, callback) => {
    if (payload.method === 'eth_simulateV1') {
      callback({ id: payload.id, jsonrpc: '2.0', result: simulateSuccess })
    }
  })
  const pending = simulateTransaction(transaction, { send, timeoutMs: 25 })

  jest.advanceTimersByTime(25)

  await expect(pending).resolves.toMatchObject({
    status: 'succeeded',
    source: 'eth_simulateV1',
    delegation: {
      status: 'unavailable',
      source: 'eth_getCode',
      reason: 'Account code check timed out'
    }
  })
})

it.each([-32601, -32004])('falls back to eth_call for unsupported-method code %s', async (code) => {
  const send = jest
    .fn()
    .mockImplementationOnce((_payload, callback) => callback(rpcError(code, 'Method unsupported')))
    .mockImplementationOnce((_payload, callback) => callback({ id: 1, jsonrpc: '2.0', result: '0x' }))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    advancedChecks: { status: 'partly-unavailable' },
    status: 'succeeded',
    source: 'eth_call',
    nativeBalanceChanges: unsupportedNativeBalanceChanges,
    proxyImplementationCheck: unsupportedProxyImplementationCheck
  })
  expect(send.mock.calls[1][0]).toEqual({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [buildEthCall(transaction), 'latest']
  })
})

it('does not mask invalid simulation parameters with a fallback', async () => {
  const send = jest.fn((_payload, callback) => callback(rpcError(-32602, 'Invalid parameters')))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'failed',
    source: 'eth_simulateV1',
    reason: 'Invalid parameters'
  })
  expect(send).toHaveBeenCalledTimes(1)
})

it('reports an eth_call revert after fallback', async () => {
  const send = jest
    .fn()
    .mockImplementationOnce((_payload, callback) => callback(rpcError(-32601, 'Method not found')))
    .mockImplementationOnce((_payload, callback) => callback(rpcError(3, 'execution reverted: denied')))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'reverted',
    source: 'eth_call',
    reason: 'execution reverted: denied'
  })
})

it('reports unsupported fallback as unavailable', async () => {
  const send = jest.fn((_payload, callback) => callback(rpcError(-32601, 'Method not found')))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'unavailable',
    source: 'eth_call',
    reason: 'RPC execution check is unsupported'
  })
  expect(send).toHaveBeenCalledTimes(2)
})

it('fails closed on malformed simulation output', async () => {
  const send = jest.fn((_payload, callback) => callback({ id: 1, jsonrpc: '2.0', result: [{ calls: [] }] }))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'failed',
    source: 'eth_simulateV1',
    reason: 'RPC returned an invalid simulation result'
  })
  expect(send).toHaveBeenCalledTimes(1)
})

it('fails closed on malformed provider callbacks and chain IDs', async () => {
  const send = jest.fn((_payload, callback) => callback(undefined))

  await expect(simulateTransaction(transaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'failed',
    source: 'eth_simulateV1',
    reason: 'RPC returned an invalid response'
  })
  await expect(simulateTransaction({ ...transaction, chainId: '0x01' }, { send })).resolves.toEqual({
    status: 'failed',
    reason: 'Transaction has an invalid chain ID'
  })
  expect(send).toHaveBeenCalledTimes(1)
})

it('bounds a request that never receives an RPC response', async () => {
  const pending = simulateTransaction(transaction, { send: withAccountCode(jest.fn()), timeoutMs: 25 })

  jest.advanceTimersByTime(25)

  await expect(pending).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'failed',
    source: 'eth_simulateV1',
    reason: 'RPC execution check timed out'
  })
})

it('shares one timeout budget with the fallback call', async () => {
  const send = jest
    .fn()
    .mockImplementationOnce((_payload, callback) =>
      setTimeout(() => callback(rpcError(-32601, 'Method not found')), 20)
    )
    .mockImplementationOnce(() => {})
  const pending = simulateTransaction(transaction, { send: withAccountCode(send), timeoutMs: 25 })

  jest.advanceTimersByTime(20)
  await Promise.resolve()
  jest.advanceTimersByTime(5)

  await expect(pending).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    status: 'failed',
    source: 'eth_call',
    reason: 'RPC execution check timed out'
  })
})

describe('wallet call batches', () => {
  const secondTransaction = {
    ...transaction,
    nonce: '0x8',
    to: '0x3333333333333333333333333333333333333333',
    value: '0x2',
    data: '0xabcd'
  }
  const walletAccountCodeEvidence = {
    source: 'configured-rpc',
    sender: noCodeEvidence(transaction.from, 'sender'),
    targets: [
      noCodeEvidence(transaction.to, 'target', [0]),
      noCodeEvidence(secondTransaction.to, 'target', [1])
    ]
  }

  it('simulates all calls in one ordered evolving-state request', async () => {
    const result = [
      {
        calls: [simulateSuccess[0].calls[0], { ...simulateSuccess[0].calls[0], gasUsed: '0x5300' }]
      }
    ]
    const send = jest.fn((payload, callback) => callback({ id: 1, jsonrpc: '2.0', result }))

    await expect(
      simulateWalletCalls([transaction, secondTransaction], { send: withAccountCode(send) })
    ).resolves.toEqual({
      accountCodeEvidence: walletAccountCodeEvidence,
      status: 'succeeded',
      source: 'eth_simulateV1',
      calls: [
        { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x5208' },
        { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x5300' }
      ]
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_simulateV1',
        params: [
          {
            blockStateCalls: [
              { calls: [buildSimulationCall(transaction), buildSimulationCall(secondTransaction)] }
            ],
            validation: false
          },
          'latest'
        ]
      },
      expect.any(Function),
      { type: 'ethereum', id: 1 }
    )
  })

  it('reports an ordered mixed batch as reverted', async () => {
    const send = jest.fn((_payload, callback) =>
      callback({
        id: 1,
        jsonrpc: '2.0',
        result: [
          {
            calls: [
              simulateSuccess[0].calls[0],
              {
                status: '0x0',
                gasUsed: '0x42',
                returnData: '0x',
                error: { code: 3, message: 'execution reverted: denied' }
              }
            ]
          }
        ]
      })
    )

    const result = await simulateWalletCalls([transaction, secondTransaction], {
      send: withAccountCode(send)
    })
    expect(result.status).toBe('reverted')
    expect(result.calls).toEqual([
      { status: 'succeeded', source: 'eth_simulateV1', gasUsed: '0x5208' },
      {
        status: 'reverted',
        source: 'eth_simulateV1',
        gasUsed: '0x42',
        reason: 'execution reverted: denied'
      }
    ])
  })

  it('attaches delegated sender evidence to a wallet-call batch', async () => {
    const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = [
      {
        calls: [simulateSuccess[0].calls[0], simulateSuccess[0].calls[0]]
      }
    ]
    const send = jest.fn((payload, callback) =>
      callback({
        id: payload.id,
        jsonrpc: '2.0',
        result:
          payload.method !== 'eth_getCode'
            ? result
            : payload.params[0] === transaction.from
              ? `0xef0100${delegate.slice(2)}`
              : payload.params[0] === delegate
                ? '0x6000'
                : '0x'
      })
    )

    await expect(simulateWalletCalls([transaction, secondTransaction], { send })).resolves.toMatchObject({
      status: 'succeeded',
      delegation: { status: 'delegated', account: transaction.from, delegate }
    })
  })

  it('maps each delegated wallet-call target and preserves duplicate call indexes', async () => {
    const delegate = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const duplicateTarget = { ...secondTransaction, to: transaction.to }
    const result = [
      {
        calls: [simulateSuccess[0].calls[0], simulateSuccess[0].calls[0]]
      }
    ]
    const send = jest.fn((payload, callback) =>
      callback({
        id: payload.id,
        jsonrpc: '2.0',
        result:
          payload.method !== 'eth_getCode'
            ? result
            : payload.params[0] === transaction.to
              ? `0xef0100${delegate.slice(2)}`
              : payload.params[0] === delegate
                ? '0x6000'
                : '0x'
      })
    )

    await expect(simulateWalletCalls([transaction, duplicateTarget], { send })).resolves.toMatchObject({
      status: 'succeeded',
      accountCodeEvidence: {
        sender: { status: 'no-code', account: transaction.from },
        targets: [
          {
            status: 'delegated',
            account: transaction.to,
            delegate,
            delegateCodeStatus: 'contract',
            callIndexes: [0, 1]
          }
        ]
      }
    })
    expect(send.mock.calls.filter(([payload]) => payload.method === 'eth_getCode')).toHaveLength(3)
  })

  it('does not substitute independent eth_call checks when stateful simulation is unsupported', async () => {
    const send = jest.fn((_payload, callback) => callback(rpcError(-32601, 'Method not found')))

    await expect(
      simulateWalletCalls([transaction, secondTransaction], { send: withAccountCode(send) })
    ).resolves.toEqual({
      accountCodeEvidence: walletAccountCodeEvidence,
      status: 'unavailable',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Configured RPC does not support stateful wallet call simulation'
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('fails closed on malformed result counts and RPC errors', async () => {
    const malformed = jest.fn((_payload, callback) =>
      callback({ id: 1, jsonrpc: '2.0', result: simulateSuccess })
    )
    await expect(
      simulateWalletCalls([transaction, secondTransaction], { send: withAccountCode(malformed) })
    ).resolves.toEqual({
      accountCodeEvidence: walletAccountCodeEvidence,
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'RPC returned an invalid batch simulation result'
    })

    const failed = jest.fn((_payload, callback) => callback(rpcError(-32000, 'batch failed')))
    await expect(
      simulateWalletCalls([transaction, secondTransaction], { send: withAccountCode(failed) })
    ).resolves.toEqual({
      accountCodeEvidence: walletAccountCodeEvidence,
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'batch failed'
    })
  })

  it('rejects bounded, sender, and chain input violations before RPC', async () => {
    const send = jest.fn()
    const tooMany = Array.from({ length: 17 }, () => transaction)

    await expect(simulateWalletCalls([], { send })).resolves.toMatchObject({ status: 'failed', calls: [] })
    await expect(simulateWalletCalls(tooMany, { send })).resolves.toMatchObject({
      status: 'failed',
      calls: []
    })
    await expect(simulateWalletCalls([{ ...transaction, chainId: '0x01' }], { send })).resolves.toMatchObject(
      { status: 'failed', calls: [] }
    )
    await expect(simulateWalletCalls([{ ...transaction, from: undefined }], { send })).resolves.toMatchObject(
      { status: 'failed', calls: [] }
    )
    await expect(
      simulateWalletCalls(
        [transaction, { ...secondTransaction, from: '0x4444444444444444444444444444444444444444' }],
        {
          send
        }
      )
    ).resolves.toMatchObject({ status: 'failed', calls: [] })
    await expect(
      simulateWalletCalls([transaction, { ...secondTransaction, chainId: '0xa' }], { send })
    ).resolves.toMatchObject({ status: 'failed', calls: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('uses one bounded timeout for a nonresponsive batch RPC', async () => {
    const pending = simulateWalletCalls([transaction, secondTransaction], {
      send: withAccountCode(jest.fn()),
      timeoutMs: 25
    })
    jest.advanceTimersByTime(25)

    await expect(pending).resolves.toEqual({
      accountCodeEvidence: walletAccountCodeEvidence,
      status: 'failed',
      source: 'eth_simulateV1',
      calls: [],
      reason: 'Stateful wallet call simulation timed out'
    })
  })

  it('attaches pre-state allowance evidence only to the first call', async () => {
    const send = jest.fn((payload, callback) => {
      if (payload.method === 'eth_simulateV1') {
        return callback({
          id: 1,
          jsonrpc: '2.0',
          result: [
            {
              calls: [simulateSuccess[0].calls[0], simulateSuccess[0].calls[0]]
            }
          ]
        })
      }

      callback({ id: payload.id, jsonrpc: '2.0', result: `0x${'0'.repeat(63)}7` })
    })

    const laterApproval = { ...approvalTransaction, nonce: '0x8' }
    const result = await simulateWalletCalls([approvalTransaction, laterApproval], {
      send: withAccountCode(send)
    })
    expect(result.calls[0].allowance).toMatchObject({
      source: 'eth_call',
      token: approvalTransaction.to,
      owner: approvalTransaction.from,
      spender: approvalSpender,
      currentAmount: '7',
      requestedAmount: '42'
    })
    expect(result.calls[1].allowance).toBeUndefined()
    expect(send.mock.calls.find(([payload]) => payload.method === 'eth_call')[0].id).toBe(2)
    expect(send.mock.calls.filter(([payload]) => payload.method === 'eth_call')).toHaveLength(1)
  })
})

it('attaches an exact configured-RPC allowance read to an approval simulation', async () => {
  const currentAmount = 7n
  const send = jest.fn((payload, callback) => {
    if (payload.method === 'eth_simulateV1') {
      callback({ id: payload.id, jsonrpc: '2.0', result: simulateSuccess })
    } else {
      callback({
        id: payload.id,
        jsonrpc: '2.0',
        result: `0x${currentAmount.toString(16).padStart(64, '0')}`
      })
    }
  })

  await expect(simulateTransaction(approvalTransaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    advancedChecks: { status: 'partly-unavailable' },
    status: 'succeeded',
    source: 'eth_simulateV1',
    gasUsed: '0x5208',
    allowance: {
      source: 'eth_call',
      token: transaction.to,
      owner: transaction.from,
      spender: approvalSpender,
      currentAmount: '7',
      requestedAmount: '42'
    },
    nativeBalanceChanges: unsupportedNativeBalanceChanges,
    proxyImplementationCheck: unsupportedProxyImplementationCheck
  })
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1][0]).toEqual({
    id: 2,
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [
      {
        to: transaction.to,
        data: `0xdd62ed3e${'0'.repeat(24)}${transaction.from.slice(2)}${'0'.repeat(
          24
        )}${approvalSpender.slice(2)}`
      },
      'latest'
    ]
  })
})

it.each([
  { result: '0x1' },
  { result: `0x${'00'.repeat(33)}` },
  { error: { code: 3, message: 'execution reverted' } }
])('omits unusable allowance evidence without weakening execution status: %p', async (response) => {
  const send = jest.fn((payload, callback) =>
    callback(
      payload.method === 'eth_simulateV1'
        ? { id: payload.id, jsonrpc: '2.0', result: simulateSuccess }
        : { id: payload.id, jsonrpc: '2.0', ...response }
    )
  )

  await expect(simulateTransaction(approvalTransaction, { send: withAccountCode(send) })).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    advancedChecks: { status: 'partly-unavailable' },
    status: 'succeeded',
    source: 'eth_simulateV1',
    gasUsed: '0x5208',
    nativeBalanceChanges: unsupportedNativeBalanceChanges,
    proxyImplementationCheck: unsupportedProxyImplementationCheck
  })
})

it('bounds a missing allowance response without changing a successful execution result', async () => {
  const send = jest.fn((payload, callback) => {
    if (payload.method === 'eth_simulateV1') {
      callback({ id: payload.id, jsonrpc: '2.0', result: simulateSuccess })
    }
  })
  const pending = simulateTransaction(approvalTransaction, {
    send: withAccountCode(send),
    timeoutMs: 25
  })

  jest.advanceTimersByTime(25)

  await expect(pending).resolves.toEqual({
    accountCodeEvidence: transactionAccountCodeEvidence,
    advancedChecks: { status: 'partly-unavailable' },
    status: 'succeeded',
    source: 'eth_simulateV1',
    gasUsed: '0x5208',
    nativeBalanceChanges: {
      status: 'unavailable',
      source: 'debug_traceCall',
      reason: 'Native balance-change trace exceeded the simulation time budget'
    },
    proxyImplementationCheck: {
      status: 'unavailable',
      source: 'debug_traceCall',
      standard: 'ERC-1967',
      slot: implementationSlot,
      reason: 'ERC-1967 net implementation-slot trace exceeded the simulation time budget'
    }
  })
})
