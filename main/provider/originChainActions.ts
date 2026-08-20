import type { Chain, Origin } from '../store/state'

interface OriginChainActionDependencies {
  getOrigin(originId: string): Origin | undefined
  getChain(chainId: number): Chain | undefined
  rejectUnapprovedRequestsForOriginChain(originId: string, chainId: number): void
  mutate(originId: string, chainId: number, type: 'ethereum'): void
}

interface NetworkRouteActionDependencies {
  getOrigins(): Record<string, Origin>
  getNetworks(): Record<string, Chain>
  rejectUnapprovedRequestsForOriginChain(originId: string, chainId: number): void
  mutate(...args: unknown[]): void
}

const routeChanged = (
  dependencies: Pick<NetworkRouteActionDependencies, 'rejectUnapprovedRequestsForOriginChain'>,
  origins: Record<string, Origin>,
  chainId: number
) => {
  Object.entries(origins).forEach(([originId, origin]) => {
    if (origin?.chain?.type === 'ethereum' && origin.chain.id === chainId) {
      dependencies.rejectUnapprovedRequestsForOriginChain(originId, chainId)
    }
  })
}

const parsedChainId = (value: unknown) => {
  if (Number.isSafeInteger(value) && Number(value) > 0) return Number(value)
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/u.test(value)) return undefined
  const chainId = Number(value)
  return Number.isSafeInteger(chainId) ? chainId : undefined
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

  dependencies.rejectUnapprovedRequestsForOriginChain(originId, origin.chain.id)
  dependencies.mutate(originId, Number(chainId), type)
  return true
}

/**
 * Network management routes origins to mainnet when a chain is disabled or
 * removed. Reject pending work while the old route is still authoritative.
 */
export function applyNetworkRouteRendererAction(
  action: 'activateNetwork' | 'removeNetwork',
  args: readonly unknown[],
  dependencies: NetworkRouteActionDependencies
) {
  if (action === 'activateNetwork') {
    const [type, rawChainId, active] = args
    const chainId = parsedChainId(rawChainId)
    if (type !== 'ethereum' || chainId === undefined || typeof active !== 'boolean') return false

    const network = dependencies.getNetworks()[chainId]
    if (!network || network.on === active) return false
    if (!active) routeChanged(dependencies, dependencies.getOrigins(), chainId)
    dependencies.mutate(type, rawChainId, active)
    return true
  }

  const [network] = args
  if (!network || typeof network !== 'object') return false
  const { type, id } = network as { type?: unknown; id?: unknown }
  const chainId = parsedChainId(id)
  if (type !== 'ethereum' || chainId === undefined || chainId === 1) return false

  const networks = dependencies.getNetworks()
  if (!networks[chainId] || Object.keys(networks).length <= 1) return false

  routeChanged(dependencies, dependencies.getOrigins(), chainId)
  dependencies.mutate({ type, id: chainId })
  return true
}
