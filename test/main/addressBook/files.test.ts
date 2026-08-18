import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import {
  ADDRESS_BOOK_FORMAT,
  ADDRESS_BOOK_VERSION,
  MAX_ADDRESS_BOOK_FILE_BYTES
} from '../../../resources/domain/addressBook'
import { createAddressBookFileService, readAddressBookFile } from '../../../main/addressBook/files'

jest.mock('electron', () => ({ app: { on: jest.fn(), getPath: jest.fn(() => '/tmp') } }))

const address = '0x0000000000000000000000000000000000000001'
const entry = {
  address,
  name: 'Treasury',
  note: '',
  provenance: { status: 'saved' as const },
  createdAt: 1,
  updatedAt: 1
}
const document = {
  format: ADDRESS_BOOK_FORMAT,
  version: ADDRESS_BOOK_VERSION,
  exportedAt: new Date(1).toISOString(),
  entries: [entry]
}

const dependencies = (overrides = {}) => ({
  current: () => ({}),
  importEntries: jest.fn(() => ({ imported: 1, skipped: 0 })),
  openImport: jest.fn(async () => '/tmp/contacts.json'),
  openExport: jest.fn(async () => '/tmp/contacts.json'),
  readFile: jest.fn(async () => JSON.stringify(document)),
  stat: jest.fn(async () => ({ isFile: () => true, size: 100 })),
  writeFile: jest.fn(async () => undefined),
  now: () => 1,
  ...overrides
})

test('imports a completely validated document and reports duplicate skips', async () => {
  const deps = dependencies({ importEntries: jest.fn(() => undefined) })
  const result = await createAddressBookFileService(deps).importFile()

  expect(result).toEqual({ success: true, imported: 1, skipped: 0 })
  expect(deps.importEntries).toHaveBeenCalledWith(document)
})

test('imports legacy v1 documents as saved contacts without rewriting the source file', async () => {
  const legacy = {
    format: ADDRESS_BOOK_FORMAT,
    version: 1,
    exportedAt: new Date(1).toISOString(),
    entries: [{ address, name: 'Treasury', note: '', createdAt: 1, updatedAt: 1 }]
  }
  const deps = dependencies({
    importEntries: jest.fn(() => undefined),
    readFile: jest.fn(async () => JSON.stringify(legacy))
  })

  await expect(createAddressBookFileService(deps).importFile()).resolves.toEqual({
    success: true,
    imported: 1,
    skipped: 0
  })
  expect(deps.importEntries).toHaveBeenCalledWith(legacy)
})

test('computes import counts from validated state instead of the store action return value', async () => {
  const deps = dependencies({
    current: () => ({ [address.toLowerCase()]: entry }),
    importEntries: jest.fn(() => undefined)
  })

  await expect(createAddressBookFileService(deps).importFile()).resolves.toEqual({
    success: true,
    imported: 0,
    skipped: 1
  })
  expect(deps.importEntries).toHaveBeenCalledTimes(1)
})

test('rejects oversized and malformed imports before mutation', async () => {
  const oversized = dependencies({
    stat: jest.fn(async () => ({ isFile: () => true, size: MAX_ADDRESS_BOOK_FILE_BYTES + 1 }))
  })
  await expect(createAddressBookFileService(oversized).importFile()).rejects.toThrow(/exceeds 1 MiB/)
  expect(oversized.importEntries).not.toHaveBeenCalled()

  const malformed = dependencies({ readFile: jest.fn(async () => '{') })
  await expect(createAddressBookFileService(malformed).importFile()).rejects.toThrow(/valid JSON/)
  expect(malformed.importEntries).not.toHaveBeenCalled()
})

test('bounds the production file read even if a selected file grows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-address-book-'))
  const file = path.join(directory, 'contacts.json')

  try {
    await fs.writeFile(file, Buffer.alloc(MAX_ADDRESS_BOOK_FILE_BYTES + 1, 1))
    await expect(readAddressBookFile(file)).rejects.toThrow(/exceeds 1 MiB/)

    await fs.writeFile(file, JSON.stringify(document))
    await expect(readAddressBookFile(file)).resolves.toBe(JSON.stringify(document))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('treats canceled import and export dialogs as non-errors', async () => {
  const deps = dependencies({
    openImport: jest.fn(async () => undefined),
    openExport: jest.fn(async () => undefined)
  })
  const service = createAddressBookFileService(deps)

  await expect(service.importFile()).resolves.toEqual({ success: false, canceled: true })
  await expect(service.exportFile()).resolves.toEqual({ success: false, canceled: true })
  expect(deps.writeFile).not.toHaveBeenCalled()
})

test('exports deterministic versioned JSON without returning a filesystem path', async () => {
  const deps = dependencies({ current: () => ({ [address.toLowerCase()]: entry }) })
  const result = await createAddressBookFileService(deps).exportFile()

  expect(result).toEqual({ success: true, exported: 1 })
  expect(deps.writeFile).toHaveBeenCalledWith('/tmp/contacts.json', `${JSON.stringify(document, null, 2)}\n`)
})
