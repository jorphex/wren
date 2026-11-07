import { SignTypedDataVersion } from '@metamask/eth-sig-util'
import {
  getTypedDataContext,
  getVersionFromTypedData,
  parseTypedMessage
} from '../../../main/provider/typedData'

const typedData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' }
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' }
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' }
    ]
  },
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
  },
  primaryType: 'Mail',
  message: {
    from: {
      name: 'Cow',
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
    },
    to: {
      name: 'Bob',
      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
    },
    contents: 'Hello!'
  }
}

const legacyTypedData = [
  { type: 'string', name: 'fullName', value: 'Satoshi Nakamoto' },
  { type: 'uint32', name: 'userId', value: '1212' }
]

const withField = (field, value) => ({
  ...typedData,
  types: {
    ...typedData.types,
    Mail: [...typedData.types.Mail, field]
  },
  message: {
    ...typedData.message,
    [field.name]: value
  }
})

const recursiveTypedData = {
  ...typedData,
  types: {
    EIP712Domain: typedData.types.EIP712Domain,
    Person: [
      { name: 'name', type: 'string' },
      { name: 'mother', type: 'Person' }
    ]
  },
  primaryType: 'Person',
  message: {
    name: 'Satoshi Nakamoto',
    mother: { name: 'unknown' }
  }
}

function expectInvalid(parse, message) {
  try {
    parse()
    throw new Error('Expected typed data parsing to fail')
  } catch (error) {
    expect(error).toMatchObject({ code: -32602, message: expect.stringMatching(message) })
  }
}

describe('#getVersionFromTypedData', () => {
  it('infers V1 for legacy arrays', () => {
    expect(getVersionFromTypedData(legacyTypedData)).toBe(SignTypedDataVersion.V1)
  })

  it('defaults ordinary EIP-712 data to V4', () => {
    expect(getVersionFromTypedData(typedData)).toBe(SignTypedDataVersion.V4)
  })

  it.each([
    ['dynamic arrays', withField({ name: 'values', type: 'uint256[]' }, [1, 2])],
    ['fixed arrays', withField({ name: 'values', type: 'uint256[2]' }, [1, 2])],
    ['recursive types', recursiveTypedData],
    ['recursive types with missing values', { ...recursiveTypedData, message: {} }]
  ])('infers V4 for %s', (_, value) => {
    expect(getVersionFromTypedData(value)).toBe(SignTypedDataVersion.V4)
  })

  it('infers V3 when a primary message field is undefined', () => {
    expect(
      getVersionFromTypedData({ ...typedData, message: { ...typedData.message, contents: undefined } })
    ).toBe(SignTypedDataVersion.V3)
  })

  it.each([null, 1, 'data', {}, { types: null }])(
    'does not throw while examining malformed data',
    (value) => {
      expect(() => getVersionFromTypedData(value)).not.toThrow()
    }
  )
})

describe('#parseTypedMessage', () => {
  it.each([
    [legacyTypedData, SignTypedDataVersion.V1],
    [typedData, SignTypedDataVersion.V3],
    [typedData, SignTypedDataVersion.V4]
  ])('accepts valid %s data', (data, version) => {
    expect(parseTypedMessage(data, version)).toEqual({ data, version })
  })

  it('infers and validates a version when none is requested', () => {
    expect(parseTypedMessage(typedData)).toEqual({ data: typedData, version: SignTypedDataVersion.V4 })
  })

  it.each([
    ['null', null],
    ['a primitive', 1],
    ['an empty object', {}],
    ['missing types', { ...typedData, types: undefined }],
    ['missing domain', { ...typedData, domain: undefined }],
    ['missing message', { ...typedData, message: undefined }],
    ['missing EIP712Domain', { ...typedData, types: { Mail: typedData.types.Mail } }],
    ['an unknown primary type', { ...typedData, primaryType: 'Unknown' }],
    [
      'an invalid field declaration',
      { ...typedData, types: { ...typedData.types, Mail: [{ name: 'value', type: '' }] } }
    ],
    ['an invalid struct identifier', { ...typedData, types: { ...typedData.types, 'Bad Type': [] } }],
    [
      'an invalid field identifier',
      { ...typedData, types: { ...typedData.types, Mail: [{ name: 'bad field', type: 'uint256' }] } }
    ],
    [
      'an integer alias',
      { ...typedData, types: { ...typedData.types, Mail: [{ name: 'value', type: 'uint' }] } }
    ],
    [
      'an invalid integer width',
      { ...typedData, types: { ...typedData.types, Mail: [{ name: 'value', type: 'uint7' }] } }
    ],
    [
      'an invalid fixed array length',
      { ...typedData, types: { ...typedData.types, Mail: [{ name: 'value', type: 'uint256[0]' }] } }
    ],
    [
      'an undeclared struct reference',
      { ...typedData, types: { ...typedData.types, Mail: [{ name: 'value', type: 'Missing' }] } }
    ]
  ])('rejects %s', (_, value) => {
    expectInvalid(() => parseTypedMessage(value, SignTypedDataVersion.V4), /Invalid params:/)
  })

  it.each([
    ['V1 with EIP-712 data', typedData, SignTypedDataVersion.V1],
    ['V3 with legacy data', legacyTypedData, SignTypedDataVersion.V3],
    ['V4 with legacy data', legacyTypedData, SignTypedDataVersion.V4]
  ])('rejects %s', (_, value, version) => {
    expectInvalid(() => parseTypedMessage(value, version), /Invalid params:/)
  })

  it.each([
    ['dynamic arrays', withField({ name: 'values', type: 'uint256[]' }, [1, 2])],
    ['fixed arrays', withField({ name: 'values', type: 'uint256[2]' }, [1, 2])],
    ['recursive types', recursiveTypedData]
  ])('rejects V3 %s', (_, value) => {
    expectInvalid(() => parseTypedMessage(value, SignTypedDataVersion.V3), /V3 typed data does not support/)
  })

  it.each([
    withField({ name: 'values', type: 'uint256[]' }, [1, 2]),
    withField({ name: 'values', type: 'uint256[2]' }, [1, 2]),
    recursiveTypedData
  ])('accepts V4-only data', (value) => {
    expect(parseTypedMessage(value, SignTypedDataVersion.V4)).toEqual({
      data: value,
      version: SignTypedDataVersion.V4
    })
  })

  it.each([
    ['an empty V1 array', []],
    ['a V1 field without a value', [{ name: 'value', type: 'uint256' }]],
    ['a V1 field with an invalid Solidity type', [{ name: 'value', type: 'uint7', value: 1 }]]
  ])('rejects %s', (_, value) => {
    expectInvalid(() => parseTypedMessage(value, SignTypedDataVersion.V1), /Invalid params:/)
  })

  it('rejects EIP-712 data that cannot be encoded', () => {
    const invalidValue = withField({ name: 'count', type: 'uint256' }, undefined)
    expectInvalid(() => parseTypedMessage(invalidValue, SignTypedDataVersion.V4), /Invalid params:/)
  })
})

describe('#getTypedDataContext', () => {
  const message = (data, version = SignTypedDataVersion.V4) => ({ data, version })

  it('attaches ERC-3009 direct-transfer authority and risk', () => {
    const authorization = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' }
        ]
      },
      primaryType: 'TransferWithAuthorization',
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: 1,
        verifyingContract: '0x3333333333333333333333333333333333333333'
      },
      message: {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '100',
        validAfter: '0',
        validBefore: '2000000000',
        nonce: `0x${'ab'.repeat(32)}`
      }
    }

    expect(getTypedDataContext(message(authorization), 1)).toMatchObject({
      risks: ['eip3009-transfer'],
      eip3009: {
        kind: 'transfer',
        authorizer: authorization.message.from,
        value: '100',
        grantsAuthority: true
      }
    })
  })

  it('attaches Permit2 authority and consent risks to exact canonical data', () => {
    const permit2 = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' }
        ],
        PermitDetails: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' }
        ]
      },
      primaryType: 'PermitSingle',
      domain: {
        name: 'Permit2',
        chainId: 1,
        verifyingContract: '0x4444444444444444444444444444444444444444'
      },
      message: {
        details: {
          token: '0x1111111111111111111111111111111111111111',
          amount: (2n ** 160n - 1n).toString(10),
          expiration: '2000000000',
          nonce: '1'
        },
        spender: '0x3333333333333333333333333333333333333333',
        sigDeadline: '1900000000'
      }
    }

    expect(getTypedDataContext(message(permit2), 1)).toMatchObject({
      requestChainId: 1,
      domainChainId: '1',
      risks: ['permit2-allowance', 'permit2-maximum-amount', 'permit2-noncanonical-contract'],
      permit2: {
        kind: 'allowance',
        canonicalContract: false,
        grantsAuthority: true,
        maximumAmount: true
      }
    })
  })

  it('summarizes a zero-amount Permit2 request without an authority risk', () => {
    const permit2 = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        PermitTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' },
          { name: 'spender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }
        ],
        TokenPermissions: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' }
        ]
      },
      primaryType: 'PermitTransferFrom',
      domain: {
        name: 'Permit2',
        chainId: 1,
        verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3'
      },
      message: {
        permitted: { token: '0x1111111111111111111111111111111111111111', amount: '0' },
        spender: '0x3333333333333333333333333333333333333333',
        nonce: '1',
        deadline: '1900000000'
      }
    }

    expect(getTypedDataContext(message(permit2), 1)).toMatchObject({
      risks: [],
      permit2: { kind: 'transfer', grantsAuthority: false }
    })
  })

  it.each([
    [1, '1'],
    ['1', '1'],
    ['0x01', '1'],
    ['0X01', '1']
  ])('normalizes matching domain chain ID %s', (chainId, normalized) => {
    const data = { ...typedData, domain: { ...typedData.domain, chainId } }

    expect(getTypedDataContext(message(data), 1)).toEqual({
      requestChainId: 1,
      domainChainId: normalized,
      risks: []
    })
  })

  it('reports an absent domain chain', () => {
    const { chainId, ...domain } = typedData.domain

    expect(getTypedDataContext(message({ ...typedData, domain }), 1)).toEqual({
      requestChainId: 1,
      risks: ['domain-chain-missing']
    })
  })

  it.each(['invalid', -1, Number.MAX_SAFE_INTEGER + 1, 1.5, `0x${'f'.repeat(65)}`])(
    'reports invalid domain chain ID %s',
    (chainId) => {
      const data = { ...typedData, domain: { ...typedData.domain, chainId } }

      expect(getTypedDataContext(message(data), 1)).toEqual({
        requestChainId: 1,
        risks: ['domain-chain-invalid']
      })
    }
  )

  it('reports legacy V1 data without adding EIP-712 domain risks', () => {
    expect(getTypedDataContext(message(legacyTypedData, SignTypedDataVersion.V1), 1)).toEqual({
      requestChainId: 1,
      risks: ['legacy-v1']
    })
  })
})
