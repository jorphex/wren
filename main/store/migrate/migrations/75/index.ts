import { z } from 'zod'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u

const StateSchema = z
  .object({
    main: z.object({ accounts: z.unknown().optional() }).passthrough()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const normalizeAccounts = (source: unknown) => {
  if (!isRecord(source)) return source

  const entries = Object.entries(source).sort(([left], [right]) => {
    const leftCanonical = ADDRESS.test(left) && left === left.toLowerCase()
    const rightCanonical = ADDRESS.test(right) && right === right.toLowerCase()
    return Number(leftCanonical) - Number(rightCanonical)
  })

  return entries.reduce<Record<string, unknown>>((accounts, [key, candidate]) => {
    if (!ADDRESS.test(key) || !isRecord(candidate)) {
      accounts[key] = candidate
      return accounts
    }

    const address = key.toLowerCase()
    const existing = isRecord(accounts[address]) ? accounts[address] : {}
    accounts[address] = { ...existing, ...candidate, id: address, address }
    return accounts
  }, {})
}

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      accounts: normalizeAccounts(parsed.data.main.accounts)
    }
  }
}

export default { version: 75, migrate }
