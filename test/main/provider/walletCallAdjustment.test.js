import { GasFeesSource } from '../../../resources/domain/transaction'
import { snapshotWalletCallBatchAdjustment } from '../../../main/provider/walletCallAdjustment'

const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'

const transaction = (overrides = {}) => ({
  from: account,
  chainId: '0x1',
  nonce: '0x5',
  type: '0x2',
  gasLimit: '0x5208',
  to: target,
  data: '0x',
  value: '0x0',
  maxFeePerGas: '0x10',
  maxPriorityFeePerGas: '0x1',
  gasFeesSource: GasFeesSource.Frame,
  ...overrides
})

const preparation = (transactions = [transaction(), transaction({ nonce: '0x6' })]) => ({
  calls: transactions.map((value) => ({ transaction: value, maxFee: '0x52080' })),
  maxFee: '0xa4100'
})

it('snapshots canonical contiguous EIP-1559 settings', () => {
  const adjustment = snapshotWalletCallBatchAdjustment(
    {
      startingNonce: '0x09'.replace('09', '9'),
      calls: [
        { gasLimit: '0x6000', maxFeePerGas: '0x20', maxPriorityFeePerGas: '0x2' },
        { gasLimit: '0x7000', maxFeePerGas: '0x30', maxPriorityFeePerGas: '0x3' }
      ]
    },
    preparation()
  )

  expect(adjustment).toEqual({
    startingNonce: '0x9',
    calls: [
      { gasLimit: '0x6000', maxFeePerGas: '0x20', maxPriorityFeePerGas: '0x2' },
      { gasLimit: '0x7000', maxFeePerGas: '0x30', maxPriorityFeePerGas: '0x3' }
    ]
  })
  expect(Object.isFrozen(adjustment)).toBe(true)
  expect(Object.isFrozen(adjustment.calls)).toBe(true)
  expect(adjustment.calls.every(Object.isFrozen)).toBe(true)
})

it('supports legacy fee settings only for legacy prepared transactions', () => {
  const legacy = transaction({
    type: '0x0',
    gasPrice: '0x10',
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined
  })
  expect(
    snapshotWalletCallBatchAdjustment(
      { startingNonce: '0x5', calls: [{ gasLimit: '0x6000', gasPrice: '0x20' }] },
      preparation([legacy])
    )
  ).toEqual({ startingNonce: '0x5', calls: [{ gasLimit: '0x6000', gasPrice: '0x20' }] })
})

it.each([
  [{ startingNonce: '0x5', calls: [] }, /does not match/],
  [
    { startingNonce: '0x5', calls: [{ gasLimit: '0x0', maxFeePerGas: '0x10', maxPriorityFeePerGas: '0x1' }] },
    /greater than zero/
  ],
  [
    { startingNonce: '0x5', calls: [{ gasLimit: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' }] },
    /EIP-1559/
  ],
  [
    {
      startingNonce: '0x5',
      calls: [{ gasLimit: '0x1', gasPrice: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' }]
    },
    /EIP-1559/
  ]
])('rejects invalid or mismatched adjustment evidence: %#', (value, message) => {
  expect(() => snapshotWalletCallBatchAdjustment(value, preparation([transaction()]))).toThrow(message)
})

it('enforces the existing Wren fee hard limit before mutation', () => {
  expect(() =>
    snapshotWalletCallBatchAdjustment(
      {
        startingNonce: '0x5',
        calls: [{ gasLimit: '0x1', maxFeePerGas: '0x1bc16d674ec80001', maxPriorityFeePerGas: '0x1' }]
      },
      preparation([transaction()])
    )
  ).toThrow(/hard limit/)
})
