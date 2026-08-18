import { getAddress } from 'ethers'
import { z } from 'zod'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const KEY = /^0x[0-9a-f]{40}$/
const MAX_ENTRIES = 1_000
const normalizedText = (value: string) => value.trim().replace(/\s+/g, ' ')
const hasControlCharacters = (value: string) => /[\p{Cc}\p{Cf}]/u.test(value)
const isNormalizedAddress = (value: string) => {
  try {
    return value === getAddress(value)
  } catch {
    return false
  }
}

const FrozenAddressInputV1Schema = z
  .string()
  .trim()
  .regex(ADDRESS)
  .refine((value) => {
    try {
      getAddress(value)
      return true
    } catch {
      return false
    }
  })

export const FrozenAddressBookEntryV1BaseSchema = z
  .object({
    address: FrozenAddressInputV1Schema.refine(isNormalizedAddress),
    name: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value === normalizedText(value))
      .refine((value) => !hasControlCharacters(value)),
    note: z
      .string()
      .max(280)
      .refine((value) => value === normalizedText(value))
      .refine((value) => !hasControlCharacters(value)),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()

export const FrozenAddressBookEntryV1Schema = FrozenAddressBookEntryV1BaseSchema.refine(
  ({ createdAt, updatedAt }) => updatedAt >= createdAt
)

export const FrozenAddressBookV1Schema = z
  .record(z.string().regex(KEY), FrozenAddressBookEntryV1Schema)
  .refine((book) => Object.keys(book).length <= MAX_ENTRIES)
  .refine((book) => Object.entries(book).every(([key, entry]) => key === entry.address.toLowerCase()))

const StateSchema = z
  .object({
    main: z
      .object({
        _version: z.number(),
        addressBook: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial
  const addressBook = FrozenAddressBookV1Schema.safeParse(parsed.data.main.addressBook)

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      addressBook: addressBook.success ? addressBook.data : {}
    }
  }
}

export default { version: 50, migrate }
