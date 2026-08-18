import { z } from 'zod'

import { FrozenAddressBookEntryV1BaseSchema, FrozenAddressBookEntryV1Schema } from '../50'

const KEY = /^0x[0-9a-f]{40}$/
const MAX_ENTRIES = 1_000
const MAX_TIMESTAMP = 253_402_300_799_999
const normalizedText = (value: string) => value.trim().replace(/\s+/g, ' ')
const hasControlCharacters = (value: string) => /[\p{Cc}\p{Cf}]/u.test(value)

const FrozenAddressBookProvenanceV2Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved') }).strict(),
  z
    .object({
      status: z.literal('verified-out-of-band'),
      verifiedAt: z.number().int().nonnegative().max(MAX_TIMESTAMP),
      note: z
        .string()
        .max(280)
        .refine((value) => value === normalizedText(value))
        .refine((value) => !hasControlCharacters(value))
    })
    .strict()
])

const FrozenAddressBookEntryV2Schema = FrozenAddressBookEntryV1BaseSchema.extend({
  provenance: FrozenAddressBookProvenanceV2Schema
})
  .strict()
  .refine(({ createdAt, updatedAt }) => updatedAt >= createdAt)
  .refine(({ createdAt, updatedAt }) => createdAt <= MAX_TIMESTAMP && updatedAt <= MAX_TIMESTAMP)
  .refine(
    ({ provenance, createdAt, updatedAt }) =>
      provenance.status === 'saved' ||
      (provenance.verifiedAt >= createdAt && provenance.verifiedAt <= updatedAt)
  )

const StateSchema = z
  .object({
    main: z
      .object({
        addressBook: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const addressBook: Record<string, z.infer<typeof FrozenAddressBookEntryV2Schema>> = {}
  const current = parsed.data.main.addressBook
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    Object.entries(current).forEach(([key, candidate]) => {
      if (!KEY.test(key) || Object.keys(addressBook).length >= MAX_ENTRIES) return

      const currentEntry = FrozenAddressBookEntryV2Schema.safeParse(candidate)
      if (currentEntry.success && key === currentEntry.data.address.toLowerCase()) {
        addressBook[key] = currentEntry.data
        return
      }

      const legacy = FrozenAddressBookEntryV1Schema.safeParse(candidate)
      if (
        !legacy.success ||
        key !== legacy.data.address.toLowerCase() ||
        legacy.data.createdAt > MAX_TIMESTAMP ||
        legacy.data.updatedAt > MAX_TIMESTAMP
      ) {
        return
      }
      addressBook[key] = { ...legacy.data, provenance: { status: 'saved' } }
    })
  }

  return { ...parsed.data, main: { ...parsed.data.main, addressBook } }
}

export default { version: 65, migrate }
