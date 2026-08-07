import { fireEvent, render, screen } from '../../../componentSetup'

import link from '../../../../resources/link'
import { ChainSummaryComponent } from '../../../../resources/Components/Monitor'

jest.mock('../../../../resources/link', () => ({ rpc: jest.fn(), send: jest.fn() }))

class MonitorHarness extends ChainSummaryComponent {
  store(...path) {
    const key = path.at(-1)
    if (key === 'gas.price.levels') return { fast: '0x0' }
    if (key === 'gas.samples') return []
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

test('opens gas explanations for keyboard focus and closes them on blur', () => {
  render(<FeeMarketMonitorHarness chainId={1} color='var(--good)' />)
  fireEvent.click(screen.getByRole('button', { name: 'Expand gas details' }))
  const baseFeeButton = screen.getByRole('button', { name: 'Explain current base fee' })

  fireEvent.focus(baseFeeButton)
  expect(screen.getByText(/current base fee is added with a buffer/)).toBeTruthy()

  fireEvent.blur(baseFeeButton)
  expect(screen.queryByText(/current base fee is added with a buffer/)).toBeNull()
})

test('exposes and toggles gas disclosure state with the keyboard', async () => {
  const { user } = render(<MonitorHarness chainId={1} color='var(--good)' />)
  const disclosure = screen.getByRole('button', { name: 'Expand gas details' })

  expect(disclosure.getAttribute('aria-expanded')).toBe('false')
  disclosure.focus()
  await user.keyboard(' ')

  expect(screen.getByRole('button', { name: 'Collapse gas details' })).toBeTruthy()
})
