import TokenLoader from '../../../../main/externalData/inventory/tokens'

let tokenLoader

beforeEach(() => {
  tokenLoader = new TokenLoader()
})

describe('loading tokens', () => {
  it('loads the default token list initially', () => {
    const tokens = tokenLoader.getTokens([137])

    expect(tokens.length).toBeGreaterThan(50)
    expect(tokens.find((token) => token.name === 'Aave')).toBeTruthy()
  })

  it('keeps the reviewed bundled list when started', async () => {
    const before = tokenLoader.getTokens([1])
    await tokenLoader.start()
    expect(tokenLoader.getTokens([1])).toEqual(before)
  })

  it('loads the default token list for mainnet', () => {
    const tokens = tokenLoader.getTokens([1])

    expect(tokens.length).toBeGreaterThan(0)
  })

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
