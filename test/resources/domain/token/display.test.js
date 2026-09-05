import { tokenAmountPresentation } from '../../../../resources/domain/token/display'

it('rounds required funds up and available funds down while preserving exact evidence', () => {
  expect(tokenAmountPresentation('1000004200290037760', 18, 'ETH')).toEqual({
    display: '≈ 1.00001 ETH',
    exact: '1.00000420029003776 ETH'
  })
  expect(tokenAmountPresentation('1000004200290037760', 18, 'ETH', 'down').display).toBe('≈ 1 ETH')
})
it('keeps tiny positive values, whole tokens and unavailable values distinct', () => {
  expect(tokenAmountPresentation('1', 18, 'ETH').display).toBe('0.000000000000000001 ETH')
  expect(tokenAmountPresentation('42000000', 6, 'USDC').display).toBe('42 USDC')
  expect(tokenAmountPresentation(undefined, 18, 'ETH').display).toBe('Unavailable')
})
