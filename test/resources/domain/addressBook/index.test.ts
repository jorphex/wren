import {
  ADDRESS_BOOK_FORMAT,
  ADDRESS_BOOK_VERSION,
  createAddressBookExport,
  importAddressBookExport,
  lookupAddressBookEntry,
  removeAddressBookEntry,
  resolveLocalAddressIdentity,
  sanitizeAddressBook,
  saveAddressBookEntry
} from '../../../../resources/domain/addressBook'

const alice = '0x0000000000000000000000000000000000000001'
const bob = '0x0000000000000000000000000000000000000002'

test('normalizes addresses and bounded contact text', () => {
  const { addressBook, entry } = saveAddressBookEntry(
    {},
    { mode: 'add', address: alice, name: '  Alice   Treasury ', note: '  Yearn   operations  ' },
    10
  )

  expect(entry).toEqual({
    address: '0x0000000000000000000000000000000000000001',
    name: 'Alice Treasury',
    note: 'Yearn operations',
    createdAt: 10,
    updatedAt: 10
  })
  expect(lookupAddressBookEntry(addressBook, alice)).toEqual(entry)
})

test('resolves saved contacts before existing Wren account names', () => {
  const accounts = { [alice]: { name: 'Frame Savings' } }

  expect(resolveLocalAddressIdentity({}, accounts, alice)).toEqual({
    label: 'Frame Savings',
    source: 'Wren account'
  })

  const addressBook = saveAddressBookEntry(
    {},
    { mode: 'add', address: alice, name: 'Treasury Contact', note: '' },
    10
  ).addressBook
  expect(resolveLocalAddressIdentity(addressBook, accounts, alice)).toEqual({
    label: 'Treasury Contact',
    source: 'Saved contact'
  })
})

test('ignores malformed account identity state', () => {
  expect(resolveLocalAddressIdentity({}, { [alice]: { name: '   ' } }, alice)).toBeUndefined()
  expect(resolveLocalAddressIdentity({}, { [alice]: { name: 42 } }, alice)).toBeUndefined()
  expect(resolveLocalAddressIdentity({}, { [alice]: { name: 'Alice' } }, 'invalid')).toBeUndefined()
  expect(
    resolveLocalAddressIdentity({}, { [alice]: { name: 'Alice\u202e Treasury' } }, alice)
  ).toBeUndefined()
})

test('fails closed when persisted contact state is malformed', () => {
  const valid = saveAddressBookEntry(
    {},
    { mode: 'add', address: alice, name: 'Alice', note: '' },
    10
  ).addressBook

  expect(
    lookupAddressBookEntry(
      { ...valid, [bob]: { ...valid[alice], address: bob, name: 'Bob', unexpected: true } },
      alice
    )
  ).toBeUndefined()
})

test('rejects invisible and directional control characters in trusted text', () => {
  expect(() =>
    saveAddressBookEntry({}, { mode: 'add', address: alice, name: 'Alice\u202e Treasury', note: '' })
  ).toThrow(/unsupported characters/i)
  expect(() =>
    saveAddressBookEntry({}, { mode: 'add', address: alice, name: 'Alice', note: 'Safe\u200b note' })
  ).toThrow(/unsupported characters/i)
})

test('sanitizes invalid persisted entries without discarding valid contacts', () => {
  const valid = {
    address: alice,
    name: 'Alice',
    note: '',
    createdAt: 1,
    updatedAt: 1
  }
  const unsafe = {
    address: bob,
    name: 'Bob\u202e Treasury',
    note: '',
    createdAt: 1,
    updatedAt: 1
  }

  expect(sanitizeAddressBook({ [alice]: valid, [bob]: unsafe })).toEqual({
    addressBook: { [alice]: valid },
    removed: 1
  })
  expect(sanitizeAddressBook([])).toEqual({ addressBook: {}, removed: 0 })
})

test('rejects wrong mixed-case checksums and duplicate addresses or names', () => {
  expect(() =>
    saveAddressBookEntry(
      {},
      {
        mode: 'add',
        address: '0x52908400098527886E0F7030069857D2E4169Ee7',
        name: 'Alice',
        note: ''
      }
    )
  ).toThrow(/checksum/i)

  const first = saveAddressBookEntry(
    {},
    { mode: 'add', address: alice, name: 'Alice Treasury', note: '' },
    10
  ).addressBook
  expect(() => saveAddressBookEntry(first, { mode: 'add', address: alice, name: 'Other', note: '' })).toThrow(
    /already in/i
  )
  expect(() =>
    saveAddressBookEntry(first, { mode: 'add', address: bob, name: 'alice treasury', note: '' })
  ).toThrow(/name is already/i)
})

test('edits without changing creation time and removes exact entries', () => {
  const first = saveAddressBookEntry(
    {},
    { mode: 'add', address: alice, name: 'Alice', note: '' },
    10
  ).addressBook
  const edited = saveAddressBookEntry(
    first,
    { mode: 'edit', address: alice, name: 'Alice Vault', note: 'Primary' },
    20
  )

  expect(edited.entry).toMatchObject({ createdAt: 10, updatedAt: 20, name: 'Alice Vault' })
  expect(removeAddressBookEntry(edited.addressBook, alice)).toEqual({})
  expect(() => removeAddressBookEntry({}, alice)).toThrow(/no longer exists/i)
})

test('round-trips a versioned export and skips duplicate address and name entries', () => {
  const first = saveAddressBookEntry(
    {},
    { mode: 'add', address: alice, name: 'Alice', note: 'One' },
    10
  ).addressBook
  const second = saveAddressBookEntry(
    first,
    { mode: 'add', address: bob, name: 'Bob', note: 'Two' },
    20
  ).addressBook
  const exported = createAddressBookExport(second, 30)

  expect(exported).toMatchObject({
    format: ADDRESS_BOOK_FORMAT,
    version: ADDRESS_BOOK_VERSION,
    exportedAt: new Date(30).toISOString()
  })
  const restored = importAddressBookExport({}, exported)
  expect(restored).toEqual({ addressBook: second, imported: 2, skipped: 0 })

  const duplicateName = {
    ...exported,
    entries: [...exported.entries, { ...exported.entries[0], address: bob }]
  }
  const merged = importAddressBookExport(first, duplicateName)
  expect(merged.imported).toBe(1)
  expect(merged.skipped).toBe(2)
})

test('rejects partial, unsupported, and oversized import documents', () => {
  expect(() => importAddressBookExport({}, { version: ADDRESS_BOOK_VERSION, entries: [] })).toThrow()
  expect(() =>
    importAddressBookExport(
      {},
      {
        format: ADDRESS_BOOK_FORMAT,
        version: 2,
        exportedAt: new Date(0).toISOString(),
        entries: []
      }
    )
  ).toThrow()
  expect(() =>
    importAddressBookExport(
      {},
      {
        format: ADDRESS_BOOK_FORMAT,
        version: ADDRESS_BOOK_VERSION,
        exportedAt: new Date(0).toISOString(),
        entries: Array.from({ length: 1001 }, (_, index) => ({
          address: `0x${index.toString(16).padStart(40, '0')}`,
          name: `Contact ${index}`,
          note: '',
          createdAt: 0,
          updatedAt: 0
        }))
      }
    )
  ).toThrow()
})
