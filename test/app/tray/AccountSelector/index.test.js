import { render, screen, waitFor } from '../../../componentSetup'
import { AccountSelector } from '../../../../app/tray/AccountSelector'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

it('exposes open account switching as a modal and closes it with shared Escape handling', async () => {
  const account = {
    id: '0x000000000000000000000000000000000000dead',
    address: '0x000000000000000000000000000000000000dead',
    name: 'Watch Account'
  }
  let drawerOpen = true
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'main.accounts') return { [account.id]: account }
    if (key === 'selected.current') return account.id
    if (key === 'selected.open') return true
    if (key === 'selected.showAccounts') return drawerOpen
    if (key === 'selected.hideBalances') return false
    if (key === 'windows.dash.showing') return false
    if (key === 'panel.accountFilter') return ''
  }
  store.toggleHideBalances = jest.fn()
  store.toggleShowAccounts = jest.fn((next) => {
    drawerOpen = typeof next === 'boolean' ? next : !drawerOpen
  })
  const selector = new AccountSelector({}, { store })
  selector.store = store
  selector.renderAccountList = () => <div />

  const view = render(selector.render())
  const { user } = view

  expect(screen.getByRole('dialog', { name: 'Accounts' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Accounts' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter accounts' }))

  await user.keyboard('{Escape}')
  expect(store.toggleShowAccounts).toHaveBeenCalledWith(false)
  view.rerender(selector.render())
  expect(screen.queryByRole('dialog')).toBeNull()
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
  expect(screen.queryByRole('button', { name: 'Account address QR code' })).toBeNull()
  const workspaceToggle = screen.getByRole('button', { name: 'Open dashboard' })
  expect(workspaceToggle).toBeTruthy()
  expect(workspaceToggle.querySelectorAll('svg rect')).toHaveLength(1)
})

it('keeps account identity and copy in the top bar without a redundant network label', async () => {
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.hideBalances') return false
    if (key === 'selected.showAccounts') return false
    if (key === 'windows.dash.showing') return false
  }
  store.toggleHideBalances = jest.fn()
  store.toggleShowAccounts = jest.fn()
  const selector = new AccountSelector({}, { store })
  selector.store = store
  const address = '0x000000000000000000000000000000000000dead'
  const { user } = render(selector.renderCurrentAccount({ id: address, address, name: 'Watch Account' }))

  expect(screen.getByText('Watch Account')).toBeTruthy()
  expect(screen.getByText('0x0000…dEaD')).toBeTruthy()
  expect(screen.queryByText('Ethereum')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Copy account address' }))
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', '0x000000000000000000000000000000000000dEaD')
})

it('shows the local account name with ENS when the preference is enabled', () => {
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'main.showLocalNameWithENS') return true
    if (key === 'selected.hideBalances') return false
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
      name: 'Treasury',
      ensName: 'treasury.eth'
    })
  )

  expect(screen.getByText('Treasury')).toBeTruthy()
  expect(screen.getByText('treasury.eth')).toBeTruthy()
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
  expect(toggle.querySelectorAll('svg rect')).toHaveLength(2)
  await user.click(toggle)
  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: false })
})

it('moves focus into the chooser and restores the account trigger after Escape', async () => {
  let drawerOpen = false
  const account = {
    id: '0x000000000000000000000000000000000000dead',
    address: '0x000000000000000000000000000000000000dead',
    name: 'Watch Account'
  }
  const store = (...path) => {
    const key = path.join('.')
    if (key === 'main.accounts') return { [account.id]: account }
    if (key === 'selected.current') return account.id
    if (key === 'selected.open') return true
    if (key === 'selected.showAccounts') return drawerOpen
    if (key === 'selected.hideBalances') return false
    if (key === 'windows.dash.showing') return false
    if (key === 'panel.accountFilter') return ''
  }
  store.toggleHideBalances = jest.fn()
  store.toggleShowAccounts = jest.fn((next) => {
    drawerOpen = typeof next === 'boolean' ? next : !drawerOpen
  })
  const selector = new AccountSelector({}, { store })
  selector.store = store
  selector.renderAccountList = () => <div />
  const utils = render(selector.render())
  const { user } = utils
  const trigger = screen.getByRole('button', { name: /Watch Account/i })

  expect(trigger.closest('.accountSelector').classList.contains('accountSelectorOpen')).toBe(true)

  await user.click(trigger)
  utils.rerender(selector.render())
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter accounts' }))

  await user.keyboard('{Escape}')
  utils.rerender(selector.render())
  expect(screen.queryByRole('region', { name: 'Accounts' })).toBeNull()
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Watch Account/i }))
  })
})
