import BigNumber from 'bignumber.js'
import { formatTokenBaseUnitAmount } from './amount'

// Presentation only: callers retain the exact quantity for transaction evidence.
export const tokenAmountPresentation = (value, decimals = 18, symbol = '', rounding = 'up') => {
  const exactAmount = formatTokenBaseUnitAmount(String(value ?? ''), decimals)
  if (exactAmount === undefined) return { display: 'Unavailable', exact: 'Unavailable' }
  const amount = BigNumber(exactAmount)
  const rounded = amount.precision(6, rounding === 'down' ? BigNumber.ROUND_DOWN : BigNumber.ROUND_UP)
  const approximate = !rounded.eq(amount)
  return {
    display: `${approximate ? '≈ ' : ''}${rounded.toFormat()} ${symbol}`.trim(),
    exact: `${exactAmount} ${symbol}`.trim()
  }
}
