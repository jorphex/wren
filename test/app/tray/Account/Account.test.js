import Restore from 'react-restore'
import { fireEvent, render, screen, waitFor, within } from '../../../componentSetup'
import {
  portfolioSummary,
  AccountAddressActions,
  AccountBody,
  AccountMain,
  AccountNameEditor,
  EMPTY_ACTIVITY_MODULE_HEIGHT,
  accountModuleHeight,
  activityModuleMinHeight
} from '../../../../app/tray/Account/Account'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({
  invoke: jest.fn(() => Promise.resolve({ success: true })),
  send: jest.fn()
}))

const address = '0x0000000000000000000000000000000000000001'

it('sizes Activity to its visible rows and caps the preview at four', () => {
  expect(accountModuleHeight('activity', 332, address, [])).toBe(EMPTY_ACTIVITY_MODULE_HEIGHT)
  expect(activityModuleMinHeight(1)).toBe(166)
  expect(activityModuleMinHeight(2)).toBe(224)
  expect(activityModuleMinHeight(3)).toBe(282)
  expect(activityModuleMinHeight(4)).toBe(340)
  expect(activityModuleMinHeight(5)).toBe(340)
  expect(accountModuleHeight('activity', 158, address.toUpperCase(), [{ account: address }])).toBe(166)
  expect(accountModuleHeight('activity', 236, address, [{ account: address }, { account: address }])).toBe(
    236
  )
  expect(accountModuleHeight('activity', 158, address, [{ account: '0x2' }])).toBe(
    EMPTY_ACTIVITY_MODULE_HEIGHT
  )
  expect(accountModuleHeight('settings', 72, address, [])).toBe(104)
})

function accountMain({ hideBalances = false, balances = [], networks = {}, networksMeta = {} } = {}) {
  const main = new AccountMain({ id: address })
  main.store = (...path) => {
    const key = path.join('.')
    if (key === `main.accounts.${address}`) return { address, name: 'Workshop' }
    if (key === 'main.networks.ethereum') return networks
    if (key === 'main.networksMeta.ethereum') return networksMeta
    if (key === 'main.rates') return {}
    if (key === `main.balances.${address}`) return balances
    if (key === 'selected.hideBalances') return hideBalances
  }
  return main
}

it('renders the portfolio balance once and honors balance privacy', () => {
  const main = accountMain({ hideBalances: true })
  render(main.renderPortfolioSummary())

  expect(screen.getByRole('region', { name: 'Portfolio balance' })).toBeTruthy()
  expect(screen.getByLabelText('Portfolio balance hidden')).toBeTruthy()
  expect(screen.queryByText('Total balance')).toBeNull()
})

it('keeps the portfolio Send action connected to the native flow', async () => {
  const main = accountMain()
  const { user } = render(main.renderPortfolioSummary())

  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view: 'send', data: {} })
})

it('keeps populated portfolio balance copy concise', () => {
  const main = accountMain({
    balances: [
      {
        address: '0x0000000000000000000000000000000000000000',
        balance: '1000000000000000000',
        chainId: 1,
        decimals: 18,
        symbol: 'ETH'
      }
    ],
    networks: {
      1: { id: 1, isTestnet: false, connection: { endpoints: [{ connected: true }] } }
    },
    networksMeta: {
      1: { nativeCurrency: { decimals: 18, symbol: 'ETH', usd: { price: 1 } } }
    }
  })

  render(main.renderPortfolioSummary())

  expect(screen.queryByText('Across enabled networks')).toBeNull()
  expect(screen.queryByText('No assets on this account yet')).toBeNull()
})

it('shows the selected account address QR on hover without a click action', () => {
  render(<AccountAddressActions address={address} name='Workshop' />)
  const qrTrigger = screen.getByRole('button', { name: 'Account address QR code' })
  const disclosure = qrTrigger.closest('.accountHomeQrDisclosure')

  expect(qrTrigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(qrTrigger)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.mouseEnter(disclosure)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('true')
  const preview = document.getElementById(qrTrigger.getAttribute('aria-controls'))
  expect(within(preview).getByText('Workshop')).toBeTruthy()
  expect(within(preview).getByText(address)).toBeTruthy()
  const qr = within(preview).getByRole('img', { name: 'QR code for account address' })
  expect(qr.getAttribute('data-qr-payload')).toBe(address)
  expect(qr.getAttribute('data-qr-quiet-zone')).toBe('4')

  fireEvent.mouseLeave(disclosure)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('img', { name: 'QR code for account address' })).toBeNull()
})

it('keeps the account address QR available to keyboard focus', () => {
  render(<AccountAddressActions address={address} name='Workshop' />)
  const qrTrigger = screen.getByRole('button', { name: 'Account address QR code' })

  fireEvent.focus(qrTrigger)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('img', { name: 'QR code for account address' })).toBeTruthy()

  fireEvent.blur(qrTrigger)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('img', { name: 'QR code for account address' })).toBeNull()
})

it('edits the account name from the header and returns focus after saving', async () => {
  const { user } = render(<AccountNameEditor account={address} name='Workshop' />)

  const renameTarget = screen.getByRole('button', { name: 'Update account name' })
  expect(renameTarget.textContent).toContain('Workshop')
  await user.click(renameTarget)
  const input = screen.getByRole('textbox', { name: 'Account name' })
  await user.clear(input)
  await user.type(input, 'Treasury{Enter}')

  expect(link.send).toHaveBeenCalledWith('tray:renameAccount', address, 'Treasury')
  const rename = screen.getByRole('button', { name: 'Update account name' })
  await waitFor(() => expect(document.activeElement).toBe(rename))
})

it('cancels header name editing without changing the account', async () => {
  const { user } = render(<AccountNameEditor account={address} name='Workshop' />)

  await user.click(screen.getByRole('button', { name: 'Update account name' }))
  const input = screen.getByRole('textbox', { name: 'Account name' })
  await user.clear(input)
  await user.type(input, 'Discarded{Escape}')

  expect(link.send).not.toHaveBeenCalledWith('tray:renameAccount', expect.anything(), expect.anything())
  const rename = screen.getByRole('button', { name: 'Update account name' })
  await waitFor(() => expect(document.activeElement).toBe(rename))
})

it('uses the shared 64px wallet header and explicit title for expanded balances', () => {
  const store = Restore.create(
    {
      selected: { open: false },
      windows: {
        panel: {
          footer: { height: 0 },
          nav: [{ view: 'expandedModule', data: { id: 'balances', account: address } }]
        }
      },
      main: {
        accounts: { [address]: { address } },
        balances: { [address]: [] },
        rates: {},
        networks: { ethereum: {} },
        networksMeta: { ethereum: {} }
      }
    },
    {}
  )
  const ConnectedAccountBody = Restore.connect(AccountBody, store)

  render(<ConnectedAccountBody id={address} />)

  const view = document.querySelector('.accountView')
  expect(view.classList.contains('accountViewCompact')).toBe(true)
  expect(view.style.top).toBe('0px')
  expect(screen.getByText('Balances')).toBeTruthy()
})

const portfolioStore =
  ({
    balances,
    updated = Date.now(),
    quote,
    networks = { 1: { on: true, connection: { endpoints: [{ connected: true }] } } }
  }) =>
  (...path) => {
    const key = path.join('.')
    if (key === 'main.accounts.' + address) return { address, balances: { lastUpdated: updated } }
    if (key === 'main.balances.' + address) return balances
    if (key === 'main.networks.ethereum') return networks
    if (key === 'main.networksMeta.ethereum')
      return { 1: { nativeCurrency: { decimals: 18, symbol: 'ETH', usd: quote } } }
    if (key === 'main.rates') return {}
  }
const nativeBalance = {
  address: '0x0000000000000000000000000000000000000000',
  chainId: 1,
  decimals: 18,
  balance: '1000000000000000000'
}
it('does not confuse missing balance data or prices with a zero portfolio', () => {
  expect(portfolioSummary(portfolioStore({ balances: undefined, updated: undefined }), address).value).toBe(
    '—'
  )
  expect(portfolioSummary(portfolioStore({ balances: [nativeBalance] }), address)).toMatchObject({
    value: '—',
    note: 'Prices unavailable',
    partial: true
  })
  expect(
    portfolioSummary(portfolioStore({ balances: [{ ...nativeBalance, balance: '0' }] }), address)
  ).toMatchObject({ value: '$0.00', note: 'No balances found on connected networks', partial: false })
})
it('labels partial portfolio value when token prices are missing', () => {
  const balances = [
    nativeBalance,
    { ...nativeBalance, address: '0x1111111111111111111111111111111111111111' }
  ]
  expect(portfolioSummary(portfolioStore({ balances, quote: { price: 2 } }), address)).toMatchObject({
    value: '$2.00',
    partial: true,
    note: 'Some prices unavailable'
  })
})
it('hides balance-derived empty and coverage messages with portfolio privacy', () => {
  render(accountMain({ hideBalances: true }).renderPortfolioSummary())
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByText('$0.00')).toBeNull()
})
