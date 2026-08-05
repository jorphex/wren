import { YEARN_CATALOG, YEARN_YVUSD_LOCKED_ADDRESS } from '../../../main/yearn/catalog'
import { normalizeKongCatalog, resolveYearnApy } from '../../../main/yearn/kong'
import { makeKongVaultList } from './fixtures'

describe('Yearn Kong catalog normalization', () => {
  it('hydrates only the curated products in stable chain order', () => {
    const { cache, errors } = normalizeKongCatalog(makeKongVaultList(), 1234)

    expect(errors).toEqual([])
    expect(cache.fetchedAt).toBe(1234)
    expect(cache.vaults.map(({ id }) => id)).toEqual(YEARN_CATALOG.map(({ id }) => id))
    expect(cache.vaults.map(({ chainId }) => chainId)).toEqual([1, 1, 1, 1, 8453, 747474, 747474, 747474])
  })

  it('keeps yvUSD variants distinct and advertises the staked yBOLD yield', () => {
    const { cache } = normalizeKongCatalog(makeKongVaultList(), 1234)
    const yvUsd = cache.vaults.find(({ kind }) => kind === 'yvUSD')
    const yBold = cache.vaults.find(({ kind }) => kind === 'yBOLD')

    expect(yvUsd?.variants).toMatchObject([
      { id: 'unlocked', apy: { value: 0.06, label: 'Est. APY' } },
      { id: 'locked', address: YEARN_YVUSD_LOCKED_ADDRESS, apy: { value: 0.08 } }
    ])
    expect(yBold).toMatchObject({
      symbol: 'ysyBOLD',
      tvlUsd: 6_000_000,
      apy: { value: 0.07 },
      variants: [{ id: 'direct' }, { id: 'staked', symbol: 'ysyBOLD' }]
    })
  })

  it('preserves Katana base and app-reward components without relabelling history', () => {
    const { cache } = normalizeKongCatalog(makeKongVaultList(), 1234)
    const katana = cache.vaults.find(({ id }) => id === 'katana-yvvbusdc')

    expect(katana?.apy).toEqual({
      value: 0.05,
      label: 'Est. APY',
      source: 'katana-estimated-apr',
      baseValue: 0.02,
      appRewardsValue: 0.01
    })
    expect(
      resolveYearnApy({
        ...makeKongVaultList()[0],
        performance: { historical: { monthlyNet: 0.031 } }
      } as never)
    ).toEqual({ value: 0.031, label: 'Historical APY', source: 'historical' })
  })

  it('fails a root closed without affecting other chains', () => {
    const payload = makeKongVaultList().map((vault) =>
      vault.address.toLowerCase() === YEARN_CATALOG[4]?.address.toLowerCase()
        ? { ...vault, isHighlighted: false }
        : vault
    )

    const { cache, errors } = normalizeKongCatalog(payload, 1234)
    const base = cache.vaults.find(({ chainId }) => chainId === 8453)

    expect(base).toMatchObject({ status: 'unavailable', riskLabel: 'Aggressive' })
    expect(errors).toContainEqual({
      chainId: 8453,
      message: 'USDC Horizon yVault is not currently eligible for deposits'
    })
    expect(cache.vaults.filter(({ chainId }) => chainId === 747474)).toHaveLength(3)
    expect(
      cache.vaults.filter(({ chainId }) => chainId === 747474).every(({ status }) => status === 'available')
    ).toBe(true)
  })

  it('fails a product closed when required companion metadata is missing', () => {
    const payload = makeKongVaultList().filter(
      ({ address }) => address.toLowerCase() !== YEARN_YVUSD_LOCKED_ADDRESS.toLowerCase()
    )

    const { cache } = normalizeKongCatalog(payload, 1234)

    expect(cache.vaults[0]).toMatchObject({
      kind: 'yvUSD',
      status: 'unavailable',
      statusReason: 'yvUSD product metadata is incomplete',
      variants: [{ id: 'unlocked' }, { id: 'locked', address: YEARN_YVUSD_LOCKED_ADDRESS }]
    })
  })

  it('fails closed when Kong token or vault decimals differ from curated policy', () => {
    const baseDefinition = YEARN_CATALOG.find(({ id }) => id === 'base-yvusdc-h')!
    const payload = makeKongVaultList().map((vault) =>
      vault.address.toLowerCase() === baseDefinition.address.toLowerCase()
        ? { ...vault, asset: { ...vault.asset, decimals: 18 } }
        : vault
    )

    const { cache, errors } = normalizeKongCatalog(payload, 1234)
    expect(cache.vaults.find(({ id }) => id === baseDefinition.id)).toMatchObject({
      status: 'unavailable',
      asset: {
        address: baseDefinition.asset.address,
        symbol: baseDefinition.asset.symbol,
        decimals: baseDefinition.asset.decimals
      }
    })
    expect(errors).toContainEqual({
      chainId: 8453,
      message: "USDC Horizon yVault token metadata does not match Wren's curated policy"
    })
  })

  it('rejects malformed and unbounded top-level responses', () => {
    expect(() => normalizeKongCatalog({}, 1)).toThrow('invalid shape')
    expect(() => normalizeKongCatalog(new Array(20_001), 1)).toThrow('invalid shape')
  })
})
