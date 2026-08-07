import store from '../store'

import type { Permission } from '../store/state'
import { isTrustedOriginId, originIdForName } from '../../resources/domain/origin'

export { isTrustedOriginId, originIdForName }

export const enum SubscriptionType {
  ACCOUNTS = 'accountsChanged',
  ASSETS = 'assetsChanged',
  CHAIN = 'chainChanged',
  CHAINS = 'chainsChanged',
  NETWORK = 'networkChanged'
}

const subscriptionTypes = new Set<string>([
  SubscriptionType.ACCOUNTS,
  SubscriptionType.ASSETS,
  SubscriptionType.CHAIN,
  SubscriptionType.CHAINS,
  SubscriptionType.NETWORK
])

export const isFrameSubscriptionType = (value: unknown) =>
  typeof value === 'string' && subscriptionTypes.has(value)

export type Subscription = {
  id: string
  originId: string
}

export function hasSubscriptionPermission(subType: string, address: string | undefined, originId: string) {
  if (subType === SubscriptionType.CHAINS && isTrustedOriginId(originId)) {
    // internal trusted origins are allowed to subscribe to chain changes without approval
    return true
  }

  if (!address) {
    return false
  }

  const permissions = (store('main.permissions', address) || {}) as Record<string, Permission>
  const permission = Object.values(permissions).find(({ origin }) => {
    return originIdForName(origin) === originId
  })

  return !!permission?.provider
}
