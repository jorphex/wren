import { formatErc7811Assets, parseAssetsRequest } from '../../../../main/provider/assets/erc7811'

const token = '0x383518188c0c6d7730d91b2c03a03c837814a899'
const otherToken = '0x3472a5a71965499acd81997a54bba8d852c6e53d'
const account = '0x22dd63c3619818fdbc262c78baee43cb61e9cccf'

const assets = {
  nativeCurrency: [
    {
      address: '0x0000000000000000000000000000000000000000',
      chainId: 1,
      name: 'Ether',
      symbol: 'ETH',
      balance: '0x10',
      decimals: 18,
      displayBalance: '0.000000000000000016',
      currencyInfo: { name: 'Ether', symbol: 'ETH', decimals: 18, usd: { price: 1 } }
    }
  ],
  erc20: [
    {
      address: token,
      chainId: 1,
      name: 'Token',
      symbol: 'TOK',
      balance: '0x20',
      decimals: 6,
      displayBalance: '0.000032',
      tokenInfo: { lastKnownPrice: { usd: { price: 2 } } }
    },
    {
      address: otherToken,
      chainId: 137,
      name: 'Other Token',
      symbol: 'OTH',
      balance: '0x30',
      decimals: 18,
      displayBalance: '0.000000000000000048',
      tokenInfo: { lastKnownPrice: { usd: { price: 3 } } }
    }
  ]
}

describe('parseAssetsRequest', () => {
  it.each([undefined, []])('preserves the legacy no-parameter form', (params) => {
    expect(parseAssetsRequest(params)).toEqual({ mode: 'legacy' })
  })

  it('normalizes a bounded ERC-7811 request', () => {
    expect(
      parseAssetsRequest([
        {
          account: account.toUpperCase().replace('0X', '0x'),
          assetFilter: { '0x1': [{ address: token.toUpperCase().replace('0X', '0x'), type: 'erc20' }] },
          assetTypeFilter: ['native', 'native'],
          chainFilter: ['0x1', '0x1']
        }
      ])
    ).toEqual({
      mode: 'erc7811',
      request: {
        account,
        assetFilter: { '0x1': [{ address: token, type: 'erc20' }] },
        assetTypeFilter: ['native'],
        chainFilter: ['0x1']
      }
    })
  })

  it.each([
    ['missing request', [{}]],
    ['unknown field', [{ account, surprise: true }]],
    ['noncanonical chain', [{ account, chainFilter: ['0x01'] }]],
    ['malformed selector', [{ account, assetFilter: { '0x1': [{ address: token }] } }]],
    ['extra parameter', [{ account }, {}]]
  ])('rejects %s', (_label, params) => {
    expect(() => parseAssetsRequest(params)).toThrow(
      expect.objectContaining({ code: -32602, message: expect.stringMatching(/invalid params/i) })
    )
  })
})

describe('formatErc7811Assets', () => {
  const authorized = (chainId: number) => chainId === 1 || chainId === 137

  it('returns standardized chain-keyed native and ERC-20 records', () => {
    expect(formatErc7811Assets(assets, { account }, authorized)).toEqual({
      '0x1': [
        { address: 'native', balance: '0x10', type: 'native' },
        {
          address: token,
          balance: '0x20',
          type: 'erc20',
          metadata: { name: 'Token', symbol: 'TOK', decimals: 6 }
        }
      ],
      '0x89': [
        {
          address: otherToken,
          balance: '0x30',
          type: 'erc20',
          metadata: { name: 'Other Token', symbol: 'OTH', decimals: 18 }
        }
      ]
    })
  })

  it('applies chain and asset-type filters without inventing unsupported types', () => {
    expect(
      formatErc7811Assets(
        assets,
        { account, chainFilter: ['0x1', '0x89'], assetTypeFilter: ['native', 'erc721'] },
        authorized
      )
    ).toEqual({ '0x1': [{ address: 'native', balance: '0x10', type: 'native' }], '0x89': [] })
  })

  it('gives explicit asset filters precedence and omits unauthorized chains', () => {
    expect(
      formatErc7811Assets(
        assets,
        {
          account,
          assetFilter: {
            '0x1': [
              { address: token, type: 'erc20' },
              { address: 'native', type: 'native' }
            ],
            '0x89': [{ address: otherToken, type: 'erc20' }]
          },
          assetTypeFilter: ['erc721'],
          chainFilter: []
        },
        (chainId) => chainId === 1
      )
    ).toEqual({
      '0x1': [
        { address: 'native', balance: '0x10', type: 'native' },
        {
          address: token,
          balance: '0x20',
          type: 'erc20',
          metadata: { name: 'Token', symbol: 'TOK', decimals: 6 }
        }
      ]
    })
  })
})
