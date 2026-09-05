import { render, screen } from '../../../componentSetup'
import FundingAmounts from '../../../../resources/Components/FundingAmounts'

it('reveals exact funding amounts on demand and removes them in privacy mode', async () => {
  const evidence = {
    available: '1000000000000000000',
    required: '1000004200290037760',
    missing: '4200290037760'
  }
  const { user, rerender } = render(<FundingAmounts evidence={evidence} decimals={18} symbol='ETH' />)
  await user.click(screen.getByText('Exact amounts'))
  expect(screen.getByText('1.00000420029003776 ETH')).toBeTruthy()
  expect(document.querySelectorAll('.fundingAmounts dd')).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: 'Exact amounts' }))
  expect(screen.queryByText('1.00000420029003776 ETH')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Exact amounts' }))
  rerender(<FundingAmounts evidence={evidence} decimals={18} symbol='ETH' hideBalances />)
  expect(screen.queryByText('Exact amounts')).toBeNull()
  expect(screen.queryByText('1.00000420029003776 ETH')).toBeNull()
  expect(screen.getAllByText('••••')).toHaveLength(3)
})
