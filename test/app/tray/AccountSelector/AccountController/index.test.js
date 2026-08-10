import { fireEvent, render, screen } from '../../../../componentSetup'
import { Account, accountTypeIcon } from '../../../../../app/tray/AccountSelector/AccountController'
import link from '../../../../../resources/link'

jest.mock('../../../../../resources/link', () => ({
  rpc: jest.fn(),
  send: jest.fn()
}))

test('maps account identity types to distinct Wren glyphs', () => {
  expect(accountTypeIcon('address')).toBe('watch')
  expect(accountTypeIcon('seed')).toBe('seedling')
  expect(accountTypeIcon('ring')).toBe('key')
  expect(accountTypeIcon('trezor')).toBe('hardware')
})

test('selects an account from the startup chooser', () => {
  const id = '0x0000000000000000000000000000000000000002'
  const account = new Account({ id, name: 'Garden', status: 'ok', lastSignerType: 'seed' })
  account.store = (...path) => {
    if (path.join('.') === `main.accounts.${id}`) return { address: id, name: 'Garden', requests: {} }
    return ''
  }

  render(account.render())
  fireEvent.click(screen.getByRole('button', { name: /Garden/ }))

  expect(link.rpc).toHaveBeenCalledWith('setSigner', id, expect.any(Function))
})

test('shows pending work in a chooser row without restoring the legacy card', () => {
  const id = '0x0000000000000000000000000000000000000002'
  const account = new Account({ id, name: 'Garden', status: 'ok', lastSignerType: 'seed' })
  account.store = (...path) => {
    if (path.join('.') === `main.accounts.${id}`) {
      return { address: id, name: 'Garden', requests: { request1: { mode: 'normal' } } }
    }
    return ''
  }

  render(account.render())

  expect(screen.getByRole('status', { name: '1 pending account request' }).textContent).toBe('1')
  expect(screen.queryByText('Show account activity')).toBeNull()
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
