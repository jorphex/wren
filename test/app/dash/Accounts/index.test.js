import { AddAccounts, Dash } from '../../../../app/dash/Accounts'
import AccountTypeMark from '../../../../resources/Components/AccountTypeMark'
import link from '../../../../resources/link'
import { getAddress } from '../../../../resources/utils'
import { fireEvent, render, screen } from '../../../componentSetup'

jest.mock('../../../../resources/link', () => ({ send: jest.fn(), rpc: jest.fn() }))
jest.mock('../../../../resources/Components/AccountTypeMark', () => jest.fn(() => <svg aria-hidden='true' />))

const account = '0x0000000000000000000000000000000000000001'
const hardwareAccount = '0x0000000000000000000000000000000000000002'

beforeEach(() => {
  jest.clearAllMocks()
})

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
          status: this.props.signerStatus || 'ok',
          addresses: [account]
        },
        ledger: {
          id: 'ledger',
          name: 'Ledger',
          type: 'ledger',
          status: 'disconnected',
          addresses: [hardwareAccount]
        }
      }
    }
    if (key === 'main.accounts') {
      return {
        [account]: { address: account, name: 'Personal', lastSignerType: 'ring' },
        [hardwareAccount]: {
          address: hardwareAccount,
          name: 'Ledger vault',
          lastSignerType: 'ledger'
        }
      }
    }
    if (key === 'main.networks') return { ethereum: {} }
    if (key === 'main.origins') return {}
  }
}

it('offers four clear setup intents with private-key creation in Advanced', () => {
  render(<AddAccounts data={{}} />)
  expect(screen.getByRole('heading', { name: 'Add account' })).toBeTruthy()
  expect(screen.getAllByRole('button').map((button) => button.textContent.trim())).toEqual([
    'Create wallet',
    'Import wallet',
    'Connect hardware wallet',
    'Watch address',
    'Create private key'
  ])
})

it('uses the seed identity mark for the seed phrase route', () => {
  render(<AddAccounts data={{ accountChooserMode: 'import' }} />)

  expect(AccountTypeMark.mock.calls.some(([props]) => props.type === 'seed' && props.size === 20)).toBe(true)
})

it('keeps each hardware method a one-click route', () => {
  render(<AddAccounts data={{ accountChooserMode: 'hardware' }} />)

  fireEvent.click(screen.getByRole('button', { name: 'Ledger device' }))

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'ledger' }
  })
})

it('routes creation separately from recovery-phrase import', () => {
  const view = render(<AddAccounts data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }))
  view.rerender(<AddAccounts data={{ accountChooserMode: 'import' }} />)
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

it('routes the account-add actions to real Wren flows', () => {
  render(<AccountsHarness data={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }))
  fireEvent.click(screen.getByRole('button', { name: 'Watch address' }))
  fireEvent.click(screen.getByRole('button', { name: 'Import wallet' }))
  fireEvent.click(screen.getByRole('button', { name: 'Connect hardware wallet' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, accountChooserMode: 'hardware' }
  })

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

it('keeps signing and watch accounts together before account creation actions', () => {
  render(<AccountsHarness data={{}} />)

  expect(
    screen
      .getAllByRole('heading', { level: 2 })
      .slice(0, 3)
      .map((heading) => heading.textContent)
  ).toEqual(['Signing accounts', 'Watch accounts', 'Add account'])
})

it('keeps ready signing accounts as direct account selection', () => {
  render(<SignerAccountsHarness data={{}} />)
  link.rpc.mockImplementationOnce((_method, _account, callback) => callback(null, {}))

  expect(screen.getByRole('heading', { name: 'Signing accounts' })).toBeTruthy()
  expect(screen.getByText('0x0000…0001 · signer ready')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `Select Personal ${getAddress(account)}` }))

  expect(link.rpc).toHaveBeenCalledWith('setSigner', account, expect.any(Function))
  expect(link.send).not.toHaveBeenCalledWith(
    'tray:action',
    'navDash',
    expect.objectContaining({ view: 'expandedSigner' })
  )
})

it('opens and reconnects a hardware signer when its account needs unlocking', () => {
  render(<SignerAccountsHarness data={{}} />)
  link.rpc.mockImplementationOnce((_method, _account, callback) => callback(null, {}))

  expect(screen.getByText('0x0000…0002 · device disconnected')).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', {
      name: `Select and unlock Ledger vault ${getAddress(hardwareAccount)}`
    })
  )

  expect(link.rpc).toHaveBeenCalledWith('setSigner', hardwareAccount, expect.any(Function))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'ledger' }
  })
  expect(link.send).toHaveBeenCalledWith('dash:reloadSigner', 'ledger')
})

it('opens hardware signer management without waiting for account selection to return', () => {
  render(<SignerAccountsHarness data={{}} />)
  link.rpc.mockImplementationOnce(() => {})

  fireEvent.click(
    screen.getByRole('button', {
      name: `Select and unlock Ledger vault ${getAddress(hardwareAccount)}`
    })
  )

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'ledger' }
  })
  expect(link.send).not.toHaveBeenCalledWith('dash:reloadSigner', expect.anything())
})

it('opens hardware signer management even when the device is already ready', () => {
  class ReadyHardwareHarness extends SignerAccountsHarness {
    store(...path) {
      const value = super.store(...path)
      if (path.join('.') !== 'main.signers') return value
      return { ...value, ledger: { ...value.ledger, status: 'ok' } }
    }
  }
  render(<ReadyHardwareHarness data={{}} />)
  link.rpc.mockImplementationOnce((_method, _account, callback) => callback(null, {}))

  fireEvent.click(
    screen.getByRole('button', {
      name: `Select and unlock Ledger vault ${getAddress(hardwareAccount)}`
    })
  )

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'ledger' }
  })
  expect(link.send).not.toHaveBeenCalledWith('dash:reloadSigner', expect.anything())
})

it('routes a detached hardware account to device discovery after selecting it', () => {
  class DetachedHardwareHarness extends SignerAccountsHarness {
    store(...path) {
      const value = super.store(...path)
      if (path.join('.') !== 'main.signers') return value
      return { personal: value.personal }
    }
  }
  render(<DetachedHardwareHarness data={{}} />)
  link.rpc.mockImplementationOnce((_method, _account, callback) => callback(null, {}))

  fireEvent.click(
    screen.getByRole('button', {
      name: `Select and unlock Ledger vault ${getAddress(hardwareAccount)}`
    })
  )

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'accounts',
    data: { showAddAccounts: true, newAccountType: 'ledger' }
  })
})

it('opens the password form for a locked software signer after selecting its account', () => {
  render(<SignerAccountsHarness data={{}} signerStatus='locked' />)
  link.rpc.mockImplementationOnce((_method, _account, callback) => callback(null, {}))

  fireEvent.click(
    screen.getByRole('button', {
      name: `Select and unlock Personal ${getAddress(account)}`
    })
  )

  expect(link.rpc).toHaveBeenCalledWith('setSigner', account, expect.any(Function))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'expandedSigner',
    data: { signer: 'personal' }
  })
  expect(link.send).not.toHaveBeenCalledWith('dash:reloadSigner', expect.anything())
})
