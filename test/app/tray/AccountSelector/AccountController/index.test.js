import { fireEvent, render, screen } from '../../../../componentSetup'
import { Account } from '../../../../../app/tray/AccountSelector/AccountController'

const setupMenu = (open) => {
  const account = new Account({ id: '0xabc' })
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.current') return open ? '0xabc' : ''
    if (key === 'selected.open') return open
    if (key === 'selected.view') return 'default'
  }
  store.setSignerView = jest.fn()
  account.store = store
  render(account.renderMenu())
  return store
}

test('removes hidden account menu actions from keyboard navigation', () => {
  setupMenu(false)

  const hiddenButtons = screen.getAllByRole('button', { hidden: true })
  expect(hiddenButtons).toHaveLength(2)
  expect(hiddenButtons.every((button) => button.tabIndex === -1)).toBe(true)
})

test('activates open account menu actions with native clicks', () => {
  const accountStore = setupMenu(true)

  fireEvent.click(screen.getByRole('button', { name: 'Show account settings' }))

  expect(accountStore.setSignerView).toHaveBeenCalledWith('settings')
})
