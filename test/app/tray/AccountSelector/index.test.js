import { render, screen } from '../../../componentSetup'
import { AccountSelector } from '../../../../app/tray/AccountSelector'
import { Account as AccountController } from '../../../../app/tray/AccountSelector/AccountController'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

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
    open = typeof next === 'boolean' ? next : !open
  })
  const selector = new AccountSelector({}, { store })
  selector.store = store
  return { selector, store, setOpen: (next) => (open = next) }
}

it('exposes account switching as an embedded full-panel region', () => {
  const { selector } = setupSelector()

  render(selector.renderAccountPanel({}))

  expect(screen.getByRole('region', { name: 'Accounts' })).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('closes the account panel with Escape', () => {
  const { selector, store } = setupSelector()
  const event = { key: 'Escape', preventDefault: jest.fn() }

  selector.handleDrawerKeyDown(event)

  expect(event.preventDefault).toHaveBeenCalledTimes(1)
  expect(store.toggleShowAccounts).toHaveBeenCalledWith(false)
})

it('renders the balance privacy control for the current account', () => {
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.hideBalances') return true
    if (key === 'selected.showAccounts') return false
    if (key === 'windows.dash.showing') return false
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
  expect(screen.getByRole('button', { name: 'Open dashboard' })).toBeTruthy()
})

it('toggles the dashboard from the selected-account header', async () => {
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.hideBalances') return false
    if (key === 'selected.showAccounts') return false
    if (key === 'windows.dash.showing') return true
  }
  store.toggleHideBalances = jest.fn()
  store.toggleShowAccounts = jest.fn()
  const selector = new AccountSelector({}, { store })
  selector.store = store
  const { user } = render(
    selector.renderCurrentAccount({
      id: '0x000000000000000000000000000000000000dead',
      address: '0x000000000000000000000000000000000000dead',
      name: 'Watch Account'
    })
  )

  const toggle = screen.getByRole('button', { name: 'Close dashboard' })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  await user.click(toggle)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: false })
})

it('uses the emphasized primary treatment for the empty-state action', () => {
  const { selector } = setupSelector()

  render(selector.renderAccountList())

  expect(screen.getByRole('button', { name: 'Add account' }).classList.contains('wrenHeroPrimary')).toBe(true)
})

it('moves focus into the chooser, wraps Tab, and restores the trigger on Escape', async () => {
  const { selector, setOpen } = setupSelector({ drawerOpen: false })
  const account = {
    id: '0x000000000000000000000000000000000000dead',
    address: '0x000000000000000000000000000000000000dead',
    name: 'Watch Account'
  }
  const view = (open) => (
    <>
      {selector.renderCurrentAccount(account)}
      {open ? selector.renderAccountPanel({}) : null}
    </>
  )
  const utils = render(view(false))
  const { user } = utils
  const trigger = screen.getByRole('button', { name: /Watch Account/i })

  selector.componentDidMount()
  await user.click(trigger)
  utils.rerender(view(true))
  selector.componentDidUpdate()
  const addAccount = screen.getByRole('button', { name: 'Add account' })
  expect(document.activeElement).toBe(addAccount)

  await user.tab({ shift: true })
  expect(document.activeElement).toBe(addAccount)
  await user.tab()
  expect(document.activeElement).toBe(addAccount)

  await user.keyboard('{Escape}')
  setOpen(false)
  utils.rerender(view(false))
  selector.componentDidUpdate()
  expect(screen.queryByRole('region', { name: 'Accounts' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
  selector.componentWillUnmount()
})

it('restores the account trigger after selecting an account', async () => {
  const { selector, store, setOpen } = setupSelector({ drawerOpen: false })
  const account = {
    id: '0x000000000000000000000000000000000000dead',
    address: '0x000000000000000000000000000000000000dead',
    name: 'Watch Account'
  }
  const view = (open) => (
    <>
      {selector.renderCurrentAccount(account)}
      {open ? selector.renderAccountPanel({}) : null}
    </>
  )
  const utils = render(view(false))
  const { user } = utils
  const trigger = screen.getByRole('button', { name: /Watch Account/i })

  await user.click(trigger)
  utils.rerender(view(true))
  selector.componentDidUpdate()
  const accountController = new AccountController({ ...account, status: 'ok' }, { store })
  accountController.store = store
  accountController.selectFromDrawer()
  setOpen(false)
  utils.rerender(view(false))
  selector.componentDidUpdate()

  expect(screen.queryByRole('region', { name: 'Accounts' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
