import { Interface } from 'ethers'

import { NATIVE_CURRENCY } from '../../../resources/constants'
import { buildSendTransaction, SEND_ERROR, SendValidationError } from '../../../main/send/transaction'

const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const token = '0x3333333333333333333333333333333333333333'

const nativeAsset = {
  address: NATIVE_CURRENCY,
  balance: '0xde0b6b3a7640000',
  chainId: 1,
  decimals: 18
}
const tokenAsset = {
  address: token,
  balance: '0x16e360',
  chainId: 8453,
  decimals: 6
}

const context = (asset = nativeAsset) => ({
  account,
  assets: [asset],
  networkAvailable: true,
  watchOnly: false
})

const draft = (overrides: Partial<Parameters<typeof buildSendTransaction>[0]> = {}) => ({
  account,
  amount: '0.25',
  assetAddress: NATIVE_CURRENCY,
  chainId: 1,
  recipient,
  ...overrides
})

function expectCode(operation: () => unknown, code: string) {
  try {
    operation()
    throw new Error('Expected validation error')
  } catch (error) {
    expect(error).toBeInstanceOf(SendValidationError)
    expect((error as SendValidationError).code).toBe(code)
  }
}

it('builds a native transfer for the currently selected account', () => {
  const result = buildSendTransaction(draft(), context())

  expect(result.amount).toBe(250000000000000000n)
  expect(result.transaction).toEqual({
    chainId: '0x1',
    from: account,
    to: recipient,
    value: '0x3782dace9d90000'
  })
})

it('builds ERC-20 transfer calldata and sends no native value', () => {
  const result = buildSendTransaction(
    draft({ amount: '1.25', assetAddress: token, chainId: 8453 }),
    context(tokenAsset)
  )
  const transfer = new Interface(['function transfer(address to,uint256 amount)']).decodeFunctionData(
    'transfer',
    result.transaction.data!
  )

  expect(result.amount).toBe(1250000n)
  expect(result.transaction).toEqual(
    expect.objectContaining({ chainId: '0x2105', from: account, to: token, value: '0x0' })
  )
  expect(transfer[0]).toBe(recipient)
  expect(transfer[1]).toBe(1250000n)
})

it('rejects an account switch before constructing the request', () => {
  expectCode(
    () =>
      buildSendTransaction(draft(), {
        ...context(),
        account: '0x4444444444444444444444444444444444444444'
      }),
    SEND_ERROR.AccountChanged
  )
})

it('rejects watch-only and disconnected account contexts', () => {
  expectCode(() => buildSendTransaction(draft(), { ...context(), watchOnly: true }), SEND_ERROR.WatchOnly)
  expectCode(
    () => buildSendTransaction(draft(), { ...context(), networkAvailable: false }),
    SEND_ERROR.NetworkUnavailable
  )
})

it('rejects unknown assets, invalid recipients, invalid amounts, zero, and overspend', () => {
  expectCode(
    () => buildSendTransaction(draft({ assetAddress: token }), context()),
    SEND_ERROR.AssetUnavailable
  )
  expectCode(
    () => buildSendTransaction(draft({ recipient: 'not an address' }), context()),
    SEND_ERROR.RecipientInvalid
  )
  expectCode(
    () => buildSendTransaction(draft({ amount: '1.2345678901234567891' }), context()),
    SEND_ERROR.AmountInvalid
  )
  expectCode(() => buildSendTransaction(draft({ amount: '0' }), context()), SEND_ERROR.AmountZero)
  expectCode(() => buildSendTransaction(draft({ amount: '2' }), context()), SEND_ERROR.AmountExceedsBalance)
})
