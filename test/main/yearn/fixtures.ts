import {
  YEARN_CATALOG,
  YEARN_YBOLD_STAKED_ADDRESS,
  YEARN_YVUSD_LOCKED_ADDRESS
} from '../../../main/yearn/catalog'

const assets: Record<string, { address: string; name: string; symbol: string; decimals: number }> = {
  'ethereum-yvusd': {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6
  },
  'ethereum-yvusds-1': {
    address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
    name: 'USDS Stablecoin',
    symbol: 'USDS',
    decimals: 18
  },
  'ethereum-yvweth-1': {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18
  },
  'ethereum-ybold': {
    address: '0x6440f144b7e50D6a8439336510312d2F54beB01D',
    name: 'BOLD Stablecoin',
    symbol: 'BOLD',
    decimals: 18
  },
  'base-yvusdc-h': {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6
  }
}

export const makeKongVaultList = () => {
  const roots = YEARN_CATALOG.map((definition, index) => {
    const asset = assets[definition.id]
    if (!asset) throw new Error(`Missing fixture asset for ${definition.id}`)
    return {
      chainId: definition.chainId,
      address: definition.address,
      name: definition.name,
      symbol: `yv${asset.symbol}`,
      kind: 'Multi Strategy',
      origin: 'yearn',
      inclusion: { isYearn: true },
      isHidden: false,
      isRetired: false,
      isHighlighted: true,
      asset,
      decimals: asset.decimals,
      tvl: 1_000_000 - index,
      riskLevel: definition.id === 'base-yvusdc-h' ? 3 : 1,
      fees: { managementFee: 0, performanceFee: 1000 },
      performance: {
        oracle: { netAPY: 0.04 },
        historical: { monthlyNet: 0.03 },
        ...(definition.kind === 'yvUSD' ? { estimated: { apy: 0.06, type: 'yvusd-estimated-apr' } } : {})
      },
      inceptTime: 1_700_000_000
    }
  })

  return [
    ...roots,
    {
      chainId: 1,
      address: YEARN_YVUSD_LOCKED_ADDRESS,
      name: 'Locked yvUSD',
      symbol: 'Locked yvUSD',
      kind: 'None',
      origin: 'yearn',
      inclusion: { isYearn: true },
      isHidden: false,
      isRetired: false,
      isHighlighted: false,
      asset: {
        address: YEARN_CATALOG[0]?.address,
        name: 'USD yVault',
        symbol: 'yvUSD',
        decimals: 6
      },
      decimals: 6,
      tvl: 3_000_000,
      riskLevel: null,
      fees: { managementFee: 0, performanceFee: 0 },
      performance: {
        estimated: { apy: 0.08, type: 'yvusd-estimated-apr', components: {} }
      },
      inceptTime: 1_700_000_100
    },
    {
      chainId: 1,
      address: YEARN_YBOLD_STAKED_ADDRESS,
      name: 'Staked yBOLD',
      symbol: 'ysyBOLD',
      kind: 'Single Strategy',
      origin: 'yearn',
      inclusion: { isYearn: true },
      isHidden: false,
      isRetired: false,
      isHighlighted: false,
      asset: {
        address: YEARN_CATALOG[3]?.address,
        name: 'Yearn BOLD',
        symbol: 'yBOLD',
        decimals: 18
      },
      decimals: 18,
      tvl: 6_000_000,
      riskLevel: null,
      fees: { managementFee: 0, performanceFee: 0 },
      performance: { oracle: { netAPY: 0.0637 }, historical: { weeklyNet: 0.9237 } },
      inceptTime: 1_700_000_200
    }
  ]
}
