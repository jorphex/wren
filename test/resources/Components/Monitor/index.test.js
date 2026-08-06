import { fireEvent, render, screen } from '@testing-library/react'

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
  fireEvent.click(screen.getByText('gwei'))
  const baseFeeButton = screen.getByRole('button', { name: 'Explain current base fee' })

  fireEvent.focus(baseFeeButton)
  expect(screen.getByText(/current base fee is added with a buffer/)).toBeTruthy()

  fireEvent.blur(baseFeeButton)
  expect(screen.queryByText(/current base fee is added with a buffer/)).toBeNull()
})
