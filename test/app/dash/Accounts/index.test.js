import { AddAccounts, Dash } from '../../../../app/dash/Accounts'
import link from '../../../../resources/link'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn(), rpc: jest.fn() }))

const account = '0x0000000000000000000000000000000000000001'

class AccountsHarness extends Dash {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.signers') return {}
    if (key === 'main.accounts') {
      return { [account]: { address: account, name: 'Workshop', lastSignerType: 'address' } }
    }
  }
}

it('groups account methods into a semantic ruled chooser', () => {
  render(<AddAccounts data={{}} />)

  expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
    'Hardware devices',
    'Local accounts',
    'Watch-only'
  ])
  expect(screen.getAllByRole('button')).toHaveLength(7)
})

it('keeps each account method a one-click route', () => {
  render(<AddAccounts data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Ledger device' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'ledger' }
  })
})

it('keeps watch-only accounts visible and opens them directly', () => {
  render(<AccountsHarness data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: /Workshop/ }))

  expect(link.rpc).toHaveBeenCalledWith('setSigner', account, expect.any(Function))
})
