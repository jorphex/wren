import type { YearnChainId } from '../../resources/domain/yearn'

export type YearnProductKind = 'direct' | 'yvUSD' | 'yBOLD'

export interface YearnCatalogDefinition {
  id: string
  chainId: YearnChainId
  chainName: 'Ethereum' | 'Base'
  address: Address
  kind: YearnProductKind
  name: string
  symbol: string
  description: string
  asset: {
    address: Address
    symbol: string
    decimals: number
  }
  decimals: number
  companions?: ReadonlyArray<{
    id: 'locked' | 'staked'
    address: Address
    name: string
    symbol: string
    decimals: number
  }>
  periphery?: ReadonlyArray<Address>
}

export const YEARN_YVUSD_LOCKED_ADDRESS = '0xAaaFEa48472f77563961Cdb53291DEDfB46F9040'
export const YEARN_YVUSD_ZAP_ADDRESS = '0x7ba61c8e19414dcB8fe769a7Be63B508C8062bbA'
export const YEARN_YBOLD_STAKED_ADDRESS = '0x23346B04a7f55b8760E5860AA5A77383D63491cD'
export const YEARN_YBOLD_ZAP_ADDRESS = '0xe7099092533a3fb693bb123cd96b8e53b4d83c58'

export const YEARN_CATALOG_VERSION = 2

export const YEARN_CATALOG: readonly YearnCatalogDefinition[] = [
  {
    id: 'ethereum-yvusd',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x696d02Db93291651ED510704c9b286841d506987',
    kind: 'yvUSD',
    name: 'yvUSD',
    symbol: 'yvUSD',
    description: 'A USDC-denominated Yearn vault with liquid and higher-yield locked variants.',
    asset: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      decimals: 6
    },
    decimals: 6,
    companions: [
      {
        id: 'locked',
        address: YEARN_YVUSD_LOCKED_ADDRESS,
        name: 'Locked yvUSD',
        symbol: 'Locked yvUSD',
        decimals: 6
      }
    ],
    periphery: [YEARN_YVUSD_ZAP_ADDRESS]
  },
  {
    id: 'ethereum-yvusds-1',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x182863131F9a4630fF9E27830d945B1413e347E8',
    kind: 'direct',
    name: 'USDS-1 yVault',
    symbol: 'yvUSDS-1',
    description: 'A multi-strategy Yearn vault for USDS.',
    asset: {
      address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
      symbol: 'USDS',
      decimals: 18
    },
    decimals: 18
  },
  {
    id: 'ethereum-yvweth-1',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0',
    kind: 'direct',
    name: 'WETH-1 yVault',
    symbol: 'yvWETH-1',
    description: 'A multi-strategy Yearn vault for wrapped Ether.',
    asset: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      decimals: 18
    },
    decimals: 18
  },
  {
    id: 'ethereum-ybold',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x9F4330700a36B29952869fac9b33f45EEdd8A3d8',
    kind: 'yBOLD',
    name: 'Staked yBOLD',
    symbol: 'yBOLD',
    description: 'A Yearn BOLD position deposited into yBOLD and staked as ysyBOLD.',
    asset: {
      address: '0x6440f144b7e50D6a8439336510312d2F54beB01D',
      symbol: 'BOLD',
      decimals: 18
    },
    decimals: 18,
    companions: [
      {
        id: 'staked',
        address: YEARN_YBOLD_STAKED_ADDRESS,
        name: 'Staked yBOLD',
        symbol: 'ysyBOLD',
        decimals: 18
      }
    ],
    periphery: [YEARN_YBOLD_ZAP_ADDRESS]
  },
  {
    id: 'base-yvusdc-h',
    chainId: 8453,
    chainName: 'Base',
    address: '0xc3BD0A2193c8F027B82ddE3611D18589ef3f62a9',
    kind: 'direct',
    name: 'USDC Horizon yVault',
    symbol: 'yvUSDC-H',
    description:
      'A higher-risk Horizon multi-strategy vault for native Base USDC using less-proven yield venues.',
    asset: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6
    },
    decimals: 6
  }
]

export const YEARN_SYSTEM_TOKENS = YEARN_CATALOG.flatMap((vault) => [
  {
    chainId: vault.chainId,
    address: vault.asset.address,
    name: vault.asset.symbol,
    symbol: vault.asset.symbol,
    decimals: vault.asset.decimals
  },
  {
    chainId: vault.chainId,
    address: vault.address,
    name: vault.name,
    symbol: vault.symbol,
    decimals: vault.decimals
  },
  ...(vault.companions || []).map((companion) => ({
    chainId: vault.chainId,
    address: companion.address,
    name: companion.name,
    symbol: companion.symbol,
    decimals: companion.decimals
  }))
])

export const yearnVaultKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`

const YEARN_SYSTEM_TOKEN_IDS = new Set(
  YEARN_SYSTEM_TOKENS.map(({ chainId, address }) => yearnVaultKey(chainId, address))
)

export const isYearnSystemTokenId = (tokenId: string) => YEARN_SYSTEM_TOKEN_IDS.has(tokenId.toLowerCase())

export const isYearnSystemToken = (token: { chainId: number; address: string }) =>
  isYearnSystemTokenId(yearnVaultKey(token.chainId, token.address))

export const YEARN_ALLOWED_TARGETS = new Set(
  YEARN_CATALOG.flatMap((vault) => [
    yearnVaultKey(vault.chainId, vault.address),
    ...(vault.companions || []).map((entry) => yearnVaultKey(vault.chainId, entry.address)),
    ...(vault.periphery || []).map((address) => yearnVaultKey(vault.chainId, address))
  ])
)
