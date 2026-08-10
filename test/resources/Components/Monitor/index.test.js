import { fireEvent, render, screen } from '../../../componentSetup'

import link from '../../../../resources/link'
import { ChainSummaryComponent } from '../../../../resources/Components/Monitor'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

class MonitorHarness extends ChainSummaryComponent {
  store(...path) {
    const key = path.at(-1)
    if (key === 'gas.price.levels') return { fast: '0x3b9aca00' }
    if (key === 'gas.samples') {
      return [{ label: 'Send ETH', estimates: { low: { cost: { usd: 0.42 } } } }]
    }
    if (key === 'name') return 'Ethereum'
  }
}

class FeeMarketMonitorHarness extends MonitorHarness {
  store(...path) {
    const key = path.at(-1)
    if (key === 'gas.price.fees') {
      return { nextBaseFee: '0x3b9aca00', maxPriorityFeePerGas: '0x3b9aca00' }
    }
    return super.store(...path)
  }
}

test('renders account monitoring without background account-code requests or status badges', () => {
  render(
    <MonitorHarness address='0x690b9a9e9aa1c9db991c7721a92d351db4fac990' chainId={1} color='var(--good)' />
  )

  expect(link.rpc).not.toHaveBeenCalled()
  expect(screen.queryByText(/^RPC (?:Checking|Unknown|No Code|Contract|7702)$/)).toBeNull()
  expect(screen.getByText('gwei')).toBeTruthy()
})

test('shows one quiet fee-market summary with a single disclosure control', () => {
  render(<FeeMarketMonitorHarness chainId={1} color='var(--good)' />)

  expect(screen.getByRole('button', { name: 'Ethereum: 2 gwei. Show gas details.' })).toBeTruthy()
})

test('reveals fee tiers and action estimates with one click and no nested controls', () => {
  render(<MonitorHarness chainId={1} color='var(--good)' />)

  const disclosure = screen.getByRole('button', { name: 'Ethereum: 1 gwei. Show gas details.' })
  fireEvent.click(disclosure)

  expect(screen.getByText('Recommended gas price')).toBeTruthy()
  expect(screen.getByText('Send ETH')).toBeTruthy()
  expect(screen.getByLabelText('Estimated fees')).toBeTruthy()
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(disclosure.getAttribute('aria-expanded')).toBe('true')
})
