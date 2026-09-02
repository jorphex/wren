import fs from 'fs'
import path from 'path'

import { Interface } from 'ethers'

import { inspect, InspectorInvokeResultSchema, projectInspectorSimulation } from '../../../main/inspector'
import { decodeLocalCalldata } from '../../../main/inspector/localDecode'

const sender = '0x0000000000000000000000000000000000000001'
const target = '0x0000000000000000000000000000000000000002'
const recipient = '0x0000000000000000000000000000000000000003'
const erc20 = new Interface(['function transfer(address to,uint256 amount)'])
const transfer = erc20.encodeFunctionData('transfer', [recipient, 7n])

const readOnlyRpc = () => {
  const requests: Array<{ method: string; target: { type: string; id: number } }> = []
  const send = jest.fn((payload, callback, targetChain) => {
    requests.push({ method: payload.method, target: targetChain })
    if (payload.method === 'eth_simulateV1') {
      callback({ id: payload.id, jsonrpc: '2.0', error: { code: -32601, message: 'unsupported' } })
    } else if (payload.method === 'eth_call' || payload.method === 'eth_getCode') {
      callback({ id: payload.id, jsonrpc: '2.0', result: '0x' })
    } else {
      callback({ id: payload.id, jsonrpc: '2.0', error: { code: -32601, message: 'unsupported' } })
    }
  })
  return { requests, send }
}

test('refuses current-state simulation for a non-latest JSON-RPC block selector', async () => {
  const rpc = readOnlyRpc()
  const result = await inspect(
    {
      kind: 'json-rpc',
      chainId: '0x1',
      input: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ from: sender, to: target, data: transfer }, 'safe']
      })
    },
    { send: rpc.send, timeoutMs: 100 }
  )

  expect(result).toMatchObject({
    success: true,
    inspection: {
      kind: 'transaction',
      source: 'json-rpc',
      sourceMethod: 'eth_call',
      normalized: { chainId: '0x1', from: sender, to: target, requestedBlock: 'safe' },
      decode: { status: 'decoded', method: 'transfer' }
    }
  })
  expect(rpc.requests).toHaveLength(0)
  if (!result.success || result.inspection.kind === 'typed-data') throw new Error('transaction expected')
  expect(result.inspection).not.toHaveProperty('simulation')
  expect(result.inspection.evidence).toContainEqual(
    expect.objectContaining({
      kind: 'simulation',
      status: 'unavailable',
      reason: expect.stringMatching(/does not simulate requested block safe.*no simulation result/i)
    })
  )
})

test('rejects unsupported JSON-RPC instead of forwarding it', async () => {
  const rpc = readOnlyRpc()
  const secret = `0x${'ab'.repeat(32)}`
  const result = await inspect(
    {
      kind: 'json-rpc',
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [secret] })
    },
    { send: rpc.send }
  )

  expect(result).toEqual({ success: false, error: 'JSON-RPC method is not supported by the inspector' })
  expect(rpc.send).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toContain(secret)
})

test('keeps incomplete calldata local and states missing simulation context', async () => {
  const rpc = readOnlyRpc()
  const result = await inspect({ kind: 'calldata', data: transfer }, { send: rpc.send })

  expect(result).toMatchObject({
    success: true,
    inspection: {
      kind: 'calldata',
      missingContext: ['chainId', 'from', 'to'],
      decode: { status: 'decoded', source: 'bundled-standard-abi', method: 'transfer' },
      evidence: expect.arrayContaining([
        expect.objectContaining({ kind: 'simulation', status: 'unavailable' })
      ])
    }
  })
  expect(rpc.send).not.toHaveBeenCalled()
})

test('returns exact canonical typed data, local risks, and honest absent request context', async () => {
  const rpc = readOnlyRpc()
  const typedData = {
    types: {
      Mail: [{ name: 'contents', type: 'string' }],
      EIP712Domain: [{ name: 'name', type: 'string' }]
    },
    primaryType: 'Mail',
    domain: { name: 'Wren test' },
    message: { contents: 'inspect every field' }
  }
  const result = await inspect(
    { kind: 'typed-data', input: JSON.stringify(typedData), version: 'V4' },
    { send: rpc.send }
  )

  expect(result).toMatchObject({
    success: true,
    inspection: {
      kind: 'typed-data',
      source: 'direct',
      missingContext: ['chainId', 'signer'],
      normalized: { version: 'V4', primaryType: 'Mail' },
      typedContext: { risks: ['domain-chain-missing'] }
    }
  })
  if (!result.success || result.inspection.kind !== 'typed-data') throw new Error('typed result expected')
  expect(JSON.parse(result.inspection.normalized.typedData)).toEqual(typedData)
  expect(result.inspection.typedContext.risks).not.toContain('domain-chain-mismatch')
  expect(rpc.send).not.toHaveBeenCalled()
})

test('never presents rounded typed-data numbers as exact evidence', async () => {
  const rpc = readOnlyRpc()
  const input =
    '{"types":{"EIP712Domain":[],"Transfer":[{"name":"amount","type":"uint256"}]},' +
    '"primaryType":"Transfer","domain":{},"message":{"amount":9007199254740993}}'
  const result = await inspect({ kind: 'typed-data', input, version: 'V4' }, { send: rpc.send })

  expect(result).toEqual({
    success: false,
    error: 'EIP-712 typed data contains an unsafe JSON number; use a quoted integer'
  })
  expect(rpc.send).not.toHaveBeenCalled()
})

test('rejects typed request chain IDs outside configured-RPC numeric range', async () => {
  const rpc = readOnlyRpc()
  const typedData = {
    types: {
      Mail: [{ name: 'contents', type: 'string' }],
      EIP712Domain: []
    },
    primaryType: 'Mail',
    domain: {},
    message: { contents: 'hello' }
  }
  const result = await inspect(
    {
      kind: 'typed-data',
      input: JSON.stringify(typedData),
      chainId: '0x20000000000000'
    },
    { send: rpc.send }
  )

  expect(result).toEqual({
    success: false,
    error: 'inspector chainId exceeds the supported safe-integer range'
  })
  expect(rpc.send).not.toHaveBeenCalled()
})

test('preserves a bounded access-list summary without returning storage keys', async () => {
  const rpc = readOnlyRpc()
  const storageKey = `0x${'11'.repeat(32)}`
  const result = await inspect(
    {
      kind: 'transaction',
      input: JSON.stringify({
        chainId: '0x1',
        type: '0x1',
        from: sender,
        to: target,
        data: '0x',
        accessList: [{ address: target, storageKeys: [storageKey] }]
      })
    },
    { send: rpc.send, timeoutMs: 100 }
  )

  expect(result).toMatchObject({
    success: true,
    inspection: { normalized: { accessList: { addresses: 1, storageKeys: 1 } } }
  })
  expect(JSON.stringify(result)).not.toContain(storageKey)
})

test('simulates contract creation but never labels initcode as a decoded function call', async () => {
  const rpc = readOnlyRpc()
  const result = await inspect(
    {
      kind: 'transaction',
      input: JSON.stringify({ chainId: '0x1', from: sender, data: transfer })
    },
    { send: rpc.send, timeoutMs: 100 }
  )

  expect(result).toMatchObject({
    success: true,
    inspection: {
      kind: 'transaction',
      normalized: { to: null },
      decode: {
        status: 'unavailable',
        reason: 'Contract-creation initcode is not decoded as function calldata'
      },
      simulation: { status: 'succeeded' }
    }
  })
  expect(rpc.send).toHaveBeenCalled()
})

test('uses only bundled ABI data and bounds decoded dynamic values', () => {
  expect(decodeLocalCalldata(transfer)).toMatchObject({
    status: 'decoded',
    selector: '0xa9059cbb',
    signature: 'transfer(address,uint256)',
    arguments: [
      { name: 'to', type: 'address', value: recipient },
      { name: 'amount', type: 'uint256', value: '7' }
    ]
  })
  expect(decodeLocalCalldata('0x12345678')).toEqual({
    status: 'unknown',
    source: 'bundled-standard-abi',
    selector: '0x12345678',
    reason: "Selector is not in Wren's bundled standard ABI set"
  })
})

test('decodes standard ERC-4626 vault methods without a network ABI lookup', () => {
  const vault = new Interface([
    'function withdraw(uint256 assets,address receiver,address owner) returns (uint256 shares)'
  ])
  const calldata = vault.encodeFunctionData('withdraw', [7n, recipient, sender])

  expect(decodeLocalCalldata(calldata)).toMatchObject({
    status: 'decoded',
    method: 'withdraw',
    signature: 'withdraw(uint256,address,address)',
    arguments: [
      { name: 'assets', type: 'uint256', value: '7' },
      { name: 'receiver', type: 'address', value: recipient },
      { name: 'owner', type: 'address', value: sender }
    ]
  })
})

test('projects full production simulation evidence into the exact bounded result schema', () => {
  const simulation = projectInspectorSimulation({
    status: 'succeeded',
    source: 'eth_simulateV1',
    gasUsed: '0x5208',
    effects: [
      { type: 'transfer', standard: 'erc20', token: target, from: sender, to: recipient, amount: '7' }
    ],
    allowance: {
      source: 'eth_call',
      token: target,
      owner: sender,
      spender: recipient,
      currentAmount: '1',
      requestedAmount: '7'
    },
    delegation: { source: 'eth_getCode', status: 'delegated', account: sender, delegate: target },
    accountCodeEvidence: {
      source: 'configured-rpc',
      sender: {
        source: 'eth_getCode',
        trust: 'configured-rpc',
        role: 'sender',
        account: sender,
        status: 'contract',
        codeHash: `0x${'11'.repeat(32)}`
      },
      targets: [
        {
          source: 'eth_getCode',
          trust: 'configured-rpc',
          role: 'target',
          account: target,
          status: 'delegated',
          codeHash: `0x${'22'.repeat(32)}`,
          authority: target,
          delegate: recipient,
          delegateCodeStatus: 'contract',
          delegateCodeHash: `0x${'33'.repeat(32)}`,
          callIndexes: [0]
        }
      ]
    },
    nativeBalanceChanges: {
      source: 'debug_traceCall',
      status: 'succeeded',
      changes: [{ account: sender, before: '10', after: '3', change: '-7' }]
    },
    callTrace: {
      source: 'debug_traceCall',
      calls: [
        {
          type: 'CALL',
          depth: 1,
          from: target,
          to: recipient,
          value: '7',
          inputBytes: 4,
          selector: '0x12345678'
        }
      ]
    },
    proxyImplementationCheck: {
      source: 'debug_traceCall',
      standard: 'ERC-1967',
      slot: `0x${'44'.repeat(32)}`,
      status: 'succeeded',
      changes: [
        {
          proxy: target,
          kind: 'changed',
          beforeValue: `0x${'00'.repeat(32)}`,
          afterValue: `0x${'00'.repeat(12)}${recipient.slice(2)}`,
          afterImplementation: recipient
        }
      ]
    },
    advancedChecks: { status: 'complete' }
  })

  expect(
    InspectorInvokeResultSchema.safeParse({
      success: true,
      inspection: {
        kind: 'transaction',
        source: 'direct',
        normalized: { type: '0x0', from: sender, to: target, chainId: '0x1', data: transfer },
        decode: decodeLocalCalldata(transfer),
        evidence: [
          { kind: 'calldata', status: 'available', source: 'local' },
          { kind: 'simulation', status: 'available', source: 'configured-rpc' }
        ],
        missingContext: [],
        simulation
      }
    }).success
  ).toBe(true)
  expect(simulation.callTrace?.calls[0]?.value).toBe('7')
})

test('inspector implementation has no signer, request-admission, reveal, persistence, or broadcast imports', () => {
  const directory = path.resolve(__dirname, '../../../main/inspector')
  const source = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(path.join(directory, name), 'utf8'))
    .join('\n')

  expect(source).not.toMatch(/from ['"][^'"]*(?:accounts|provider|signers|reveal|store|externalData)/)
  expect(source).not.toMatch(/sendRawTransaction|signTransaction|broadcast|persist\s*\(/)
})
