import { AddAccounts, Dash } from '../../../../app/dash/Accounts'
import AccountTypeMark from '../../../../resources/Components/AccountTypeMark'
import link from '../../../../resources/link'
import { getAddress } from '../../../../resources/utils'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn(), rpc: jest.fn() }))
jest.mock('../../../../resources/Components/AccountTypeMark', () => jest.fn(() => <svg aria-hidden='true' />))

const account = '0x0000000000000000000000000000000000000001'

class AccountsHarness extends Dash {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.signers') return {}
    if (key === 'main.accounts') {
      return { [account]: { address: account, name: 'Workshop', lastSignerType: 'address' } }
    }
    if (key === 'main.networks') return { ethereum: {} }
    if (key === 'main.origins') return {}
  }
}

class SignerAccountsHarness extends Dash {
  store(...path) {
    const key = path.join('.')
    if (key === 'main.signers') {
      return {
        personal: {
          id: 'personal',
          name: 'Personal',
          type: 'ring',
          addresses: [account]
        }
      }
    }
    if (key === 'main.accounts') {
      return { [account]: { address: account, name: 'Personal', lastSignerType: 'ring' } }
    }
    if (key === 'main.networks') return { ethereum: {} }
    if (key === 'main.origins') return {}
  }
}

it('groups account methods into a semantic ruled chooser', () => {
  render(<AddAccounts data={{}} />)

  expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
    'Hardware devices',
    'Create new',
    'Import existing',
    'Watch-only'
  ])
  expect(screen.getAllByRole('button')).toHaveLength(9)
})

it('uses the seed identity mark for the seed phrase route', () => {
  render(<AddAccounts data={{}} />)

  expect(AccountTypeMark.mock.calls.some(([props]) => props.type === 'seed' && props.size === 20)).toBe(true)
})

it('keeps each account method a one-click route', () => {
  render(<AddAccounts data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Ledger device' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'ledger' }
  })
})

it('routes creation separately from recovery-phrase import', () => {
  render(<AddAccounts data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Create recovery phrase' }))
  fireEvent.click(screen.getByRole('button', { name: 'Import recovery phrase' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'create-seed' }
  })
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'seed' }
  })
})

it('filters the account chooser for creation and import entry points', () => {
  const view = render(<AddAccounts data={{ accountChooserMode: 'create' }} />)

  expect(screen.getByText('Create an account')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create recovery phrase' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Import recovery phrase' })).toBeNull()

  view.rerender(<AddAccounts data={{ accountChooserMode: 'import' }} />)

  expect(screen.getByText('Import an account')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Import recovery phrase' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Create recovery phrase' })).toBeNull()
})

it('routes the three Perch add-account actions to real Wren flows', () => {
  render(<AccountsHarness data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Derive new' }))
  fireEvent.click(screen.getByRole('button', { name: 'Watch' }))
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))

  expect(link.send.mock.calls).toEqual(
    expect.arrayContaining([
      [
        'tray:action',
        'navDash',
        { view: 'accounts', data: { showAddAccounts: true, accountChooserMode: 'create' } }
      ],
      [
        'tray:action',
        'navDash',
        { view: 'accounts', data: { showAddAccounts: true, newAccountType: 'nonsigning' } }
      ],
      [
        'tray:action',
        'navDash',
        { view: 'accounts', data: { showAddAccounts: true, accountChooserMode: 'import' } }
      ]
    ])
  )
})

it('keeps watch-only accounts visible and opens them directly', () => {
  render(<AccountsHarness data={{}} />)

  const checkSummedAddress = getAddress(account)
  const accountRow = screen.getByRole('button', { name: `Workshop ${checkSummedAddress}` })

  expect(screen.getByText('0x0000…0001')).toBeTruthy()
  expect(accountRow.title).toBe(checkSummedAddress)
  fireEvent.click(accountRow)

  expect(link.rpc).toHaveBeenCalledWith('setSigner', account, expect.any(Function))
})

it('shows a real signer identity and opens its existing detail route', () => {
  render(<SignerAccountsHarness data={{}} />)

  expect(screen.getByText('0x0000…0001 · local signer')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Manage accounts for Personal' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'personal' }
  })
})
