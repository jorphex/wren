import type { Chain, Origin } from '../store/state'

interface OriginChainActionDependencies {
  getOrigin(originId: string): Origin | undefined
  getChain(chainId: number): Chain | undefined
  mutate(originId: string, chainId: number, type: 'ethereum'): void
}

export function applyOriginChainRendererAction(
  args: readonly unknown[],
  dependencies: OriginChainActionDependencies
) {
  const [originId, chainId, type] = args
  if (
    typeof originId !== 'string' ||
    originId.length === 0 ||
    !Number.isSafeInteger(chainId) ||
    Number(chainId) <= 0 ||
    type !== 'ethereum'
  ) {
    return false
  }

  const origin = dependencies.getOrigin(originId)
  const chain = dependencies.getChain(Number(chainId))
  if (!origin || !chain || chain.on !== true || origin.chain.id === chainId) return false

  dependencies.mutate(originId, Number(chainId), type)
  return true
}
