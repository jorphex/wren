import Restore from 'react-restore'

import { act, render, screen, waitFor } from '../../../componentSetup'
import { AddressBook, AddressBookEditor } from '../../../../app/dash/AddressBook'
import {
  exportAddressBook,
  importAddressBook,
  removeAddressBookEntry,
  saveAddressBookEntry
} from '../../../../app/dash/AddressBook/api'
import link from '../../../../resources/link'

jest.mock('../../../../app/dash/AddressBook/api', () => ({
  exportAddressBook: jest.fn(),
  importAddressBook: jest.fn(),
  removeAddressBookEntry: jest.fn(),
  saveAddressBookEntry: jest.fn()
}))
jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

const address = '0x0000000000000000000000000000000000000001'
const entry = {
  address,
  name: 'Yearn Treasury',
  note: 'Operations',
  provenance: { status: 'saved' },
  createdAt: 1,
  updatedAt: 1
}
const store = Restore.create({ main: { addressBook: { [address.toLowerCase()]: entry } } }, {})
const ConnectedAddressBook = Restore.connect(AddressBook, store)

beforeEach(() => {
  exportAddressBook.mockReset()
  importAddressBook.mockReset()
  removeAddressBookEntry.mockReset()
  saveAddressBookEntry.mockReset()
  link.rpc.mockReset()
  link.send.mockReset()
})

test('searches contacts, copies rows, and opens add and edit navigation explicitly', async () => {
  const { user } = render(<ConnectedAddressBook data={{}} />)

  expect(screen.getByText('Yearn Treasury')).toBeTruthy()
  expect(screen.getByText(address)).toBeTruthy()
  expect(screen.getByText('Saved')).toBeTruthy()
  await user.type(screen.getByRole('textbox', { name: 'Search contacts' }), 'missing')
  expect(screen.getByText('No contacts match')).toBeTruthy()

  await user.clear(screen.getByRole('textbox', { name: 'Search contacts' }))
  await user.click(
    screen.getByRole('button', { name: new RegExp(`Copy address for Yearn Treasury ${address}`) })
  )
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)
  expect(screen.getByRole('status').textContent).toBe('Yearn Treasury address copied')
  expect(link.send).not.toHaveBeenCalledWith(
    'tray:action',
    'navDash',
    expect.objectContaining({ data: expect.objectContaining({ address }) })
  )

  act(() => jest.advanceTimersByTime(4000))
  expect(screen.queryByRole('status')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Edit Yearn Treasury' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'addressBook',
    data: { screen: 'edit', address }
  })

  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'addressBook',
    data: { screen: 'edit' }
  })
})

test('orders contact actions as Copy, Edit, then Remove and exposes an explicit safe confirmation', async () => {
  const { user } = render(<ConnectedAddressBook data={{}} />)
  const copy = screen.getByRole('button', {
    name: new RegExp(`Copy address for Yearn Treasury ${address}`)
  })
  const edit = screen.getByRole('button', { name: 'Edit Yearn Treasury' })
  const remove = screen.getByRole('button', { name: 'Remove Yearn Treasury' })

  expect([...copy.closest('.addressBookRow').querySelectorAll('button')]).toEqual([copy, edit, remove])

  await user.click(remove)
  const dialog = screen.getByRole('alertdialog', { name: 'Remove Yearn Treasury?' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(
    screen
      .getByPlaceholderText('Search name, note, or address')
      .closest('.addressBookToolbar')
      .hasAttribute('inert')
  ).toBe(true)
  expect(screen.getByText('This removes the saved contact from Wren. Funds are not affected.')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm removing Yearn Treasury' }))
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Remove Yearn Treasury' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Yearn Treasury' }))
  expect(removeAddressBookEntry).not.toHaveBeenCalled()
})

test('resolves ENS once, saves its address, and returns through Dash navigation', async () => {
  link.rpc.mockImplementation((method, name, callback) => {
    expect(method).toBe('resolveEnsName')
    expect(name).toBe('treasury.eth')
    callback(null, address)
  })
  saveAddressBookEntry.mockResolvedValue({ success: true, entry })
  const { user } = render(<AddressBookEditor />)

  expect(screen.getByRole('button', { name: 'Save Contact' }).disabled).toBe(true)

  await user.type(screen.getByLabelText('Address or ENS name'), 'treasury.eth')
  await user.type(screen.getByLabelText('Name'), 'Yearn Treasury')
  await user.type(screen.getByLabelText(/Note/), 'Operations')
  await user.click(screen.getByRole('button', { name: 'Save Contact' }))

  await waitFor(() =>
    expect(saveAddressBookEntry).toHaveBeenCalledWith({
      mode: 'add',
      address,
      name: 'Yearn Treasury',
      note: 'Operations'
    })
  )
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
})

test('records explicit out-of-band verification without letting the renderer set its timestamp', async () => {
  saveAddressBookEntry.mockResolvedValue({ success: true, entry })
  const { user } = render(<AddressBookEditor />)

  await user.type(screen.getByLabelText('Address or ENS name'), address)
  await user.type(screen.getByLabelText('Name'), 'Yearn Treasury')
  await user.click(screen.getByRole('radio', { name: 'Verified out of band' }))
  expect(
    screen.getByText('You checked this address elsewhere. Always verify the full address before signing.')
  ).toBeTruthy()
  await user.type(screen.getByLabelText(/Verification note/), 'Compared during a voice call')
  await user.click(screen.getByRole('button', { name: 'Save Contact' }))

  await waitFor(() =>
    expect(saveAddressBookEntry).toHaveBeenCalledWith({
      mode: 'add',
      address,
      name: 'Yearn Treasury',
      note: '',
      provenance: {
        status: 'verified-out-of-band',
        note: 'Compared during a voice call'
      }
    })
  )
  expect(saveAddressBookEntry.mock.calls[0][0].provenance.verifiedAt).toBeUndefined()
})

test('shows a verified contact date and preserves provenance when unrelated fields change', async () => {
  const verified = {
    ...entry,
    provenance: {
      status: 'verified-out-of-band',
      verifiedAt: Date.UTC(2026, 7, 18),
      note: 'Compared on a separate device'
    }
  }
  saveAddressBookEntry.mockResolvedValue({ success: true, entry: verified })
  const { user } = render(<AddressBookEditor entry={verified} />)

  expect(screen.getByText('Last marked verified 2026-08-18')).toBeTruthy()
  expect(screen.getByLabelText('Address or ENS name').readOnly).toBe(true)
  expect(screen.getByLabelText('Address or ENS name').disabled).toBe(false)
  expect(screen.getByLabelText(/Verification note/).value).toBe('Compared on a separate device')
  expect(screen.getByLabelText(/Verification note/).getAttribute('aria-describedby')).toBe(
    'addressBookVerificationCount'
  )
  expect(screen.getByLabelText(/^Note/).getAttribute('aria-describedby')).toBe('addressBookNoteCount')
  await user.clear(screen.getByLabelText('Name'))
  await user.type(screen.getByLabelText('Name'), 'Treasury')
  await user.click(screen.getByRole('button', { name: 'Save Contact' }))

  await waitFor(() =>
    expect(saveAddressBookEntry).toHaveBeenCalledWith({
      mode: 'edit',
      address,
      name: 'Treasury',
      note: 'Operations'
    })
  )
})

test('renders malformed legacy verification dates defensively', () => {
  render(
    <AddressBookEditor
      entry={{
        ...entry,
        provenance: {
          status: 'verified-out-of-band',
          verifiedAt: Number.MAX_SAFE_INTEGER,
          note: 'Legacy record'
        }
      }}
    />
  )

  expect(screen.getByText('Last marked verified Date unavailable')).toBeTruthy()
})

test('warns before explicitly clearing an out-of-band verification record', async () => {
  const verified = {
    ...entry,
    provenance: {
      status: 'verified-out-of-band',
      verifiedAt: 1,
      note: 'Compared on a separate device'
    }
  }
  saveAddressBookEntry.mockResolvedValue({ success: true, entry })
  const { user } = render(<AddressBookEditor entry={verified} />)

  await user.click(screen.getByRole('radio', { name: 'Saved' }))
  expect(screen.getByText('Saving as Saved clears the existing verification date and note.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save Contact' }))

  await waitFor(() =>
    expect(saveAddressBookEntry).toHaveBeenCalledWith({
      mode: 'edit',
      address,
      name: 'Yearn Treasury',
      note: 'Operations',
      provenance: { status: 'saved' }
    })
  )
})

test('resolves a completed ENS name inline and seeds an untouched contact name', async () => {
  link.rpc.mockImplementation((method, name, callback) => callback(null, address))
  const { user } = render(<AddressBookEditor />)

  await user.type(screen.getByLabelText('Address or ENS name'), 'treasury.eth')
  expect(screen.getByText('Resolving ENS name…')).toBeTruthy()
  await act(async () => jest.advanceTimersByTime(320))

  expect(await screen.findByText('ENS name resolved')).toBeTruthy()
  expect(screen.getByPlaceholderText('0x... or name.eth').value).toBe(address)
  expect(screen.getByLabelText('Name').value).toBe('treasury.eth')
})

test('does not overwrite a deliberate contact name when ENS resolution finishes', async () => {
  let finishResolution
  link.rpc.mockImplementation((method, name, callback) => {
    finishResolution = () => callback(null, address)
  })
  const { user } = render(<AddressBookEditor />)

  await user.type(screen.getByLabelText('Address or ENS name'), 'treasury.eth')
  await act(async () => jest.advanceTimersByTime(320))
  await user.type(screen.getByLabelText('Name'), 'Operations')
  await act(async () => finishResolution())

  expect(screen.getByLabelText('Name').value).toBe('Operations')
})

test('seeds a new contact form from the active search', async () => {
  const { user } = render(<ConnectedAddressBook data={{}} />)

  await user.type(screen.getByRole('textbox', { name: 'Search contacts' }), 'New teammate')
  await user.click(screen.getByRole('button', { name: 'Add' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'addressBook',
    data: { screen: 'edit', seed: 'New teammate' }
  })
})

test('requires confirmation before deletion and reports import duplicate counts', async () => {
  removeAddressBookEntry.mockResolvedValue({ success: true })
  importAddressBook.mockResolvedValue({ success: true, imported: 2, skipped: 1 })
  const { user } = render(<ConnectedAddressBook data={{}} />)

  await user.click(screen.getByRole('button', { name: 'Remove Yearn Treasury' }))
  expect(removeAddressBookEntry).not.toHaveBeenCalled()
  await user.dblClick(screen.getByRole('button', { name: 'Confirm removing Yearn Treasury' }))
  expect(removeAddressBookEntry).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(removeAddressBookEntry).toHaveBeenCalledWith(address))
  expect(await screen.findByText('Contact removed')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search contacts' }))
  act(() => jest.advanceTimersByTime(4000))
  expect(screen.queryByText('Contact removed')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Import JSON' }))
  expect(await screen.findByText('Imported 2; skipped 1 existing or excess entry.')).toBeTruthy()
})

test('cancels contact removal with Escape but not while the removal is pending', async () => {
  let finishRemoval
  removeAddressBookEntry.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRemoval = resolve
      })
  )
  const { user } = render(<ConnectedAddressBook data={{}} />)

  await user.click(screen.getByRole('button', { name: 'Remove Yearn Treasury' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Yearn Treasury' }))

  await user.click(screen.getByRole('button', { name: 'Remove Yearn Treasury' }))
  await user.click(screen.getByRole('button', { name: 'Confirm removing Yearn Treasury' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Remove Yearn Treasury?' })
  expect(dialog.getAttribute('aria-busy')).toBe('true')
  expect(screen.getByRole('button', { name: 'Removing Yearn Treasury' }).disabled).toBe(true)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog', { name: 'Remove Yearn Treasury?' })).toBeTruthy()

  await act(async () => finishRemoval({ success: true }))
})

test('surfaces validation and service errors without navigating away', async () => {
  saveAddressBookEntry.mockRejectedValue(new Error('Name is already used by another address'))
  const { user } = render(<AddressBookEditor />)

  await user.type(screen.getByLabelText('Address or ENS name'), address)
  await user.type(screen.getByLabelText('Name'), 'Duplicate')
  await user.click(screen.getByRole('button', { name: 'Save Contact' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Name is already used')
  expect(link.send).not.toHaveBeenCalled()
})

test('discloses that exported contact metadata is plaintext', () => {
  render(<ConnectedAddressBook data={{}} />)

  expect(
    screen.getByText('Export includes names, notes, and verification records in plaintext.')
  ).toBeTruthy()
})

test('does not turn a stale edit route into a new contact', async () => {
  const { user } = render(
    <ConnectedAddressBook data={{ screen: 'edit', address: '0x0000000000000000000000000000000000000002' }} />
  )

  expect(screen.getByText('Contact not found')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save Contact' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Return to Contacts' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
})
