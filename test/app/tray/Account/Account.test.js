import Restore from 'react-restore'
import { fireEvent, render, screen, waitFor, within } from '../../../componentSetup'
import { AccountBody, AccountMain } from '../../../../app/tray/Account/Account'
import link from '../../../../resources/link'

jest.mock('../../../../resources/link', () => ({
  send: jest.fn()
}))

const address = '0x0000000000000000000000000000000000000001'

function accountMain({ hideBalances = false } = {}) {
  const main = new AccountMain({ id: address })
  main.store = (...path) => {
    const key = path.join('.')
    if (key === `main.accounts.${address}`) return { address, name: 'Workshop' }
    if (key === 'main.networks.ethereum') return {}
    if (key === 'main.networksMeta.ethereum') return {}
    if (key === 'main.rates') return {}
    if (key === `main.balances.${address}`) return []
    if (key === 'selected.hideBalances') return hideBalances
  }
  return main
}

it('renders the approved account-home identity without duplicating the balances total', () => {
  const main = accountMain({ hideBalances: true })
  render(main.renderHomeHeader())

  expect(screen.queryByText('Selected account')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Workshop' })).toBeTruthy()
  expect(screen.queryByText('Total balance')).toBeNull()
  expect(screen.queryByLabelText('Total balance hidden')).toBeNull()
})

it('keeps Send and copy address actions connected to their existing tray behavior', async () => {
  const main = accountMain()
  const { user } = render(main.renderHomeHeader())

  const addressCopyTarget = screen.getByRole('button', { name: 'Copy address' })
  expect(addressCopyTarget.textContent).toContain(address)
  expect(screen.queryByRole('button', { name: /block explorer/i })).toBeNull()

  await user.click(addressCopyTarget)
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)

  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(link.send).toHaveBeenCalledWith('tray:action', 'navDash', { view: 'send', data: {} })
})

it('shows the selected account address QR on hover without a click action', () => {
  const main = accountMain()
  render(main.renderHomeHeader())
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
  const main = accountMain()
  render(main.renderHomeHeader())
  const qrTrigger = screen.getByRole('button', { name: 'Account address QR code' })

  fireEvent.focus(qrTrigger)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('img', { name: 'QR code for account address' })).toBeTruthy()

  fireEvent.blur(qrTrigger)
  expect(qrTrigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('img', { name: 'QR code for account address' })).toBeNull()
})

it('edits the account name from the header and returns focus after saving', async () => {
  const main = accountMain()
  const { user } = render(main.renderHomeHeader())

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
  const main = accountMain()
  const { user } = render(main.renderHomeHeader())

  await user.click(screen.getByRole('button', { name: 'Update account name' }))
  const input = screen.getByRole('textbox', { name: 'Account name' })
  await user.clear(input)
  await user.type(input, 'Discarded{Escape}')

  expect(link.send).not.toHaveBeenCalledWith('tray:renameAccount', expect.anything(), expect.anything())
  const rename = screen.getByRole('button', { name: 'Update account name' })
  await waitFor(() => expect(document.activeElement).toBe(rename))
})

it('uses the compact frame and explicit title for expanded balances', () => {
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
  expect(view.style.top).toBe('10px')
  expect(screen.getByText('Balances')).toBeTruthy()
})
