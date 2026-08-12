const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withoutRequestState = (value: unknown) => {
  if (!isRecord(value)) return value
  const { requests: _requests, activeRequestId: _activeRequestId, ...persisted } = value
  return persisted
}

const sanitizedAccounts = (value: unknown) => {
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([account, accountValue]) => [account, withoutRequestState(accountValue)])
  )
}

const sanitizedMain = (value: unknown) => {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'accounts')) return value
  return { ...value, accounts: sanitizedAccounts(value['accounts']) }
}

export type PersistableStateUpdate = Readonly<{ path: string; value: unknown }> | null

export const sanitizePersistedStateUpdate = (path: string, value: unknown): PersistableStateUpdate => {
  if (path === 'main') return { path, value: sanitizedMain(value) }
  if (path === 'main.accounts') return { path, value: sanitizedAccounts(value) }

  const match = /^main\.accounts\.[^.]+(?:\.(.+))?$/u.exec(path)
  if (!match) return { path, value }
  const childPath = match[1]
  if (childPath === 'requests' || childPath?.startsWith('requests.')) return null
  if (childPath === 'activeRequestId' || childPath?.startsWith('activeRequestId.')) return null
  if (!childPath) return { path, value: withoutRequestState(value) }
  return { path, value }
}

export const pruneTransientPersistedState = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value['__'])) return value

  let changed = false
  const versions = Object.fromEntries(
    Object.entries(value['__']).map(([version, entry]) => {
      if (!isRecord(entry) || !Object.prototype.hasOwnProperty.call(entry, 'main')) {
        return [version, entry]
      }
      if (Object.keys(entry).length === 1) return [version, entry]
      changed = true
      return [version, { main: entry['main'] }]
    })
  )

  return changed ? { ...value, __: versions } : value
}
