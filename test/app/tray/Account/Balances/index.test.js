import { BalancesExpanded } from '../../../../../app/tray/Account/Balances/BalancesExpanded'
import { BalancesPreview } from '../../../../../app/tray/Account/Balances/BalancesPreview'
import { Balance } from '../../../../../app/tray/Account/Balances/Balance'
import link from '../../../../../resources/link'
import { render, screen } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))
jest.mock('../../../../../resources/Components/RingIcon', () => {
  const RingIconMock = () => <span data-testid='ring-icon' />
  RingIconMock.displayName = 'RingIconMock'
  return RingIconMock
})

const account = 'account-1'
const address = '0x0000000000000000000000000000000000000001'

class BalancesPreviewHarness extends BalancesPreview {
  store(...path) {
    const key = path.join('.')
    if (key === `main.accounts.${account}`) return { address, lastSignerType: 'ledger' }
    if (key === `main.balances.${address}`) return []
    if (key === 'main.rates') return {}
    if (key === 'main.networks.ethereum' || key === 'main.networksMeta.ethereum') return {}
    if (key === `main.accounts.${address}.balances.lastUpdated`) return Date.now()
  }
}

class BalancesExpandedHarness extends BalancesExpanded {
  store(...path) {
    const key = path.join('.')
    if (key === `main.accounts.${account}`) return { address, lastSignerType: 'ledger' }
    if (key === `main.balances.${address}`) return []
    if (key === 'main.rates') return {}
    if (key === 'main.networks.ethereum' || key === 'main.networksMeta.ethereum') return {}
    if (key === `main.accounts.${address}.balances.lastUpdated`) return Date.now()
  }
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

afterAll(() => {
  delete global.ResizeObserver
})

it('does not offer an empty expanded balance view', () => {
  render(<BalancesPreviewHarness account={account} moduleId='balances' />)

  expect(screen.getByText('No balances yet')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  expect(screen.queryByText('Total')).toBeNull()
})

it('opens token settings from the expanded native control', async () => {
  const { user } = render(<BalancesExpandedHarness account={account} moduleId='balances' />)

  const addToken = screen.getByRole('button', { name: 'Add token' })
  expect(screen.getByText('No balances yet')).toBeTruthy()
  expect(addToken.classList.contains('wrenControl')).toBe(true)
  await user.click(addToken)

  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', {
    view: 'tokens',
    data: { notify: 'addToken' }
  })
})

it('keeps filtered misses plain instead of showing empty-account artwork', () => {
  render(<BalancesPreviewHarness account={account} moduleId='balances' filter='not-present' />)

  expect(screen.getByText('No matching balances')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeNull()
})

it('removes asset quantities and fiat values from the DOM while balances are hidden', () => {
  const tokenBalance = {
    name: 'Test token',
    priceChange: '2.4',
    decimals: 18,
    balance: '1250000000000000000',
    usdRate: { price: 2000 },
    logoURI: ''
  }
  const balance = new Balance({
    symbol: 'TST',
    balance: tokenBalance,
    i: 0,
    scanning: false,
    chainId: 1
  })
  balance.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.networks.ethereum.1') return { name: 'Ethereum', isTestnet: false }
    if (key === 'main.networksMeta.ethereum.1.primaryColor') return 'accent1'
    if (key === 'selected.hideBalances') return true
  }

  render(balance.render())

  expect(screen.getByLabelText('Balance hidden').textContent).toContain('•••• TST')
  expect(screen.getByLabelText('Value hidden').textContent).toBe('$••••')
  expect(screen.queryByTestId('display-value')).toBeNull()
  expect(document.body.textContent).not.toContain('2.4')
})
