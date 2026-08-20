import { getCreateAddress, keccak256 } from 'ethers'

import {
  buildDeploymentTransaction,
  DEPLOYMENT_DOMAIN_ERROR_CODES,
  DeploymentDomainError,
  deriveProvisionalDeploymentAddress,
  inspectDeploymentInitcode,
  MAX_DEPLOYMENT_INITCODE_BYTES,
  MAX_DEPLOYMENT_PENDING_NONCE,
  normalizeDeploymentInitcode,
  parseDeploymentPendingNonce,
  parseDeploymentValue,
  snapshotDeploymentDraft
} from '../../../../resources/domain/deployment'
import { MAX_UINT256 } from '../../../../resources/domain/transaction/quantity'

const account = '0x1111111111111111111111111111111111111111'
const mixedCaseAccount = '0x94112434c4c3ea14a4328a5d9383a00e78d772eb'

describe('prepared deployment draft', () => {
  it('accepts exactly four fields and creates a frozen canonical snapshot', () => {
    const snapshot = snapshotDeploymentDraft(
      { account: mixedCaseAccount, chainId: 10, initcode: '0x60AA00ff', value: '1.25' },
      2
    )

    expect(snapshot).toEqual({
      account: mixedCaseAccount.toLowerCase(),
      chainId: '0xa',
      initcode: '0x60aa00ff',
      value: '0x7d'
    })
    expect(Object.isFrozen(snapshot)).toBe(true)

    expect(() =>
      snapshotDeploymentDraft({ account, chainId: 1, initcode: '0x00', value: '', recipient: account }, 18)
    ).toThrow(expect.objectContaining({ code: 'invalid-draft' }))
    expect(() => snapshotDeploymentDraft({ account, chainId: 1, initcode: '0x00' }, 18)).toThrow(
      expect.objectContaining({ code: 'invalid-draft' })
    )
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1'])(
    'rejects invalid chain id %p',
    (chainId) => {
      expect(() => snapshotDeploymentDraft({ account, chainId, initcode: '0x00', value: '' }, 18)).toThrow(
        expect.objectContaining({ code: 'invalid-chain-id' })
      )
    }
  )

  it('rejects invalid accounts with a bounded domain error', () => {
    expect(() =>
      snapshotDeploymentDraft({ account: 'not-an-address', chainId: 1, initcode: '0x00', value: '' }, 18)
    ).toThrow(
      expect.objectContaining({
        name: 'DeploymentDomainError',
        code: 'invalid-account',
        message: 'Deployment account is invalid'
      })
    )
    expect(DEPLOYMENT_DOMAIN_ERROR_CODES).toContain('invalid-account')
    expect(new DeploymentDomainError('invalid-value')).toEqual(
      expect.objectContaining({ code: 'invalid-value', message: 'Deployment value is invalid' })
    )
  })
})

describe('creation data', () => {
  it('requires a lowercase 0x prefix, non-empty whole bytes, and normalizes hex letter case', () => {
    expect(normalizeDeploymentInitcode('0xABCDef')).toBe('0xabcdef')

    for (const invalid of ['', '0x', '0X00', '00', '0x0', '0x0g', ' 0x00', '0x00 ']) {
      expect(() => normalizeDeploymentInitcode(invalid)).toThrow(
        expect.objectContaining({ code: 'invalid-initcode' })
      )
    }
  })

  it('accepts exactly 49,152 bytes and rejects one byte more', () => {
    const atLimit = `0x${'ab'.repeat(MAX_DEPLOYMENT_INITCODE_BYTES)}`
    const overLimit = `${atLimit}ab`

    expect(normalizeDeploymentInitcode(atLimit)).toHaveLength(2 + MAX_DEPLOYMENT_INITCODE_BYTES * 2)
    expect(() => normalizeDeploymentInitcode(overLimit)).toThrow(
      expect.objectContaining({ code: 'initcode-too-large' })
    )
  })

  it('preserves already encoded constructor data and hashes the complete payload', () => {
    const creationCode = '6080604052'
    const constructorSuffix = '0000000000000000000000002222222222222222222222222222222222222222'
    const fullPayload = `0x${creationCode}${constructorSuffix}`

    const snapshot = snapshotDeploymentDraft({ account, chainId: 1, initcode: fullPayload, value: '0' }, 18)
    expect(snapshot.initcode).toBe(fullPayload)
    expect(snapshot.initcode.endsWith(constructorSuffix)).toBe(true)
    expect(inspectDeploymentInitcode(snapshot.initcode)).toEqual({
      bytes: (creationCode.length + constructorSuffix.length) / 2,
      hash: keccak256(fullPayload)
    })
  })

  it('matches fixed Keccak-256 vectors and counts bytes rather than characters', () => {
    expect(inspectDeploymentInitcode('0x00')).toEqual({
      bytes: 1,
      hash: '0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a'
    })
    expect(inspectDeploymentInitcode('0x60006000')).toEqual({
      bytes: 4,
      hash: '0x5e3ce470a8506d55e59815db7232a08774174ae0c7fdb2fbc81a49e4e242b0d6'
    })
  })
})

describe('native value', () => {
  it.each([
    ['', 18, '0x0'],
    ['0', 18, '0x0'],
    ['0001.2300', 4, '0x300c'],
    ['1.', 2, '0x64'],
    ['.5', 1, '0x5'],
    ['1.000000000000000001', 18, '0xde0b6b3a7640001'],
    ['255', 0, '0xff']
  ])('parses %p exactly with %p trusted decimals', (value, decimals, expected) => {
    expect(parseDeploymentValue(value, decimals)).toBe(expected)
  })

  it.each(['-1', '+1', '1e3', '1E3', ' 1', '1 ', '1_000', '.', '0x1'])(
    'rejects non-decimal syntax %p',
    (value) => {
      expect(() => parseDeploymentValue(value, 18)).toThrow(
        expect.objectContaining({ code: 'invalid-value' })
      )
    }
  )

  it('rejects precision beyond the trusted decimal count, including zero digits', () => {
    expect(() => parseDeploymentValue('1.001', 2)).toThrow(
      expect.objectContaining({ code: 'value-precision' })
    )
    expect(() => parseDeploymentValue('.0', 0)).toThrow(expect.objectContaining({ code: 'value-precision' }))
  })

  it('accepts uint256 max and rejects overflow after decimal conversion', () => {
    expect(parseDeploymentValue(MAX_UINT256.toString(10), 0)).toBe(`0x${MAX_UINT256.toString(16)}`)
    expect(() => parseDeploymentValue((MAX_UINT256 + 1n).toString(10), 0)).toThrow(
      expect.objectContaining({ code: 'value-overflow' })
    )

    const decimals = 2
    const max = MAX_UINT256.toString(10)
    const maxDecimal = `${max.slice(0, -decimals)}.${max.slice(-decimals)}`
    expect(parseDeploymentValue(maxDecimal, decimals)).toBe(`0x${MAX_UINT256.toString(16)}`)
    expect(() =>
      parseDeploymentValue(
        `${max.slice(0, -decimals)}.${(BigInt(max.slice(-decimals)) + 1n).toString()}`,
        decimals
      )
    ).toThrow(expect.objectContaining({ code: 'value-overflow' }))
  })

  it.each([-1, 1.5, 256, '18', undefined])('rejects untrusted decimal count %p', (decimals) => {
    expect(() => parseDeploymentValue('1', decimals)).toThrow(
      expect.objectContaining({ code: 'invalid-decimals' })
    )
  })
})

describe('transaction construction', () => {
  it('contains only from, chainId, data, and value and can never add a destination', () => {
    const transaction = buildDeploymentTransaction(
      { account, chainId: 8453, initcode: '0x60AA00', value: '.25' },
      2
    )

    expect(transaction).toEqual({ from: account, chainId: '0x2105', data: '0x60aa00', value: '0x19' })
    expect(Object.keys(transaction)).toEqual(['from', 'chainId', 'data', 'value'])
    expect('to' in transaction).toBe(false)
    expect(Object.isFrozen(transaction)).toBe(true)
  })
})

describe('pending nonce and provisional CREATE address', () => {
  it.each([
    ['0x0', 0n],
    ['0x1', 1n],
    ['0xa', 10n],
    [`0x${MAX_DEPLOYMENT_PENDING_NONCE.toString(16)}`, MAX_DEPLOYMENT_PENDING_NONCE]
  ])('accepts canonical pending nonce %s', (value, expected) => {
    expect(parseDeploymentPendingNonce(value)).toBe(expected)
  })

  it.each(['', '0x', '0x00', '0X0', '0xA', '1', 1, `0x${(MAX_DEPLOYMENT_PENDING_NONCE + 1n).toString(16)}`])(
    'rejects invalid or unsafe pending nonce %p',
    (value) => {
      expect(() => parseDeploymentPendingNonce(value)).toThrow(
        expect.objectContaining({ code: 'invalid-pending-nonce' })
      )
    }
  )

  it('derives the standard CREATE address from the validated account and fresh pending nonce', () => {
    const expected = getCreateAddress({ from: account, nonce: 0n }).toLowerCase()
    expect(deriveProvisionalDeploymentAddress(account, '0x0')).toBe(expected)
    expect(expected).toBe('0x8f7a45ebde059392e46a46dcc14ab24681a961ea')
  })
})
