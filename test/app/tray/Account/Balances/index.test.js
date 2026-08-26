import { BalancesExpanded } from '../../../../../app/tray/Account/Balances/BalancesExpanded'
import { BalancesPreview } from '../../../../../app/tray/Account/Balances/BalancesPreview'
import { Balance } from '../../../../../app/tray/Account/Balances/Balance'
import link from '../../../../../resources/link'
import { render, screen, within } from '../../../../componentSetup'

jest.mock('../../../../../resources/link', () => ({ send: jest.fn() }))

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

  expect(screen.getByRole('region', { name: 'Portfolio balance' })).toBeTruthy()
  expect(screen.getByText('Across enabled networks')).toBeTruthy()
  expect(screen.getByText('No balances yet')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  expect(screen.queryByText('Total')).toBeNull()
})

it('uses the native-currency USD quote for the single balances total', () => {
  const preview = new BalancesPreview({ account, moduleId: 'balances' })
  preview.store = (...path) => {
    const key = path.join('.')
    if (key === 'main.networks.ethereum') {
      return {
        1: {
          id: 1,
          name: 'Ethereum',
          isTestnet: false,
          connection: { endpoints: [{ connected: true }] }
        }
      }
    }
    if (key === 'main.networksMeta.ethereum') {
      return {
        1: {
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
            usd: { price: 507.2, change24hr: 0 }
          }
        }
      }
    }
  }

  const [native] = preview.getBalances(
    [
      {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 1,
        balance: '1250000000000000000',
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH'
      }
    ],
    {}
  )

  expect(native.totalValue.toNumber()).toBe(634)
  expect(native.displayValue).toBe('634')
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

it('uses the full search width until an in-field clear action is needed', async () => {
  const { user } = render(<BalancesExpandedHarness account={account} moduleId='balances' />)
  const filter = screen.getByRole('textbox', { name: 'Filter balances' })
  const filterSurface = filter.closest('.balanceFilter')

  expect(filterSurface.classList.contains('balanceFilterHasValue')).toBe(false)
  expect(filter.classList.contains('wrenInput')).toBe(true)
  expect(filter.classList.contains('wrenInputQuiet')).toBe(false)
  expect(filterSurface.parentElement.classList.contains('balancesExpandedView')).toBe(true)
  expect(filterSurface.nextElementSibling.classList.contains('balancesExpandedScroll')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Clear balance filter' })).toBeNull()

  await user.type(filter, 'eth')

  const clear = screen.getByRole('button', { name: 'Clear balance filter' })
  expect(filterSurface.classList.contains('balanceFilterHasValue')).toBe(true)
  expect(clear.classList.contains('wrenControlIcon')).toBe(true)
})

it('keeps filtered misses plain instead of showing empty-account artwork', () => {
  render(<BalancesPreviewHarness account={account} moduleId='balances' filter='not-present' />)

  expect(screen.getByText('No matching balances')).toBeTruthy()
  expect(document.querySelector('.wrenEmptyStateImage')).toBeNull()
})

it('hides holdings while keeping public unit prices visible', () => {
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
  expect(screen.getAllByTestId('display-value')).toHaveLength(1)
  expect(document.body.textContent).not.toContain('2,500')
  expect(document.body.textContent).toContain('2.4')
  expect(
    screen.getByRole('img', { name: 'TST asset' }).style.getPropertyValue('--asset-mark-chain-color')
  ).toBe('var(--wren-chain-ethereum)')
  expect(screen.getByRole('img', { name: 'TST asset' }).classList.contains('balancesAssetMark')).toBe(true)
  expect(screen.getByRole('img', { name: 'TST asset' }).classList.contains('assetMark-plain')).toBe(true)
})

it.each([
  ['yvWETH-1', '0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0'],
  ['USDS', '0xdC035D45d973E3EC169d2276DDab16f1e407384F']
])('renders bundled artwork for a %s balance without a remote logo', (symbol, tokenAddress) => {
  const balance = new Balance({
    symbol,
    balance: {
      address: tokenAddress,
      name: symbol,
      priceChange: '',
      decimals: 18,
      balance: '1',
      usdRate: { price: 1 },
      logoURI: ''
    },
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

  const mark = screen.getByRole('img', { name: `${symbol} asset` })
  expect(within(mark).getByAltText('')).toBeTruthy()
  expect(mark.textContent).not.toBe(symbol.slice(0, 1))
})
