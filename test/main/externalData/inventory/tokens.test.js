import TokenLoader from '../../../../main/externalData/inventory/tokens'

let tokenLoader

beforeEach(() => {
  tokenLoader = new TokenLoader()
})

describe('loading tokens', () => {
  it('fails to load tokens for an unknown chain', () => {
    const tokens = tokenLoader.getTokens([-1])

    expect(tokens.length).toBe(0)
  })
})

describe('#getBlacklist', () => {
  beforeEach(() => {
    tokenLoader = new TokenLoader([
      { name: 'Optimism', chainId: 10, address: '0x9999', extensions: { omit: true } },
      { name: 'Polygon', chainId: 137, address: '0x9999' },
      { name: 'Minereum', chainId: 137, address: '0x9999', extensions: { omit: true } }
    ])
  })

  it('returns all blacklisted tokens', () => {
    const blacklistedTokens = tokenLoader.getBlacklist().map((t) => t.name)

    expect(blacklistedTokens).toStrictEqual(['Optimism', 'Minereum'])
  })

  it('returns blacklisted tokens from a specific chain', () => {
    const blacklistedTokens = tokenLoader.getBlacklist([137]).map((t) => t.name)

    expect(blacklistedTokens).toStrictEqual(['Minereum'])
  })
})
