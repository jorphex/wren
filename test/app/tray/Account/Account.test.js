import Restore from 'react-restore'
import { render, screen, waitFor } from '../../../componentSetup'
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

  expect(screen.getByText('Selected account')).toBeTruthy()
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

it('edits the account name from the header and returns focus after saving', async () => {
  const main = accountMain()
  const { user } = render(main.renderHomeHeader())

  await user.click(screen.getByRole('button', { name: 'Update account name' }))
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
  expect(view.style.top).toBe('68px')
  expect(screen.getByText('Balances')).toBeTruthy()
})
