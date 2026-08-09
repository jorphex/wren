const chainFamilies = Object.freeze({
  1: 'ethereum',
  10: 'optimism',
  100: 'gnosis',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  84532: 'base',
  747474: 'katana',
  11155111: 'ethereum',
  11155420: 'optimism'
})

const identities = Object.freeze({
  ethereum: Object.freeze({ colorToken: '--wren-chain-ethereum', mark: 'ethereum' }),
  optimism: Object.freeze({ colorToken: '--wren-chain-optimism', mark: 'optimism' }),
  gnosis: Object.freeze({ colorToken: '--wren-chain-gnosis', mark: 'gnosis' }),
  polygon: Object.freeze({ colorToken: '--wren-chain-polygon', mark: 'polygon' }),
  base: Object.freeze({ colorToken: '--wren-chain-base', mark: 'base' }),
  arbitrum: Object.freeze({ colorToken: '--wren-chain-arbitrum', mark: 'arbitrum' }),
  katana: Object.freeze({ colorToken: '--wren-chain-katana', mark: 'katana' }),
  custom: Object.freeze({ colorToken: '--wren-chain-custom', mark: 'chain' })
})

export function getChainIdentity(chainId, isTestnet = false) {
  const family = chainFamilies[Number(chainId)] || 'custom'
  const identity = identities[family]

  return isTestnet ? { ...identity, colorToken: '--wren-chain-testnet' } : identity
}
