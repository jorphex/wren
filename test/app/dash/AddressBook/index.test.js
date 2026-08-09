import Restore from 'react-restore'

import { render, screen, waitFor } from '../../../componentSetup'
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
const entry = { address, name: 'Yearn Treasury', note: 'Operations', createdAt: 1, updatedAt: 1 }
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

test('searches contacts and opens native add and edit navigation', async () => {
  const { user } = render(<ConnectedAddressBook data={{}} />)

  expect(screen.getByText('Yearn Treasury')).toBeTruthy()
  expect(screen.getByText('0x000000...000001')).toBeTruthy()
  await user.type(screen.getByRole('textbox', { name: 'Search contacts' }), 'missing')
  expect(screen.getByText('No contacts match')).toBeTruthy()

  await user.clear(screen.getByRole('textbox', { name: 'Search contacts' }))
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

test('requires confirmation before deletion and reports import duplicate counts', async () => {
  removeAddressBookEntry.mockResolvedValue({ success: true })
  importAddressBook.mockResolvedValue({ success: true, imported: 2, skipped: 1 })
  const { user } = render(<ConnectedAddressBook data={{}} />)

  await user.click(screen.getByRole('button', { name: 'Remove Yearn Treasury' }))
  expect(removeAddressBookEntry).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm removing Yearn Treasury' }))
  await waitFor(() => expect(removeAddressBookEntry).toHaveBeenCalledWith(address))
  expect(await screen.findByText('Contact removed.')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Import JSON' }))
  expect(await screen.findByText('Imported 2; skipped 1 existing or excess entry.')).toBeTruthy()
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

test('does not turn a stale edit route into a new contact', async () => {
  const { user } = render(
    <ConnectedAddressBook data={{ screen: 'edit', address: '0x0000000000000000000000000000000000000002' }} />
  )

  expect(screen.getByText('Contact not found')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save Contact' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Return to Contacts' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'backDash')
})
