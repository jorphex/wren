import { z } from 'zod'

import { FrozenAddressBookEntryV1Schema } from '../50'

const KEY = /^0x[0-9a-f]{40}$/
const MAX_ENTRIES = 1_000

const sanitizeFrozenAddressBookV1 = (current: unknown) => {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return {}

  const addressBook: Record<string, z.infer<typeof FrozenAddressBookEntryV1Schema>> = {}
  Object.entries(current).forEach(([key, candidate]) => {
    const parsed = FrozenAddressBookEntryV1Schema.safeParse(candidate)
    if (
      !KEY.test(key) ||
      !parsed.success ||
      key !== parsed.data.address.toLowerCase() ||
      Object.keys(addressBook).length >= MAX_ENTRIES
    ) {
      return
    }
    addressBook[key] = parsed.data
  })
  return addressBook
}

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

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      addressBook: sanitizeFrozenAddressBookV1(parsed.data.main.addressBook)
    }
  }
}

export default { version: 51, migrate }
