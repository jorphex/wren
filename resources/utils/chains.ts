import type { Chain } from '../../main/store/state'

export function isNetworkConnected(network: Chain) {
  return network && network.connection.endpoints.some((endpoint) => endpoint.connected)
}

export function isNetworkEnabled(network: Chain) {
  return network.on
}

export function chainUsesOptimismFees(chainId: number) {
  return [10, 420, 8453, 84531, 84532, 7777777, 11155420].includes(chainId)
}
