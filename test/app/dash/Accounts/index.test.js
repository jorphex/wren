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
  const recoveryPhraseButtons = screen.getAllByRole('button', { name: 'Recovery phrase' })

  fireEvent.click(recoveryPhraseButtons[0])
  fireEvent.click(recoveryPhraseButtons[1])

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'create-seed' }
  })
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'seed' }
  })
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
