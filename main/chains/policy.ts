import { chainUsesOptimismFees } from '../../resources/utils/chains'

const LEGACY_FEE_CHAIN_IDS = new Set([250, 4002, 42161])

export type FeeHistoryPolicy = 'default' | 'polygon' | 'op-stack'

export function supportsFeeHistory(chainId: string | number) {
  return !LEGACY_FEE_CHAIN_IDS.has(Number(chainId))
}

export function feeHistoryPolicy(chainId: string | number): FeeHistoryPolicy {
  const id = Number(chainId)
  if (id === 137) return 'polygon'
  if (chainUsesOptimismFees(id)) return 'op-stack'
  return 'default'
}
