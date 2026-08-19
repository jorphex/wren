import {
  InspectorInputSchema,
  MAX_INSPECTOR_INPUT_BYTES,
  parseEip712TypedData,
  parseInspectorInput,
  parseInspectorJsonRpcRequest,
  parseUnsignedTransaction
} from '../../../../resources/domain/inspector'
import { getTypedDataContext, parseTypedMessage } from '../../../../resources/domain/typedData'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

const account = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const target = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const storageKey = `0x${'CC'.repeat(32)}`

const typedData = (chainId: number | string = 1) => ({
  types: {
    EIP712Domain: [{ name: 'chainId', type: 'uint256' }],
    Transfer: [
      { name: 'to', type: 'address' },
      { name: 'amounts', type: 'uint256[]' }
    ]
  },
  primaryType: 'Transfer',
  domain: { chainId },
  message: { to: target, amounts: ['1'] }
})

test('normalizes a bounded unsigned type-2 transaction without inventing context', () => {
  expect(
    parseInspectorInput({
      kind: 'transaction',
      input: JSON.stringify({
        from: account,
        to: target,
        data: '0xAABB',
        value: '0xA',
        gasLimit: '0x5208',
        maxPriorityFeePerGas: '0x1',
        maxFeePerGas: '0x2',
        accessList: [{ address: target, storageKeys: [storageKey] }]
      })
    })
  ).toEqual({
    kind: 'transaction',
    transaction: {
      from: account.toLowerCase(),
      to: target.toLowerCase(),
      data: '0xaabb',
      value: '0xa',
      gas: '0x5208',
      maxPriorityFeePerGas: '0x1',
      maxFeePerGas: '0x2',
      type: '0x2',
      accessList: [{ address: target.toLowerCase(), storageKeys: [storageKey.toLowerCase()] }]
    },
    source: { kind: 'direct' }
  })
})

test.each([
  ['unknown field', { to: target, input: '0x' }],
  ['noncanonical quantity', { to: target, value: '0x00' }],
  ['overflowing nonce', { nonce: `0x1${'0'.repeat(64)}` }],
  ['overflowing gas', { gas: `0x1${'0'.repeat(64)}` }],
  ['odd calldata', { to: target, data: '0x123' }],
  ['bad address', { to: '0x1234' }],
  ['gas aliases together', { gas: '0x1', gasLimit: '0x1' }],
  ['mixed fees', { gasPrice: '0x1', maxFeePerGas: '0x2' }],
  ['priority above max fee', { maxPriorityFeePerGas: '0x3', maxFeePerGas: '0x2' }],
  ['noncanonical type', { type: '0x01' }],
  ['legacy access list', { type: '0x0', accessList: [] }],
  ['malformed access list', { type: '0x1', accessList: [{ address: target, storageKeys: [], extra: true }] }],
  ['type-1 1559 fees', { type: '0x1', maxFeePerGas: '0x2' }],
  ['type-2 legacy fee', { type: '0x2', gasPrice: '0x1' }],
  ['future type', { type: '0x3' }],
  ['zero chain', { chainId: '0x0' }],
  ['unsafe chain', { chainId: '0x20000000000000' }]
])('rejects transaction %s', (_label, value) => {
  expect(() => parseUnsignedTransaction(value)).toThrow()
})

test('normalizes standard null and omitted contract-creation destinations identically', () => {
  expect(parseUnsignedTransaction({ to: null, data: '0x6000' })).toEqual({
    data: '0x6000',
    type: '0x0'
  })
  expect(parseUnsignedTransaction({ data: '0x6000' })).toEqual({ data: '0x6000', type: '0x0' })
})

test('bounds access-list entries at the inspector boundary', () => {
  const entry = { address: target, storageKeys: [] }
  expect(() => parseUnsignedTransaction({ type: '0x1', accessList: Array(257).fill(entry) })).toThrow(
    /256 entries/
  )
})

test('requires embedded and supplied transaction chains to agree', () => {
  expect(parseUnsignedTransaction({ chainId: '0x1' }, '0x1').chainId).toBe('0x1')
  expect(() => parseUnsignedTransaction({ chainId: '0x1' }, '0x2')).toThrow(/does not match/)
})

test('normalizes explicit calldata context while allowing honestly missing context', () => {
  expect(parseInspectorInput({ kind: 'calldata', data: '0xAABB' })).toEqual({
    kind: 'calldata',
    context: { data: '0xaabb' },
    source: { kind: 'direct' }
  })
  expect(
    parseInspectorInput({
      kind: 'calldata',
      data: '0x',
      chainId: '0x1',
      from: account,
      to: target,
      value: '0x0'
    })
  ).toMatchObject({
    context: {
      data: '0x',
      chainId: '0x1',
      from: account.toLowerCase(),
      to: target.toLowerCase(),
      value: '0x0'
    }
  })
  expect(() => parseInspectorInput({ kind: 'calldata', data: '0x', chainId: '0x20000000000000' })).toThrow(
    /safe-integer/
  )
})

test.each([
  ['1', '0x1'],
  ['10', '0xa'],
  ['0x1', '0x1'],
  ['0xA', '0xa']
])('normalizes canonical decimal or hexadecimal chain context %s', (chainId, expected) => {
  expect(parseInspectorInput({ kind: 'calldata', data: '0x', chainId })).toMatchObject({
    context: { chainId: expected }
  })
  expect(
    parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(typedData()), chainId })
  ).toMatchObject({ chainId: expected })
  expect(
    parseInspectorInput({
      kind: 'json-rpc',
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{}] }),
      chainId
    })
  ).toMatchObject({ transaction: { chainId: expected } })
})

test.each([
  '0',
  '00',
  '01',
  '+1',
  '-1',
  ' 1',
  '1 ',
  '1.0',
  '0x0',
  '0x00',
  '0x01',
  '0X1',
  '0xg',
  '9007199254740992',
  '0x20000000000000'
])('rejects invalid or unsafe chain context %s', (chainId) => {
  expect(() => parseInspectorInput({ kind: 'calldata', data: '0x', chainId })).toThrow()
})

test('reuses production EIP-712 validation and keeps request-chain context separate from domain evidence', () => {
  const domainOnly = parseInspectorInput({ kind: 'typed-data', input: JSON.stringify(typedData(1)) })
  expect(domainOnly).not.toHaveProperty('chainId')

  const mismatch = parseInspectorInput({
    kind: 'typed-data',
    input: JSON.stringify(typedData(1)),
    chainId: '0xA',
    version: 'V4'
  })
  expect(mismatch).toMatchObject({ kind: 'typed-data', chainId: '0xa', version: 'V4' })
  expect(mismatch.kind === 'typed-data' && mismatch.typedData.domain['chainId']).toBe(1)
  if (mismatch.kind !== 'typed-data') throw new Error('Expected typed-data subject')
  expect(
    getTypedDataContext(
      parseTypedMessage(mismatch.typedData, SignTypedDataVersion.V4),
      Number(BigInt(mismatch.chainId as string))
    ).risks
  ).toContain('domain-chain-mismatch')
  expect(() =>
    parseInspectorInput({
      kind: 'typed-data',
      input: JSON.stringify(typedData()),
      chainId: '0x20000000000000'
    })
  ).toThrow(/safe-integer/)
})

test('rejects JSON numbers that cannot be displayed without precision loss', () => {
  const unsafe = JSON.stringify(typedData()).replace('"amounts":["1"]', '"amounts":[9007199254740993]')
  expect(() => parseInspectorInput({ kind: 'typed-data', input: unsafe })).toThrow(/unsafe JSON number/)
})

test('strictly validates EIP-712 shape, definitions, and selected version', () => {
  expect(parseEip712TypedData(typedData()).primaryType).toBe('Transfer')
  expect(
    parseEip712TypedData({
      ...typedData(),
      types: {
        EIP712Domain: typedData().types.EIP712Domain,
        $Transfer: [{ name: '$to', type: 'address' }]
      },
      primaryType: '$Transfer',
      message: { $to: target }
    }).primaryType
  ).toBe('$Transfer')
  expect(() => parseEip712TypedData({ ...typedData(), extra: true })).toThrow(/not supported/)
  expect(() =>
    parseEip712TypedData({
      ...typedData(),
      types: { ...typedData().types, Transfer: [{ name: 'to', type: 'MissingType' }] }
    })
  ).toThrow(/invalid type/)
  expect(() => parseEip712TypedData(typedData(), 'V3')).toThrow(/does not support arrays/)
})

test.each(['eth_sendTransaction', 'eth_call', 'eth_estimateGas'] as const)(
  'maps %s to a transaction subject without retaining an executable request',
  (method) => {
    const params = method === 'eth_sendTransaction' ? [{ to: target }] : [{ to: target }, 'latest']
    expect(
      parseInspectorInput({
        kind: 'json-rpc',
        chainId: '0x1',
        input: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params })
      })
    ).toEqual({
      kind: 'transaction',
      transaction: { to: target.toLowerCase(), chainId: '0x1', type: '0x0' },
      source: {
        kind: 'json-rpc',
        method,
        id: 7,
        ...(method === 'eth_sendTransaction' ? {} : { block: 'latest' })
      }
    })
  }
)

test.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'] as const)(
  'maps %s to a typed-data subject with explicit signer provenance',
  (method) => {
    const data = method.endsWith('_v3')
      ? {
          ...typedData(),
          types: { ...typedData().types, Transfer: [{ name: 'to', type: 'address' }] },
          message: { to: target }
        }
      : typedData()
    expect(
      parseInspectorJsonRpcRequest(
        { jsonrpc: '2.0', id: 'request-1', method, params: [account, JSON.stringify(data)] },
        '0x2'
      )
    ).toMatchObject({
      kind: 'typed-data',
      signer: account.toLowerCase(),
      chainId: '0x2',
      version: method.endsWith('_v3') ? 'V3' : 'V4',
      source: { kind: 'json-rpc', method, id: 'request-1' }
    })
  }
)

test('accepts the production-compatible reversed typed-data parameter order', () => {
  expect(
    parseInspectorJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_signTypedData_v4',
      params: [typedData(), account]
    })
  ).toMatchObject({ kind: 'typed-data', signer: account.toLowerCase(), version: 'V4' })
})

test.each([
  ['read RPC', { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [account, 'latest'] }],
  ['send raw RPC', { jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x'] }],
  ['wallet RPC', { jsonrpc: '2.0', id: 1, method: 'wallet_sendCalls', params: [] }],
  ['extra envelope field', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{}], extra: true }],
  ['notification', { jsonrpc: '2.0', method: 'eth_call', params: [{}] }],
  ['null id', { jsonrpc: '2.0', id: null, method: 'eth_call', params: [{}] }],
  ['object params', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: {} }],
  ['too many params', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{}, 'latest', true] }]
])('rejects unsupported or malformed JSON-RPC: %s', (_label, request) => {
  expect(() => parseInspectorJsonRpcRequest(request)).toThrow()
})

test('bounds raw text by characters and UTF-8 bytes', () => {
  expect(
    InspectorInputSchema.safeParse({ kind: 'transaction', input: 'x'.repeat(MAX_INSPECTOR_INPUT_BYTES + 1) })
      .success
  ).toBe(false)
  expect(() => parseInspectorInput({ kind: 'transaction', input: `"${'é'.repeat(140_000)}"` })).toThrow(
    /exceeds/
  )
})
