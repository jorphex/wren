import { Interface } from 'ethers'

import { validateErc1271Signature } from '../../../main/signatures/erc1271'

const account = '0x1111111111111111111111111111111111111111'
const digest = `0x${'2'.repeat(64)}`
const signature = `0x${'3'.repeat(130)}`
const block = '0x64'
const blockHash = `0x${'4'.repeat(64)}`
const blockIdentity = { number: block, hash: blockHash }
const blockReference = { blockHash, requireCanonical: true }
const code = '0x6001600055'
const erc1271 = new Interface([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4 magicValue)'
])
const magic = erc1271.encodeFunctionResult('isValidSignature', ['0x1626ba7e'])

const connection = (responses: Array<{ result?: unknown; error?: { code: number; message: string } }>) => ({
  send: jest.fn((payload, callback) => {
    const response = responses.shift() || { error: { code: -32603, message: 'missing fixture' } }
    callback({ id: payload.id, jsonrpc: '2.0', ...response })
  })
})

it('validates exact ERC-1271 magic against configured-RPC state at one canonical block', async () => {
  const rpc = connection([
    { result: block },
    { result: blockIdentity },
    { result: code },
    { result: magic },
    { result: code },
    { result: blockIdentity }
  ])

  await expect(
    validateErc1271Signature({ account, chainId: 1, digest, signature }, rpc)
  ).resolves.toMatchObject({
    status: 'valid',
    account,
    chainId: 1,
    blockNumber: block,
    blockHash,
    source: 'eth_call',
    codeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/)
  })
  expect(rpc.send).toHaveBeenNthCalledWith(
    1,
    { id: 1, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
  expect(rpc.send).toHaveBeenNthCalledWith(
    2,
    {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: [block, false]
    },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
  expect(rpc.send).toHaveBeenNthCalledWith(
    3,
    { id: 1, jsonrpc: '2.0', method: 'eth_getCode', params: [account, blockReference] },
    expect.any(Function),
    { type: 'ethereum', id: 1 }
  )
  const call = rpc.send.mock.calls[3][0]
  expect(call.method).toBe('eth_call')
  expect(call.params[0].to).toBe(account)
  expect(call.params[1]).toEqual(blockReference)
  expect(erc1271.decodeFunctionData('isValidSignature', call.params[0].data)).toEqual([digest, signature])
})

it.each([
  ['bad block', [{ result: '100' }], 'unavailable', 'block'],
  [
    'bad block identity',
    [{ result: block }, { result: { number: block, hash: '0x12' } }],
    'unavailable',
    'identity'
  ],
  [
    'empty code',
    [{ result: block }, { result: blockIdentity }, { result: '0x' }],
    'unavailable',
    'Signer has no contract code'
  ],
  [
    'code RPC error',
    [
      { result: block },
      { result: blockIdentity },
      { error: { code: -32000, message: 'private RPC detail' } }
    ],
    'unavailable',
    'Contract signer code could not be read'
  ],
  [
    'call RPC error',
    [
      { result: block },
      { result: blockIdentity },
      { result: code },
      { error: { code: -32000, message: 'private RPC detail' } }
    ],
    'unavailable',
    'Contract signature check failed'
  ],
  [
    'malformed return',
    [{ result: block }, { result: blockIdentity }, { result: code }, { result: '0x12' }],
    'unavailable',
    'malformed'
  ],
  [
    'wrong magic',
    [
      { result: block },
      { result: blockIdentity },
      { result: code },
      { result: erc1271.encodeFunctionResult('isValidSignature', ['0xffffffff']) }
    ],
    'invalid',
    'rejected'
  ],
  [
    'changed code',
    [{ result: block }, { result: blockIdentity }, { result: code }, { result: magic }, { result: '0x6002' }],
    'unavailable',
    'changed'
  ]
])('fails closed for %s', async (_name, responses, status, reason) => {
  await expect(
    validateErc1271Signature({ account, chainId: 1, digest, signature }, connection(responses))
  ).resolves.toMatchObject({ status, reason: expect.stringMatching(new RegExp(reason, 'i')) })
})

it.each([
  [{ account: 'not-an-address', chainId: 1, digest, signature }, 'unavailable'],
  [{ account: null, chainId: 1, digest, signature }, 'unavailable'],
  [{ account, chainId: 0, digest, signature }, 'unavailable'],
  [{ account, chainId: 1, digest: '0x12', signature }, 'unavailable'],
  [{ account, chainId: 1, digest, signature: 'not-hex' }, 'invalid'],
  [{ account, chainId: 1, digest, signature: '0x1' }, 'invalid'],
  [{ account, chainId: 1, digest, signature: `0x${'1'.repeat(2 * 64 * 1024 + 2)}` }, 'invalid']
])('rejects malformed or unbounded validation input %#', async (input, status) => {
  const rpc = connection([])
  await expect(validateErc1271Signature(input, rpc)).resolves.toMatchObject({ status })
  expect(rpc.send).not.toHaveBeenCalled()
})

it.each([
  ['odd-length code', '0x123'],
  ['oversized code', `0x${'11'.repeat(32 * 1024 + 1)}`]
])('rejects %s without hashing unsafe RPC evidence', async (_name, returnedCode) => {
  const rpc = connection([{ result: block }, { result: blockIdentity }, { result: returnedCode }])
  await expect(
    validateErc1271Signature({ account, chainId: 1, digest, signature }, rpc)
  ).resolves.toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/code evidence/i) })
  expect(rpc.send).toHaveBeenCalledTimes(3)
})

it('normalizes equivalent code casing before the stability check', async () => {
  const rpc = connection([
    { result: block },
    { result: blockIdentity },
    { result: '0x60Aa' },
    { result: magic },
    { result: '0x60aa' },
    { result: blockIdentity }
  ])
  await expect(
    validateErc1271Signature({ account, chainId: 1, digest, signature }, rpc)
  ).resolves.toMatchObject({ status: 'valid' })
})

it('fails closed when the canonical block changes after validation', async () => {
  const rpc = connection([
    { result: block },
    { result: blockIdentity },
    { result: code },
    { result: magic },
    { result: code },
    { result: { number: block, hash: `0x${'5'.repeat(64)}` } }
  ])
  await expect(
    validateErc1271Signature({ account, chainId: 1, digest, signature }, rpc)
  ).resolves.toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/block changed/i) })
})
