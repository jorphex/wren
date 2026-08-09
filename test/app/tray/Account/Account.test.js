import { render, screen } from '../../../componentSetup'
import { AccountMain } from '../../../../app/tray/Account/Account'
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

it('renders the approved account-home identity and protects the total when balances are hidden', () => {
  const main = accountMain({ hideBalances: true })
  render(main.renderHomeHeader())

  expect(screen.getByText('Selected account')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Workshop' })).toBeTruthy()
  expect(screen.getByLabelText('Total balance hidden')).toBeTruthy()
})

it('keeps Send and copy address actions connected to their existing tray behavior', async () => {
  const main = accountMain()
  const { user } = render(main.renderHomeHeader())

  const addressCopyTarget = screen.getByRole('button', { name: 'Copy address' })
  expect(addressCopyTarget.textContent).toContain(address)

  await user.click(addressCopyTarget)
  expect(link.send).toHaveBeenCalledWith('tray:clipboardData', address)

  await user.click(screen.getByRole('button', { name: 'Send' }))
  expect(link.send).toHaveBeenCalledWith('*:addFrame', 'dappLauncher')
  expect(link.send).toHaveBeenCalledWith('tray:action', 'setDash', { showing: false })
})
