import { getAddress } from 'ethers'

import { NATIVE_CURRENCY } from '../../resources/constants'
import { erc20Interface } from '../../resources/contracts'
import { parseTokenBaseUnitAmount, parseTokenDecimalAmount } from '../../resources/domain/token/amount'
import { toRpcQuantity } from '../../resources/domain/transaction/quantity'

export const SEND_ERROR = Object.freeze({
  AccountChanged: 'account-changed',
  AmountExceedsBalance: 'amount-exceeds-balance',
  AmountInvalid: 'amount-invalid',
  AssetUnavailable: 'asset-unavailable',
  FeeUnavailable: 'fee-unavailable',
  MaxQuoteStale: 'max-quote-stale',
  MaxUnavailable: 'max-unavailable',
  NetworkUnavailable: 'network-unavailable',
  OriginUnavailable: 'origin-unavailable',
  RecipientInvalid: 'recipient-invalid',
  RecipientLookupUnavailable: 'recipient-lookup-unavailable',
  ValidationFailed: 'validation-failed',
  WatchOnly: 'watch-only'
} as const)

export type SendErrorCode = (typeof SEND_ERROR)[keyof typeof SEND_ERROR]

export class SendValidationError extends Error {
  constructor(readonly code: SendErrorCode) {
    super(code)
    this.name = 'SendValidationError'
  }
}

export type SendAsset = Readonly<{
  address: string
  balance: string
  chainId: number
  decimals: number
}>

export type SendDraft = Readonly<{
  account: string
  amount: string
  assetAddress: string
  chainId: number
  maxQuoteId?: string
  recipient: string
}>

export type SendTransaction = Readonly<{
  chainId: string
  data?: string
  from: string
  to: string
  value: string
}>

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

export function findSendAsset(assets: readonly SendAsset[], chainId: number, address: string) {
  return assets.find((asset) => asset.chainId === chainId && sameAddress(asset.address, address))
}

export function buildSendTransaction(
  draft: SendDraft,
  context: Readonly<{
    account: string
    assets: readonly SendAsset[]
    networkAvailable: boolean
    watchOnly: boolean
  }>
): { amount: bigint; asset: SendAsset; transaction: SendTransaction } {
  if (!sameAddress(draft.account, context.account)) {
    throw new SendValidationError(SEND_ERROR.AccountChanged)
  }
  if (context.watchOnly) throw new SendValidationError(SEND_ERROR.WatchOnly)
  if (!context.networkAvailable) throw new SendValidationError(SEND_ERROR.NetworkUnavailable)

  const asset = findSendAsset(context.assets, draft.chainId, draft.assetAddress)
  if (!asset) throw new SendValidationError(SEND_ERROR.AssetUnavailable)

  let recipient: string
  try {
    recipient = getAddress(draft.recipient)
  } catch {
    throw new SendValidationError(SEND_ERROR.RecipientInvalid)
  }

  const amount = parseTokenDecimalAmount(draft.amount, asset.decimals)
  if (amount === undefined) throw new SendValidationError(SEND_ERROR.AmountInvalid)

  const balance = parseTokenBaseUnitAmount(asset.balance)
  if (balance === undefined || amount > balance) {
    throw new SendValidationError(SEND_ERROR.AmountExceedsBalance)
  }

  const common = {
    chainId: toRpcQuantity(BigInt(draft.chainId)),
    from: getAddress(context.account),
    value: '0x0'
  }

  if (sameAddress(asset.address, NATIVE_CURRENCY)) {
    return {
      amount,
      asset,
      transaction: { ...common, to: recipient, value: toRpcQuantity(amount) }
    }
  }

  let tokenAddress: string
  try {
    tokenAddress = getAddress(asset.address)
  } catch {
    throw new SendValidationError(SEND_ERROR.AssetUnavailable)
  }

  return {
    amount,
    asset,
    transaction: {
      ...common,
      data: erc20Interface.encodeFunctionData('transfer', [recipient, amount]),
      to: tokenAddress
    }
  }
}
