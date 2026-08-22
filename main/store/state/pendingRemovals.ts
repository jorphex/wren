import { isSafeSignerId } from '../../../resources/domain/signerId'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeAddresses = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((address): address is string =>
          typeof address === 'string' ? ADDRESS_PATTERN.test(address) : false
        )
        .map((address) => address.toLowerCase())
    )
  ].slice(0, 1000)
}

type PendingSignerRemoval = {
  addresses: string[]
  deviceId?: string
  kind: 'hardware' | 'hot' | 'lattice'
}

const normalizeSignerRemovals = (value: unknown): Record<string, PendingSignerRemoval> => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, removal]) => {
      if (!id || id.length > 256 || !isRecord(removal) || !Array.isArray(removal['addresses'])) return []
      const rawKind = removal['kind']
      const kind =
        rawKind === 'hardware' || rawKind === 'hot' || rawKind === 'lattice'
          ? rawKind
          : /^[0-9a-fA-F]{64}$/u.test(id)
            ? 'hot'
            : undefined
      if (!kind) return []
      if (kind === 'hot' && !isSafeSignerId(id)) return []
      const deviceId = typeof removal['deviceId'] === 'string' ? removal['deviceId'] : undefined
      if (kind === 'lattice' && (!deviceId || deviceId.length > 256)) {
        return []
      }
      const normalized: PendingSignerRemoval =
        kind === 'lattice'
          ? { addresses: normalizeAddresses(removal['addresses']), deviceId: deviceId!, kind }
          : { addresses: normalizeAddresses(removal['addresses']), kind }
      return [[id, normalized]]
    })
  )
}

const withoutRemovedAddresses = (entries: unknown, removed: ReadonlySet<string>) =>
  Object.fromEntries(
    Object.entries(isRecord(entries) ? entries : {}).filter(
      ([address]) => !removed.has(address.toLowerCase())
    )
  )

const withoutRemovedAccounts = (entries: unknown, removed: ReadonlySet<string>) => {
  const source = isRecord(entries) ? entries : {}
  const removedSelectedAccount = Object.entries(source).some(
    ([address, account]) =>
      removed.has(address.toLowerCase()) && isRecord(account) && account['active'] === true
  )
  const accounts = withoutRemovedAddresses(source, removed)
  if (
    removedSelectedAccount &&
    !Object.values(accounts).some((account) => isRecord(account) && account['active'] === true)
  ) {
    const replacementAddress = Object.keys(accounts)[0]
    const replacement = replacementAddress ? accounts[replacementAddress] : undefined
    if (replacementAddress && isRecord(replacement)) {
      accounts[replacementAddress] = { ...replacement, active: true }
    }
  }
  return accounts
}

export const applyPendingRemovalJournals = (state: Record<string, unknown>) => {
  const pendingAccountRemovals = normalizeAddresses(state['pendingAccountRemovals'])
  const pendingSignerRemovals = normalizeSignerRemovals(state['pendingSignerRemovals'])
  const pendingSignerIds = new Set(Object.keys(pendingSignerRemovals))
  const retainedSignerAddresses = new Set(
    Object.entries(isRecord(state['signers']) ? state['signers'] : {}).flatMap(([id, signer]) =>
      pendingSignerIds.has(id) || !isRecord(signer) ? [] : normalizeAddresses(signer['addresses'])
    )
  )
  const requestedSignerRemovedAddresses = Object.values(pendingSignerRemovals).flatMap(
    ({ addresses }) => addresses
  )
  const removedAddresses = new Set([
    ...pendingAccountRemovals,
    ...requestedSignerRemovedAddresses.filter((address) => !retainedSignerAddresses.has(address))
  ])
  const lattice = { ...(isRecord(state['lattice']) ? state['lattice'] : {}) }
  Object.values(pendingSignerRemovals).forEach((removal) => {
    if (removal.kind === 'lattice' && removal.deviceId) delete lattice[removal.deviceId]
  })

  return {
    accounts: withoutRemovedAccounts(state['accounts'], removedAddresses),
    dappGuardrails: withoutRemovedAddresses(state['dappGuardrails'], removedAddresses),
    lattice,
    pendingAccountRemovals: [],
    pendingSignerRemovals: Object.fromEntries(
      Object.entries(pendingSignerRemovals)
        .filter(([, removal]) => removal.kind === 'hot')
        .map(([id, removal]) => [
          id,
          {
            ...removal,
            // Persist replacement ownership discovered in the previous
            // profile before transient signer summaries are cleared.
            addresses: removal.addresses.filter((address) => !retainedSignerAddresses.has(address))
          }
        ])
    ),
    permissions: withoutRemovedAddresses(state['permissions'], removedAddresses)
  }
}
