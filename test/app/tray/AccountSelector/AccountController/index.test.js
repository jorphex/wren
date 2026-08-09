import { fireEvent, render, screen } from '../../../../componentSetup'
import { Account } from '../../../../../app/tray/AccountSelector/AccountController'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({
  rpc: jest.fn(),
  send: jest.fn()
}))

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

const setupDetails = ({ addressHover = false, ensName = '' } = {}) => {
  const account = new Account({ id: '0xabc', name: 'Garden' })
  account.state.addressHover = addressHover
  account.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.accounts.0xabc') {
      return {
        address: '0x0000000000000000000000000000000000000001',
        ensName
      }
    }
    if (key === 'main.accounts.0xabc.requests') return {}
    if (key === 'main.showLocalNameWithENS') return false
  }
  return account
}

const setupAccountCard = (requests = {}) => {
  const account = new Account({
    id: '0xabc',
    name: 'Garden',
    status: 'ok',
    active: true,
    index: 0,
    lastSignerType: 'seed'
  })
  account.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.accounts.0xabc') {
      return {
        address: '0x0000000000000000000000000000000000000001',
        ensName: ''
      }
    }
    if (key === 'main.accounts.0xabc.requests') return requests
    if (key === 'main.showLocalNameWithENS') return false
    if (key === 'selected.current') return ''
    if (key === 'selected.open') return false
    if (key === 'selected.minimized') return false
    if (key === 'selected.view') return 'default'
    if (key === 'selected.showAccounts') return false
    if (key === 'selected.position.initial') return { top: 0, bottom: 0, height: 80, index: 0 }
    if (key === 'selected.position.initial.index') return 0
    if (key === 'view.addAccount') return false
  }
  return render(account.render())
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

test('exposes the shortened account address as a native button', () => {
  const account = setupDetails()
  account.setState = jest.fn()
  render(account.renderDetails())

  fireEvent.click(screen.getByRole('button', { name: 'Show full account address' }))

  expect(account.setState).toHaveBeenCalledWith({ addressHover: true })
})

test('exposes the full account address as a native copy button', () => {
  const account = setupDetails({ addressHover: true })
  account.copyAddress = jest.fn()
  render(account.renderDetails())

  fireEvent.click(screen.getByRole('button', { name: 'Copy account address' }))

  expect(account.copyAddress).toHaveBeenCalledTimes(1)
})

test('omits the request badge when the account has no pending work', () => {
  setupAccountCard()

  expect(screen.queryByRole('status')).toBeNull()
})

test('shows the request badge for pending account work', () => {
  setupAccountCard({ request1: { mode: 'normal' } })

  expect(screen.getByRole('status', { name: '1 pending account request' }).textContent).toBe('1')
})

test('switches directly from the account drawer without collapsing the account view', () => {
  const account = new Account({
    id: '0x0000000000000000000000000000000000000002',
    name: 'Hardware',
    status: 'ok',
    drawer: true,
    lastSignerType: 'ledger'
  })
  account.store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.current') return '0x0000000000000000000000000000000000000001'
    if (key === 'main.accounts.0x0000000000000000000000000000000000000002') {
      return {
        address: '0x0000000000000000000000000000000000000002',
        name: 'Hardware',
        requests: {}
      }
    }
  }
  account.store.toggleShowAccounts = jest.fn()

  render(account.render())
  fireEvent.click(screen.getByRole('button', { name: /Hardware/ }))

  expect(account.store.toggleShowAccounts).toHaveBeenCalledWith(false)
  expect(link.rpc).toHaveBeenCalledWith(
    'setSigner',
    '0x0000000000000000000000000000000000000002',
    expect.any(Function)
  )
})

test('closes the drawer when the current account is chosen again', () => {
  const id = '0x0000000000000000000000000000000000000001'
  const account = new Account({ id, name: 'Workshop', status: 'ok', drawer: true, lastSignerType: 'seed' })
  account.store = (...path) => {
    const key = path.join('.')
    if (key === 'selected.current') return id
    if (key === `main.accounts.${id}`) return { address: id, name: 'Workshop', requests: {} }
  }
  account.store.toggleShowAccounts = jest.fn()

  render(account.render())
  fireEvent.click(screen.getByRole('button', { name: /Workshop/ }))

  expect(account.store.toggleShowAccounts).toHaveBeenCalledWith(false)
  expect(link.rpc).not.toHaveBeenCalled()
})
