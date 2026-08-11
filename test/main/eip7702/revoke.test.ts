import { computeAddress, SigningKey } from 'ethers'

import {
  assertSoftwareEip7702RevokeSigner,
  assertEip7702RevokeEvidenceStable,
  inspectEip7702RevokePreflight,
  prepareSoftwareEip7702Revoke,
  signSoftwareEip7702Revoke,
  verifyEip7702RevocationResult,
  type SoftwareEip7702RevokeSigner
} from '../../../main/eip7702/revoke'
import { signEip7702RevokeRequest } from '../../../main/transaction/eip7702'

const PRIVATE_KEY = '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356'
const AUTHORITY = computeAddress(new SigningKey(PRIVATE_KEY).publicKey)
const input = Object.freeze({
  authority: AUTHORITY,
  chainId: 10n,
  nonce: 3n,
  gasLimit: 50_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n
})
const preflight = Object.freeze({
  authorityCode: '0xef01001111111111111111111111111111111111111111',
  latestNonce: '0x3',
  pendingNonce: '0x3'
})

function createSigner(overrides: Partial<SoftwareEip7702RevokeSigner> = {}) {
  const signer: SoftwareEip7702RevokeSigner = {
    type: 'ring',
    status: 'ok',
    addresses: [AUTHORITY],
    signEip7702Revoke: (_index, request, callback) => {
      callback(null, signEip7702RevokeRequest(PRIVATE_KEY, request))
    },
    ...overrides
  }
  return signer
}

describe('software EIP-7702 revocation', () => {
  it('creates stable reviewed evidence without retaining raw code', () => {
    const evidence = inspectEip7702RevokePreflight(AUTHORITY, preflight)
    expect(evidence).toEqual({
      source: 'eth_getCode',
      authority: AUTHORITY.toLowerCase(),
      delegate: '0x1111111111111111111111111111111111111111',
      codeHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      latestNonce: '0x3',
      pendingNonce: '0x3'
    })
    expect(evidence).not.toHaveProperty('authorityCode')
    expect(() => assertEip7702RevokeEvidenceStable(evidence, evidence)).not.toThrow()
    expect(() => assertEip7702RevokeEvidenceStable(evidence, { ...evidence, pendingNonce: '0x4' })).toThrow(
      'changed after review'
    )
  })

  it.each(['ring', 'seed'])('prepares the fixed request for an unlocked %s signer', (type) => {
    const request = prepareSoftwareEip7702Revoke(createSigner({ type }), 0, input, preflight)
    expect(request.authority).toBe(AUTHORITY)
    expect(request.nonce).toBe('0x3')
    expect(request.authorizationNonce).toBe('0x4')
    expect(request.expectedFinalNonce).toBe('0x5')
  })

  it.each([
    ['hardware signer', { type: 'ledger' }],
    ['locked signer', { status: 'locked' }],
    ['wrong address', { addresses: ['0x1111111111111111111111111111111111111111'] }]
  ])('rejects a %s', (_label, overrides) => {
    expect(() => assertSoftwareEip7702RevokeSigner(createSigner(overrides), 0, AUTHORITY)).toThrow()
  })

  it('returns only opaque raw transaction data and sanitized evidence from the worker result', async () => {
    const signer = createSigner()
    const request = prepareSoftwareEip7702Revoke(signer, 0, input, preflight)

    await expect(signSoftwareEip7702Revoke(signer, 0, request, preflight)).resolves.toMatchObject({
      rawTransaction: expect.stringMatching(/^0x04/),
      evidence: {
        authority: AUTHORITY,
        chainId: '0xa',
        nonce: '0x3',
        authorizationNonce: '0x4',
        expectedFinalNonce: '0x5',
        transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/)
      }
    })
  })

  it('rejects malformed worker output', async () => {
    const signer = createSigner({
      signEip7702Revoke: (_index, _request, callback) => callback(null, '0xdead')
    })
    const request = prepareSoftwareEip7702Revoke(signer, 0, input, preflight)
    await expect(signSoftwareEip7702Revoke(signer, 0, request, preflight)).rejects.toThrow('Invalid signed')
  })

  it.each([
    ['missing delegation', { ...preflight, authorityCode: '0x' }],
    ['queued transaction', { ...preflight, pendingNonce: '0x4' }],
    ['changed confirmed nonce', { ...preflight, latestNonce: '0x4', pendingNonce: '0x4' }],
    ['noncanonical nonce', { ...preflight, pendingNonce: '0x03' }]
  ])('fails closed for %s', (_label, unsafePreflight) => {
    expect(() => prepareSoftwareEip7702Revoke(createSigner(), 0, input, unsafePreflight)).toThrow()
  })

  it('rechecks nonce freshness immediately before worker signing', async () => {
    const signer = createSigner()
    const request = prepareSoftwareEip7702Revoke(signer, 0, input, preflight)
    await expect(
      signSoftwareEip7702Revoke(signer, 0, request, { ...preflight, pendingNonce: '0x4' })
    ).rejects.toThrow('stable account nonce')
  })
})

describe('EIP-7702 revocation result verification', () => {
  it('reports cleared only after a successful receipt and empty code reread', async () => {
    await expect(verifyEip7702RevocationResult({ status: '0x1' }, async () => '0x')).resolves.toEqual({
      receiptStatus: 'success',
      revocationStatus: 'cleared',
      reason: 'code-cleared'
    })
  })

  it('reports skipped when a successful receipt leaves code', async () => {
    await expect(
      verifyEip7702RevocationResult(
        { status: 1 },
        async () => '0xef01001111111111111111111111111111111111111111'
      )
    ).resolves.toEqual({
      receiptStatus: 'success',
      revocationStatus: 'skipped',
      reason: 'code-remains'
    })
  })

  it('reports unavailable when the post-receipt code cannot be read', async () => {
    await expect(
      verifyEip7702RevocationResult({ status: 1n }, async () => {
        throw new Error('offline')
      })
    ).resolves.toEqual({
      receiptStatus: 'success',
      revocationStatus: 'unavailable',
      reason: 'code-unavailable'
    })
  })

  it('reports cleared after a failed receipt when authorization processing cleared code', async () => {
    await expect(verifyEip7702RevocationResult({ status: '0x0' }, async () => '0x')).resolves.toEqual({
      receiptStatus: 'failed',
      revocationStatus: 'cleared',
      reason: 'code-cleared'
    })
  })

  it('reports skipped after a failed receipt when code remains', async () => {
    await expect(
      verifyEip7702RevocationResult(
        { status: 0 },
        async () => '0xef01001111111111111111111111111111111111111111'
      )
    ).resolves.toEqual({
      receiptStatus: 'failed',
      revocationStatus: 'skipped',
      reason: 'code-remains'
    })
  })

  it('reports unavailable after a failed receipt when code cannot be reread', async () => {
    await expect(
      verifyEip7702RevocationResult({ status: 0n }, async () => {
        throw new Error('offline')
      })
    ).resolves.toEqual({
      receiptStatus: 'failed',
      revocationStatus: 'unavailable',
      reason: 'code-unavailable'
    })
  })
})
