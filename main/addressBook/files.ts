import fs from 'fs/promises'

import {
  MAX_ADDRESS_BOOK_FILE_BYTES,
  createAddressBookExport,
  importAddressBookExport
} from '../../resources/domain/addressBook'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { openAddressBookDialog, saveAddressBookDialog } from '../windows/dialog'

type FileStat = { isFile(): boolean; size: number }

type AddressBookFileDependencies = {
  current(): unknown
  importEntries(value: unknown): void
  openImport(): Promise<string | undefined>
  openExport(): Promise<string | undefined>
  readFile(path: string): Promise<string>
  stat(path: string): Promise<FileStat>
  writeFile(path: string, value: string): Promise<void>
  now(): number
}

export async function readAddressBookFile(path: string): Promise<string> {
  const file = await fs.open(path, 'r')
  const buffer = Buffer.alloc(MAX_ADDRESS_BOOK_FILE_BYTES + 1)

  try {
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }

    if (offset > MAX_ADDRESS_BOOK_FILE_BYTES) throw new Error('Contacts file exceeds 1 MiB')
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    await file.close()
  }
}

export type AddressBookFileResult =
  | { success: true; imported: number; skipped: number }
  | { success: true; exported: number }
  | { success: false; canceled: true }

const defaults: AddressBookFileDependencies = {
  current: () => store('main.addressBook'),
  importEntries: (value) => {
    requireStoreAction('importAddressBook')(value)
  },
  openImport: openAddressBookDialog,
  openExport: saveAddressBookDialog,
  readFile: readAddressBookFile,
  stat: (path) => fs.stat(path),
  writeFile: async (path, value) => {
    await fs.writeFile(path, value, { encoding: 'utf8', mode: 0o600 })
    await fs.chmod(path, 0o600)
  },
  now: Date.now
}

export function createAddressBookFileService(overrides: Partial<AddressBookFileDependencies> = {}) {
  const dependencies = { ...defaults, ...overrides }

  const importFile = async (): Promise<AddressBookFileResult> => {
    const path = await dependencies.openImport()
    if (!path) return { success: false, canceled: true }

    const stat = await dependencies.stat(path)
    if (!stat.isFile()) throw new Error('Selected contacts path is not a file')
    if (stat.size > MAX_ADDRESS_BOOK_FILE_BYTES) throw new Error('Contacts file exceeds 1 MiB')

    const contents = await dependencies.readFile(path)
    if (Buffer.byteLength(contents, 'utf8') > MAX_ADDRESS_BOOK_FILE_BYTES) {
      throw new Error('Contacts file exceeds 1 MiB')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      throw new Error('Contacts file is not valid JSON')
    }

    // Validate and compute the summary before invoking the store action so malformed imports
    // cannot partially apply. Restore actions return the store, not their callback's return value.
    const result = importAddressBookExport(dependencies.current(), parsed)
    dependencies.importEntries(parsed)
    return { success: true, imported: result.imported, skipped: result.skipped }
  }

  const exportFile = async (): Promise<AddressBookFileResult> => {
    const document = createAddressBookExport(dependencies.current(), dependencies.now())
    const path = await dependencies.openExport()
    if (!path) return { success: false, canceled: true }

    await dependencies.writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
    return { success: true, exported: document.entries.length }
  }

  return Object.freeze({ importFile, exportFile })
}

export default createAddressBookFileService()
