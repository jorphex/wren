import { getAddress } from 'ethers'

export const MAX_ADDRESS_BOOK_ENTRIES = 1_000

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const KEY = /^0x[0-9a-f]{40}$/
const ENTRY_KEYS = ['address', 'name', 'note', 'createdAt', 'updatedAt']

export const normalizeAddressBookText = (value: string) => value.trim().replace(/\s+/g, ' ')
export const hasAddressBookControlCharacters = (value: string) => /[\p{Cc}\p{Cf}]/u.test(value)

interface LocalAddressBookEntry {
  address: string
  name: string
  note: string
  createdAt: number
  updatedAt: number
}

export interface LocalAddressIdentity {
  label: string
  source: 'Saved contact' | 'Wren account'
}

const parseAddress = (address: unknown) => {
  if (typeof address !== 'string' || !ADDRESS.test(address.trim())) return
  try {
    return getAddress(address.trim())
  } catch {
    return
  }
}

const parseEntry = (key: string, candidate: unknown): LocalAddressBookEntry | undefined => {
  if (!KEY.test(key) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
  if (Object.keys(candidate).length !== ENTRY_KEYS.length) return
  if (!ENTRY_KEYS.every((entryKey) => Object.prototype.hasOwnProperty.call(candidate, entryKey))) return

  const entry = candidate as Partial<LocalAddressBookEntry>
  const address = parseAddress(entry.address)
  if (!address || entry.address !== address || key !== address.toLowerCase()) return
  if (
    typeof entry.name !== 'string' ||
    !entry.name ||
    entry.name.length > 80 ||
    entry.name !== normalizeAddressBookText(entry.name) ||
    hasAddressBookControlCharacters(entry.name)
  ) {
    return
  }
  if (
    typeof entry.note !== 'string' ||
    entry.note.length > 280 ||
    entry.note !== normalizeAddressBookText(entry.note) ||
    hasAddressBookControlCharacters(entry.note)
  ) {
    return
  }
  if (
    !Number.isInteger(entry.createdAt) ||
    (entry.createdAt as number) < 0 ||
    !Number.isInteger(entry.updatedAt) ||
    (entry.updatedAt as number) < (entry.createdAt as number)
  ) {
    return
  }

  return {
    address: entry.address,
    name: entry.name,
    note: entry.note,
    createdAt: entry.createdAt as number,
    updatedAt: entry.updatedAt as number
  }
}

export function lookupAddressBookEntry(
  current: unknown,
  address: unknown
): LocalAddressBookEntry | undefined {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return
  const entries = Object.entries(current)
  if (entries.length > MAX_ADDRESS_BOOK_ENTRIES) return

  const parsed = new Map<string, LocalAddressBookEntry>()
  for (const [key, candidate] of entries) {
    const entry = parseEntry(key, candidate)
    if (!entry) return
    parsed.set(key, entry)
  }

  const normalizedAddress = parseAddress(address)
  return normalizedAddress ? parsed.get(normalizedAddress.toLowerCase()) : undefined
}

export function resolveLocalAddressIdentity(
  addressBook: unknown,
  accounts: unknown,
  address: unknown
): LocalAddressIdentity | undefined {
  const saved = lookupAddressBookEntry(addressBook, address)
  if (saved) return { label: saved.name, source: 'Saved contact' }

  const normalizedAddress = parseAddress(address)
  if (!normalizedAddress || !accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return

  const accountMap = accounts as Record<string, unknown>
  const key = normalizedAddress.toLowerCase()
  const account =
    accountMap[key] || Object.entries(accountMap).find(([candidate]) => candidate.toLowerCase() === key)?.[1]
  if (!account || typeof account !== 'object' || Array.isArray(account)) return

  const name = (account as { name?: unknown }).name
  if (typeof name !== 'string' || !normalizeAddressBookText(name) || hasAddressBookControlCharacters(name)) {
    return
  }
  return { label: normalizeAddressBookText(name), source: 'Wren account' }
}
