import {
  assertTransactionFunding,
  transactionFundingEvidence,
  TRANSACTION_FUNDING_ERROR,
  TRANSACTION_FUNDING_UNAVAILABLE
} from '../../../../resources/domain/transaction/funding'
import { GasFeesSource, type TransactionData } from '../../../../resources/domain/transaction'

const transaction = (overrides: Partial<TransactionData> = {}): TransactionData => ({
  chainId: '0x1',
  type: '0x2',
  value: '0x64',
  gasLimit: '0xa',
  maxFeePerGas: '0x3',
  maxPriorityFeePerGas: '0x1',
  gasFeesSource: GasFeesSource.Frame,
  ...overrides
})

it('calculates value plus worst-case EIP-1559 and L1 data fees', () => {
  expect(transactionFundingEvidence(transaction(), '0x96', '0x5')).toEqual({
    available: '0x96',
    required: '0x87',
    missing: '0x0',
    value: '0x64',
    maximumFee: '0x23'
  })
})

it('calculates a legacy transaction shortfall without rounding', () => {
  expect(() =>
    assertTransactionFunding(transaction({ type: '0x0', gasPrice: '0x4', maxFeePerGas: undefined }), '0x7d')
  ).toThrow(
    expect.objectContaining({
      code: TRANSACTION_FUNDING_ERROR,
      data: expect.objectContaining({ available: '0x7d', required: '0x8c', missing: '0xf' })
    })
  )
})

it.each([
  ['missing gas limit', transaction({ gasLimit: undefined })],
  ['malformed balance', transaction()],
  ['priority above maximum', transaction({ maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' })]
])('fails closed for %s', (_label, tx) => {
  const balance = _label === 'malformed balance' ? '12' : '0x100'
  expect(() => assertTransactionFunding(tx, balance)).toThrow(
    expect.objectContaining({ code: TRANSACTION_FUNDING_UNAVAILABLE })
  )
})
