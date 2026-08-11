import { computeAddress, SigningKey, Transaction } from 'ethers'

import {
  createEip7702RevokeRequest,
  EIP7702_REVOKE_DELEGATE,
  inspectSignedEip7702RevokeTransaction,
  parseEip7702RevokeRequest,
  signEip7702RevokeRequest
} from '../../../main/transaction/eip7702'

const PRIVATE_KEY = '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356'
const AUTHORITY = computeAddress(new SigningKey(PRIVATE_KEY).publicKey)

const createRequest = () =>
  createEip7702RevokeRequest({
    authority: AUTHORITY,
    chainId: 1n,
    nonce: 7n,
    gasLimit: 50_000n,
    maxFeePerGas: 3_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n
  })

describe('EIP-7702 revoke transaction codec', () => {
  it('builds only the fixed, chain-specific, self-funded revoke request', () => {
    expect(createRequest()).toEqual({
      kind: 'eip7702-revoke-v1',
      type: '0x4',
      authority: AUTHORITY,
      from: AUTHORITY,
      to: AUTHORITY,
      delegate: EIP7702_REVOKE_DELEGATE,
      chainId: '0x1',
      nonce: '0x7',
      authorizationNonce: '0x8',
      expectedFinalNonce: '0x9',
      value: '0x0',
      data: '0x',
      gasLimit: '0xc350',
      maxFeePerGas: '0xb2d05e00',
      maxPriorityFeePerGas: '0x3b9aca00'
    })
  })

  it.each([
    ['a nonzero delegate', { delegate: '0x1111111111111111111111111111111111111111' }],
    ['another destination', { to: '0x1111111111111111111111111111111111111111' }],
    ['a value transfer', { value: '0x1' }],
    ['transaction data', { data: '0x00' }],
    ['the wildcard chain', { chainId: '0x0' }],
    ['an incorrect authorization nonce', { authorizationNonce: '0x7' }],
    ['an incorrect final nonce', { expectedFinalNonce: '0xa' }],
    ['a noncanonical quantity', { nonce: '0x07' }],
    ['gas below the fixed intrinsic minimum', { gasLimit: '0xb3af' }],
    ['a priority fee above the maximum', { maxPriorityFeePerGas: '0xb2d05e01' }]
  ])('rejects %s', (_label, change) => {
    expect(() => parseEip7702RevokeRequest({ ...createRequest(), ...change })).toThrow()
  })

  it('rejects extra request fields', () => {
    expect(() => parseEip7702RevokeRequest({ ...createRequest(), dappDelegate: AUTHORITY })).toThrow('shape')
  })

  it('accepts the exact 46,000 gas intrinsic boundary', () => {
    expect(parseEip7702RevokeRequest({ ...createRequest(), gasLimit: '0xb3b0' }).gasLimit).toBe('0xb3b0')
  })
})

describe('EIP-7702 revoke signing', () => {
  it('signs and validates one type-4 zero-delegate authorization without exposing its fields', () => {
    const request = createRequest()
    const rawTransaction = signEip7702RevokeRequest(PRIVATE_KEY, request)
    const evidence = inspectSignedEip7702RevokeTransaction(rawTransaction, request)
    const parsed = Transaction.from(rawTransaction)

    expect(rawTransaction).toMatch(/^0x04/)
    expect(evidence).toEqual({
      authority: AUTHORITY,
      chainId: '0x1',
      nonce: '0x7',
      authorizationNonce: '0x8',
      expectedFinalNonce: '0x9',
      transactionHash: parsed.hash
    })
    expect(Object.keys(evidence)).not.toEqual(expect.arrayContaining(['r', 's', 'signature']))
    expect(parsed.authorizationList).toHaveLength(1)
    expect(parsed.authorizationList?.[0]?.address).toBe(EIP7702_REVOKE_DELEGATE)
  })

  it('rejects a private key that does not control the selected authority', () => {
    const otherKey = '0x8b3a350cf5c34c9194ca3a545d3b1952cdd34e2f29693a0a9dd67d22a51e58b0'
    expect(() => signEip7702RevokeRequest(otherKey, createRequest())).toThrow('does not control')
  })

  it('rejects a signed transaction against changed reviewed fees', () => {
    const request = createRequest()
    const rawTransaction = signEip7702RevokeRequest(PRIVATE_KEY, request)
    expect(() =>
      inspectSignedEip7702RevokeTransaction(rawTransaction, {
        ...request,
        maxFeePerGas: '0xb2d05e01'
      })
    ).toThrow('does not match')
  })

  it('bounds opaque raw transaction input before decoding', () => {
    expect(() => inspectSignedEip7702RevokeTransaction(`0x${'00'.repeat(5000)}`, createRequest())).toThrow(
      'Invalid signed'
    )
  })
})
