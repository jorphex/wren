import Restore from 'react-restore'

import { SettingsPreview } from '../../../../../app/tray/Account/Settings/SettingsPreview'
import { SettingsExpanded } from '../../../../../app/tray/Account/Settings/SettingsExpanded'
import link from '../../../../../resources/link'
import { fireEvent, render, screen } from '../../../../componentSetup'

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

const renderWithStore = (Component, props = {}) => {
  const store = Restore.create({ main: { accounts: { [account]: { name: 'Primary' } } } }, {})
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

it('keeps the expanded account name editor in the keyboard sequence', async () => {
  const { user } = renderWithStore(SettingsExpanded, { expanded: true })
  const input = screen.getByRole('textbox', { name: 'Account name' })

  await user.tab()
  expect(document.activeElement).toBe(input)
  await user.clear(input)
  await user.type(input, 'Treasury{Enter}')

  expect(link.send).toHaveBeenCalledWith('tray:renameAccount', account, 'Treasury')
})

it('requires a separately armed second action before removing an account', () => {
  renderWithStore(SettingsPreview)

  const remove = screen.getByRole('button', { name: 'Remove account' })
  expect(remove.closest('.clusterValue').getAttribute('style')).not.toMatch(/color/)
  fireEvent.click(remove, { detail: 1 })
  expect(link.rpc).not.toHaveBeenCalled()
  const confirm = screen.getByRole('button', { name: 'Confirm remove account' })
  expect(confirm.closest('.settingsPreviewRemovalConfirm')).toBeTruthy()
  fireEvent.click(confirm, { detail: 1 })

  expect(link.rpc).toHaveBeenCalledWith('removeAccount', account, {}, expect.any(Function))
})

it('does not let one multi-click gesture arm and confirm account removal', () => {
  renderWithStore(SettingsPreview)

  fireEvent.click(screen.getByRole('button', { name: 'Remove account' }), { detail: 1 })
  const confirm = screen.getByRole('button', { name: 'Confirm remove account' })
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

  const cancel = screen.getByRole('button', { name: 'Cancel account removal' })
  expect(document.activeElement).toBe(cancel)
  await user.keyboard('{Enter}')

  expect(link.rpc).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Remove account' })).toBeTruthy()
})

it('keeps the compact account action row focused on safe removal', () => {
  renderWithStore(SettingsPreview)

  expect(screen.queryByRole('button', { name: 'Update account name' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Remove account' })).toBeTruthy()
})
