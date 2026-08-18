import { getAddress } from 'ethers'
import { z } from 'zod'

import {
  hasAddressBookControlCharacters as hasControlCharacters,
  MAX_ADDRESS_BOOK_ENTRIES,
  MAX_ADDRESS_BOOK_TIMESTAMP,
  normalizeAddressBookText as normalizedText
} from './identity'

export {
  lookupAddressBookEntry,
  MAX_ADDRESS_BOOK_ENTRIES,
  MAX_ADDRESS_BOOK_TIMESTAMP,
  resolveLocalAddressIdentity,
  type LocalAddressBookEntry,
  type LocalAddressIdentity
} from './identity'

export const ADDRESS_BOOK_FORMAT = 'frame-address-book'
export const ADDRESS_BOOK_VERSION = 2
export const MAX_ADDRESS_BOOK_FILE_BYTES = 1024 * 1024
export const MAX_ADDRESS_BOOK_PROVENANCE_NOTE_LENGTH = 280

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const KEY = /^0x[0-9a-f]{40}$/

const isNormalizedAddress = (value: string) => {
  try {
    return value === getAddress(value)
  } catch {
    return false
  }
}

export const AddressBookAddressInputSchema = z
  .string()
  .trim()
  .regex(ADDRESS, 'Enter a valid Ethereum address')
  .refine((value) => {
    try {
      getAddress(value)
      return true
    } catch {
      return false
    }
  }, 'Address checksum is invalid')

export const AddressBookNameInputSchema = z
  .string()
  .transform(normalizedText)
  .pipe(z.string().min(1, 'Name is required').max(80, 'Name must be 80 characters or fewer'))
  .refine((value) => !hasControlCharacters(value), 'Name contains unsupported characters')

export const AddressBookNoteInputSchema = z
  .string()
  .transform(normalizedText)
  .pipe(z.string().max(280, 'Note must be 280 characters or fewer'))
  .refine((value) => !hasControlCharacters(value), 'Note contains unsupported characters')

export const AddressBookProvenanceNoteInputSchema = z
  .string()
  .transform(normalizedText)
  .pipe(
    z
      .string()
      .max(
        MAX_ADDRESS_BOOK_PROVENANCE_NOTE_LENGTH,
        `Verification note must be ${MAX_ADDRESS_BOOK_PROVENANCE_NOTE_LENGTH} characters or fewer`
      )
  )
  .refine((value) => !hasControlCharacters(value), 'Verification note contains unsupported characters')

export const AddressBookProvenanceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved') }).strict(),
  z
    .object({
      status: z.literal('verified-out-of-band'),
      verifiedAt: z.number().int().nonnegative().max(MAX_ADDRESS_BOOK_TIMESTAMP),
      note: z
        .string()
        .max(MAX_ADDRESS_BOOK_PROVENANCE_NOTE_LENGTH)
        .refine((value) => value === normalizedText(value))
        .refine((value) => !hasControlCharacters(value), 'Verification note contains unsupported characters')
    })
    .strict()
])

export const AddressBookProvenanceInputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved') }).strict(),
  z
    .object({
      status: z.literal('verified-out-of-band'),
      note: AddressBookProvenanceNoteInputSchema
    })
    .strict()
])

export const AddressBookEntrySchema = z
  .object({
    address: AddressBookAddressInputSchema.refine(
      isNormalizedAddress,
      'Address must use its normalized checksum'
    ),
    name: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value === normalizedText(value))
      .refine((value) => !hasControlCharacters(value), 'Name contains unsupported characters'),
    note: z
      .string()
      .max(280)
      .refine((value) => value === normalizedText(value))
      .refine((value) => !hasControlCharacters(value), 'Note contains unsupported characters'),
    provenance: AddressBookProvenanceSchema,
    createdAt: z.number().int().nonnegative().max(MAX_ADDRESS_BOOK_TIMESTAMP),
    updatedAt: z.number().int().nonnegative().max(MAX_ADDRESS_BOOK_TIMESTAMP)
  })
  .strict()
  .refine(({ createdAt, updatedAt }) => updatedAt >= createdAt, 'Updated time precedes creation time')
  .refine(
    ({ provenance, createdAt, updatedAt }) =>
      provenance.status === 'saved' ||
      (provenance.verifiedAt >= createdAt && provenance.verifiedAt <= updatedAt),
    'Verification time falls outside the contact lifetime'
  )

export const AddressBookSchema = z
  .record(z.string().regex(KEY), AddressBookEntrySchema)
  .refine((book) => Object.keys(book).length <= MAX_ADDRESS_BOOK_ENTRIES, 'Contacts list is too large')
  .refine(
    (book) => Object.entries(book).every(([key, entry]) => key === entry.address.toLowerCase()),
    'Contact key does not match its entry'
  )

export const AddressBookSaveRequestSchema = z
  .object({
    mode: z.enum(['add', 'edit']),
    address: AddressBookAddressInputSchema,
    name: AddressBookNameInputSchema,
    note: AddressBookNoteInputSchema,
    provenance: AddressBookProvenanceInputSchema.optional()
  })
  .strict()

const AddressBookExportEntryV1Schema = z
  .object({
    address: AddressBookAddressInputSchema,
    name: AddressBookNameInputSchema,
    note: AddressBookNoteInputSchema,
    createdAt: z.number().int().nonnegative().max(MAX_ADDRESS_BOOK_TIMESTAMP),
    updatedAt: z.number().int().nonnegative().max(MAX_ADDRESS_BOOK_TIMESTAMP)
  })
  .strict()
  .refine(({ createdAt, updatedAt }) => updatedAt >= createdAt, 'Updated time precedes creation time')

const AddressBookExportV1Schema = z
  .object({
    format: z.literal(ADDRESS_BOOK_FORMAT),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    entries: z.array(AddressBookExportEntryV1Schema).max(MAX_ADDRESS_BOOK_ENTRIES)
  })
  .strict()

const AddressBookExportV2Schema = z
  .object({
    format: z.literal(ADDRESS_BOOK_FORMAT),
    version: z.literal(ADDRESS_BOOK_VERSION),
    exportedAt: z.string().datetime(),
    entries: z.array(AddressBookEntrySchema).max(MAX_ADDRESS_BOOK_ENTRIES)
  })
  .strict()

export const AddressBookExportSchema = z.discriminatedUnion('version', [
  AddressBookExportV1Schema,
  AddressBookExportV2Schema
])

export type AddressBookEntry = z.infer<typeof AddressBookEntrySchema>
export type AddressBook = z.infer<typeof AddressBookSchema>
export type AddressBookSaveRequest = z.infer<typeof AddressBookSaveRequestSchema>
export type AddressBookExport = z.infer<typeof AddressBookExportSchema>
export type AddressBookProvenance = z.infer<typeof AddressBookProvenanceSchema>
export type AddressBookProvenanceInput = z.infer<typeof AddressBookProvenanceInputSchema>

const normalizeAddress = (address: string) => getAddress(address.trim())
const entryKey = (address: string) => normalizeAddress(address).toLowerCase()
const normalizedNameKey = (name: string) => normalizedText(name).toLowerCase()

const normalizedEntry = (
  input: Pick<AddressBookEntry, 'address' | 'name' | 'note' | 'provenance' | 'createdAt' | 'updatedAt'>
): AddressBookEntry =>
  AddressBookEntrySchema.parse({
    ...input,
    address: normalizeAddress(input.address),
    name: normalizedText(input.name),
    note: normalizedText(input.note),
    provenance:
      input.provenance.status === 'verified-out-of-band'
        ? { ...input.provenance, note: normalizedText(input.provenance.note) }
        : input.provenance
  })

const duplicateName = (book: AddressBook, name: string, excludedKey?: string) => {
  const target = normalizedNameKey(name)
  return Object.entries(book).find(
    ([key, entry]) => key !== excludedKey && normalizedNameKey(entry.name) === target
  )
}

export function saveAddressBookEntry(
  current: unknown,
  request: unknown,
  now = Date.now()
): { addressBook: AddressBook; entry: AddressBookEntry } {
  const addressBook = AddressBookSchema.parse(current)
  const parsed = AddressBookSaveRequestSchema.parse(request)
  const address = normalizeAddress(parsed.address)
  const key = address.toLowerCase()
  const existing = addressBook[key]

  if (parsed.mode === 'add' && existing) throw new Error('Address is already in your contacts')
  if (parsed.mode === 'edit' && !existing) throw new Error('Contact no longer exists')
  if (!existing && Object.keys(addressBook).length >= MAX_ADDRESS_BOOK_ENTRIES) {
    throw new Error(`Contacts cannot exceed ${MAX_ADDRESS_BOOK_ENTRIES} entries`)
  }
  if (duplicateName(addressBook, parsed.name, key)) {
    throw new Error('Name is already used by another address')
  }

  const entry = normalizedEntry({
    address,
    name: parsed.name,
    note: parsed.note,
    provenance:
      parsed.provenance?.status === 'verified-out-of-band'
        ? { ...parsed.provenance, verifiedAt: now }
        : (parsed.provenance ?? existing?.provenance ?? { status: 'saved' }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })
  return { addressBook: { ...addressBook, [key]: entry }, entry }
}

export function removeAddressBookEntry(current: unknown, address: unknown): AddressBook {
  const addressBook = AddressBookSchema.parse(current)
  const parsedAddress = AddressBookAddressInputSchema.parse(address)
  const key = entryKey(parsedAddress)
  if (!addressBook[key]) throw new Error('Contact no longer exists')

  const next = { ...addressBook }
  delete next[key]
  return next
}

export function sanitizeAddressBook(current: unknown): { addressBook: AddressBook; removed: number } {
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return { addressBook: {}, removed: 0 }
  }

  const addressBook: AddressBook = {}
  let removed = 0

  Object.entries(current).forEach(([key, candidate]) => {
    const parsed = AddressBookEntrySchema.safeParse(candidate)
    if (
      !KEY.test(key) ||
      !parsed.success ||
      key !== parsed.data.address.toLowerCase() ||
      Object.keys(addressBook).length >= MAX_ADDRESS_BOOK_ENTRIES
    ) {
      removed += 1
      return
    }

    addressBook[key] = parsed.data
  })

  return { addressBook, removed }
}

export function createAddressBookExport(current: unknown, now = Date.now()): AddressBookExport {
  const addressBook = AddressBookSchema.parse(current)
  return AddressBookExportSchema.parse({
    format: ADDRESS_BOOK_FORMAT,
    version: ADDRESS_BOOK_VERSION,
    exportedAt: new Date(now).toISOString(),
    entries: Object.values(addressBook).sort(
      (left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address)
    )
  })
}

export function importAddressBookExport(
  current: unknown,
  imported: unknown
): { addressBook: AddressBook; imported: number; skipped: number } {
  let addressBook = AddressBookSchema.parse(current)
  const parsed = AddressBookExportSchema.parse(imported)
  let importedCount = 0
  let skipped = 0

  const mergeEntry = (entry: AddressBookEntry) => {
    const key = entry.address.toLowerCase()
    if (
      addressBook[key] ||
      duplicateName(addressBook, entry.name) ||
      Object.keys(addressBook).length >= MAX_ADDRESS_BOOK_ENTRIES
    ) {
      skipped += 1
      return
    }
    addressBook = { ...addressBook, [key]: entry }
    importedCount += 1
  }

  if (parsed.version === 1) {
    parsed.entries.forEach((candidate) =>
      mergeEntry(normalizedEntry({ ...candidate, provenance: { status: 'saved' } }))
    )
  } else {
    parsed.entries.forEach((candidate) => mergeEntry(normalizedEntry(candidate)))
  }

  return { addressBook, imported: importedCount, skipped }
}
