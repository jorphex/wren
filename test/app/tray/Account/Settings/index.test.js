import Restore from 'react-restore'

import { SettingsPreview } from '../../../../../app/tray/Account/Settings/SettingsPreview'
import { SettingsExpanded } from '../../../../../app/tray/Account/Settings/SettingsExpanded'
import link from '../../../../../resources/link'
import { act, fireEvent, render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

const account = '0x0000000000000000000000000000000000000001'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

const renderWithStore = (Component, props = {}, accountState = { name: 'Primary' }, mainState = {}) => {
  const store = Restore.create({ main: { ...mainState, accounts: { [account]: accountState } } }, {})
  class TestComponent extends Component {
    constructor(componentProps) {
      super(componentProps, { store })
      this.store = store
    }
  }
  return render(<TestComponent account={account} moduleId='settings' {...props} />)
}

it('restores the persisted name instead of submitting an empty name', () => {
  renderWithStore(SettingsExpanded, { expanded: true })
  const input = screen.getByDisplayValue('Primary')

  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.blur(input)

  expect(link.send).not.toHaveBeenCalled()
  expect(screen.getByDisplayValue('Primary')).toBeTruthy()
})

it('focuses the expanded account name editor and saves with Enter', async () => {
  const { user } = renderWithStore(SettingsExpanded, { expanded: true })
  const input = screen.getByRole('textbox', { name: 'Account name' })

  expect(input.classList.contains('wrenInput')).toBe(true)
  expect(input.classList.contains('panelBlockItem')).toBe(true)
  expect(input.parentElement.classList.contains('panelBlock')).toBe(true)
  expect(input.closest('.panelBlockValues')).toBeNull()

  expect(document.activeElement).toBe(input)
  expect(input.maxLength).toBe(128)
  await user.clear(input)
  await user.type(input, 'Treasury{Enter}')

  expect(link.send).toHaveBeenCalledWith('tray:renameAccount', account, 'Treasury')
})

it('keeps unnamed legacy accounts safe', () => {
  renderWithStore(SettingsExpanded, { expanded: true }, {})
  const input = screen.getByRole('textbox', { name: 'Account name' })

  expect(input.value).toBe('')
  expect(() => fireEvent.blur(input)).not.toThrow()
  expect(link.send).not.toHaveBeenCalledWith('tray:renameAccount', account, expect.anything())
})

it('cancels an account name edit with Escape', () => {
  renderWithStore(SettingsExpanded, { expanded: true })
  const input = screen.getByRole('textbox', { name: 'Account name' })

  fireEvent.change(input, { target: { value: 'Temporary name' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.blur(input)

  expect(screen.getByDisplayValue('Primary')).toBeTruthy()
  expect(link.send).not.toHaveBeenCalledWith('tray:renameAccount', account, 'Temporary name')
})

it('opens account settings from the visible rename action', () => {
  renderWithStore(SettingsPreview)

  fireEvent.click(screen.getByRole('button', { name: 'Rename account' }))

  expect(link.send).toHaveBeenCalledWith('nav:forward', 'panel', {
    view: 'expandedModule',
    data: { id: 'settings', account, title: 'Account settings' }
  })
})

it('requires a separately armed second action before removing an account', () => {
  renderWithStore(SettingsPreview)

  const remove = screen.getByRole('button', { name: 'Remove account' })
  fireEvent.click(remove, { detail: 1 })
  expect(link.rpc).not.toHaveBeenCalled()
  const confirm = screen.getByRole('button', { name: 'Confirm removal' })
  expect(confirm.closest('[role="alertdialog"]')).toBeTruthy()
  fireEvent.click(confirm, { detail: 1 })

  expect(link.rpc).toHaveBeenCalledWith('removeAccount', account, {}, expect.any(Function))
})

it('does not let one multi-click gesture arm and confirm account removal', () => {
  renderWithStore(SettingsPreview)

  fireEvent.click(screen.getByRole('button', { name: 'Remove account' }), { detail: 1 })
  const confirm = screen.getByRole('button', { name: 'Confirm removal' })
  fireEvent.click(confirm, { detail: 2 })
  expect(link.rpc).not.toHaveBeenCalled()

  fireEvent.click(confirm, { detail: 1 })
  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(link.rpc).toHaveBeenCalledWith('removeAccount', account, {}, expect.any(Function))
})

it('moves keyboard focus to the safe action before account removal can be confirmed', async () => {
  const { user } = renderWithStore(SettingsPreview)
  const remove = screen.getByRole('button', { name: 'Remove account' })

  remove.focus()
  await user.keyboard('{Enter}')

  const cancel = screen.getByRole('button', { name: 'Cancel' })
  expect(document.activeElement).toBe(cancel)
  await user.keyboard('{Enter}')

  expect(link.rpc).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove account' }))
})

it('names the account and consequence in a separate removal confirmation', () => {
  renderWithStore(SettingsPreview)

  fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))

  const dialog = screen.getByRole('alertdialog', { name: 'Remove Primary?' })
  expect(dialog.getAttribute('aria-modal')).toBeNull()
  expect(dialog.textContent).toContain(
    `This removes Primary (${account}) from Wren. Funds remain onchain, but this account and its signer connection will no longer be available here.`
  )
})

it('uses the local account name with ENS when the preference is enabled', () => {
  renderWithStore(
    SettingsPreview,
    {},
    { name: 'Treasury', ensName: 'treasury.eth' },
    { showLocalNameWithENS: true }
  )

  fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))

  expect(screen.getByRole('alertdialog', { name: 'Remove Treasury?' })).toBeTruthy()
})

it('cancels account removal with Escape and restores trigger focus', () => {
  renderWithStore(SettingsPreview)
  const remove = screen.getByRole('button', { name: 'Remove account' })

  remove.focus()
  fireEvent.click(remove)
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

  expect(link.rpc).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove account' }))
})

it('guards account removal while pending and recovers in place after failure', () => {
  renderWithStore(SettingsPreview)
  fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
  const confirm = screen.getByRole('button', { name: 'Confirm removal' })

  fireEvent.click(confirm)
  fireEvent.click(confirm)

  expect(link.rpc).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Removing account\u2026' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
  expect(screen.getByRole('alertdialog')).toBeTruthy()

  act(() => link.rpc.mock.calls[0][3](new Error('remove failed')))

  expect(screen.getByRole('alert').textContent).toBe('Couldn\u2019t remove account. Try again.')
  expect(screen.getByRole('button', { name: 'Confirm removal' }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
  expect(link.rpc).toHaveBeenCalledTimes(2)
})

it('explains when durable account removal is finishing in the background', () => {
  renderWithStore(SettingsPreview)
  fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))

  act(() => link.rpc.mock.calls[0][3](null, { status: 'deferred' }))

  expect(screen.getByRole('status').textContent).toBe(
    'Removal is in progress. Wren will finish automatically.'
  )
  expect(screen.getByRole('button', { name: 'Removing account\u2026' }).disabled).toBe(true)
})

it('keeps rename and removal available as separate account actions', () => {
  renderWithStore(SettingsPreview)

  const rename = screen.getByRole('button', { name: 'Rename account' })
  const remove = screen.getByRole('button', { name: 'Remove account' })

  expect(rename.parentElement).toBe(remove.parentElement)
  expect(rename.parentElement.classList.contains('settingsPreviewActions')).toBe(true)
  expect(rename.classList.contains('wrenControlSecondary')).toBe(true)
  expect(remove.classList.contains('wrenControlDanger')).toBe(true)
})
