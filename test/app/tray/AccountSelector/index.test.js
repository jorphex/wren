import { render, screen } from '../../../componentSetup'
import { AccountSelector } from '../../../../app/tray/AccountSelector'

const setupSelector = ({ drawerOpen = true } = {}) => {
  let open = drawerOpen
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'panel.accountFilter') return ''
    if (key === 'selected.showAccounts') return open
    if (key === 'main.accounts') return {}
    if (key === 'selected.open') return true
  }
  store.toggleShowAccounts = jest.fn((next) => {
    open = next
  })
  const selector = new AccountSelector({}, { store })
  selector.store = store
  return { selector, store, setOpen: (next) => (open = next) }
}

it('exposes the account drawer as a labelled modal dialog', () => {
  const { selector } = setupSelector()

  render(selector.renderDrawer({}))

  expect(screen.getByRole('dialog', { name: 'Accounts' }).getAttribute('aria-modal')).toBe('true')
})

it('closes the account drawer with Escape', () => {
  const { selector, store } = setupSelector()
  const event = { key: 'Escape', preventDefault: jest.fn() }

  selector.handleDrawerKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalledTimes(1)
  expect(store.toggleShowAccounts).toHaveBeenCalledWith(false)
})

it('keeps keyboard focus inside the open account drawer', () => {
  const { selector } = setupSelector()
  render(selector.renderDrawer({}))
  const close = screen
    .getAllByRole('button', { name: 'Close account drawer' })
    .find((button) => button.classList.contains('accountDrawerClose'))
  const add = screen
    .getAllByRole('button', { name: 'Add account' })
    .find((button) => button.classList.contains('accountDrawerAdd'))
  close.focus()
  const event = { key: 'Tab', shiftKey: true, preventDefault: jest.fn() }

  selector.handleDrawerKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(add)
})

it('renders the balance privacy control for the current account', () => {
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.hideBalances') return true
    if (key === 'selected.showAccounts') return false
  }
  store.toggleHideBalances = jest.fn()
  store.toggleShowAccounts = jest.fn()
  const selector = new AccountSelector({}, { store })
  selector.store = store

  render(
    selector.renderCurrentAccount({
      id: '0x000000000000000000000000000000000000dead',
      address: '0x000000000000000000000000000000000000dead',
      name: 'Watch Account'
    })
  )

  expect(screen.getByRole('button', { name: 'Show balances' })).toBeTruthy()
})

it('uses the emphasized primary treatment for the empty-state action', () => {
  const { selector } = setupSelector()

  render(selector.renderAccountList())

  expect(screen.getByRole('button', { name: 'Add account' }).classList.contains('wrenHeroPrimary')).toBe(true)
})
