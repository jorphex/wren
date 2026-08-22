interface AccountSelection {
  getSelectedAddresses(): string[]
}

interface AccountSubscriptionProvider {
  accountsChanged(addresses: string[], originIds?: readonly string[]): void
}

export function notifyPermissionAction(
  address: string,
  accounts: AccountSelection,
  provider: AccountSubscriptionProvider,
  affectedOriginIds?: readonly string[]
) {
  const selected = accounts.getSelectedAddresses()
  if (selected.some((candidate) => candidate.toLowerCase() === address.toLowerCase())) {
    provider.accountsChanged(selected, affectedOriginIds)
  }
}

export function applyPermissionAction(
  address: string,
  action: () => void,
  accounts: AccountSelection,
  provider: AccountSubscriptionProvider,
  affectedOriginIds?: readonly string[]
) {
  action()
  notifyPermissionAction(address, accounts, provider, affectedOriginIds)
}
