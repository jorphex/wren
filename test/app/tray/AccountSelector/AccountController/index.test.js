import { fireEvent, render, screen } from '../../../../componentSetup'
import {
  Account,
  AccountTypeMark,
  accountTypeIcon
} from '../../../../../app/tray/AccountSelector/AccountController'
import { getAccountTypeMarkSize } from '../../../../../resources/Components/AccountTypeMark'
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

test('balances account marks from the surrounding context size', () => {
  expect(getAccountTypeMarkSize('ledger', 20)).toBe(17)
  expect(getAccountTypeMarkSize('trezor', 20)).toBe(24)
  expect(getAccountTypeMarkSize('lattice', 20)).toBe(20)
  expect(getAccountTypeMarkSize('seed', 20)).toBe(20)

  const { container } = render(<AccountTypeMark type='trezor' size={17} />)
  const mark = container.firstChild
  const icon = mark.firstChild

  expect(mark.style.width).toBe('17px')
  expect(mark.style.height).toBe('17px')
  expect(mark.style.lineHeight).toBe('0')
  expect(icon.getAttribute('width')).toBe('100%')
  expect(icon.getAttribute('height')).toBe('100%')
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

test('counts only actionable requests in the account chooser badge', () => {
  const id = '0x0000000000000000000000000000000000000002'
  const account = new Account({ id, name: 'Garden', status: 'ok', lastSignerType: 'seed' })
  account.store = (...path) => {
    if (path.join('.') === `main.accounts.${id}`) {
      return {
        address: id,
        name: 'Garden',
        requests: {
          first: { mode: 'normal' },
          second: { mode: 'normal' },
          submitted: { mode: 'monitor' }
        }
      }
    }
    return ''
  }

  render(account.render())

  expect(screen.getByRole('status', { name: '2 pending account requests' }).textContent).toBe('2')
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
