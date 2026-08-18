import type { TransactionData } from '.'
import { usesBaseFee } from '.'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from './quantity'

export const TRANSACTION_FUNDING_ERROR = 'transaction-funding-insufficient' as const
export const TRANSACTION_FUNDING_UNAVAILABLE = 'transaction-funding-unavailable' as const
export const WALLET_CALL_FUNDING_ERROR = 'wallet-call-funding-insufficient' as const
export const WALLET_CALL_FUNDING_UNAVAILABLE = 'wallet-call-funding-unavailable' as const

export type TransactionFundingEvidence = Readonly<{
  available: string
  required: string
  missing: string
  value: string
  maximumFee: string
}>

export class TransactionFundingError extends Error {
  readonly code: typeof TRANSACTION_FUNDING_ERROR | typeof TRANSACTION_FUNDING_UNAVAILABLE
  readonly data: TransactionFundingEvidence | undefined

  constructor(
    code: typeof TRANSACTION_FUNDING_ERROR | typeof TRANSACTION_FUNDING_UNAVAILABLE,
    message: string,
    data?: TransactionFundingEvidence
  ) {
    super(message)
    this.code = code
    this.data = data
  }
}

export class WalletCallFundingError extends Error {
  readonly code: typeof WALLET_CALL_FUNDING_ERROR | typeof WALLET_CALL_FUNDING_UNAVAILABLE
  readonly data: TransactionFundingEvidence | undefined

  constructor(
    code: typeof WALLET_CALL_FUNDING_ERROR | typeof WALLET_CALL_FUNDING_UNAVAILABLE,
    message: string,
    data?: TransactionFundingEvidence
  ) {
    super(message)
    this.code = code
    this.data = data
  }
}

export const isTransactionFundingError = (error: unknown): error is TransactionFundingError =>
  error instanceof TransactionFundingError ||
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === TRANSACTION_FUNDING_ERROR || error.code === TRANSACTION_FUNDING_UNAVAILABLE))

export const isWalletCallFundingError = (error: unknown): error is WalletCallFundingError =>
  error instanceof WalletCallFundingError ||
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === WALLET_CALL_FUNDING_ERROR || error.code === WALLET_CALL_FUNDING_UNAVAILABLE))

export function transactionFundingEvidence(
  transaction: TransactionData,
  availableValue: unknown,
  l1FeeValue: unknown = '0x0'
): TransactionFundingEvidence {
  const available = parseRpcQuantity(availableValue)
  const value = parseRpcQuantity(transaction.value ?? '0x0')
  const gasLimit = parseRpcQuantity(transaction.gasLimit)
  const feePerGas = parseRpcQuantity(
    usesBaseFee(transaction) ? transaction.maxFeePerGas : transaction.gasPrice
  )
  const priorityFee = usesBaseFee(transaction) ? parseRpcQuantity(transaction.maxPriorityFeePerGas) : 0n
  const l1Fee = parseRpcQuantity(l1FeeValue)

  if (
    available === undefined ||
    value === undefined ||
    gasLimit === undefined ||
    feePerGas === undefined ||
    priorityFee === undefined ||
    priorityFee > feePerGas ||
    l1Fee === undefined
  ) {
    throw new TransactionFundingError(
      TRANSACTION_FUNDING_UNAVAILABLE,
      'The transaction funding requirement could not be verified. Nothing was signed or sent.'
    )
  }

  const maximumFee = gasLimit * feePerGas + l1Fee
  const required = value + maximumFee
  if (maximumFee > MAX_UINT256 || required > MAX_UINT256) {
    throw new TransactionFundingError(
      TRANSACTION_FUNDING_UNAVAILABLE,
      'The transaction funding requirement exceeds the supported quantity range. Nothing was signed or sent.'
    )
  }
  const missing = required > available ? required - available : 0n
  return Object.freeze({
    available: toRpcQuantity(available),
    required: toRpcQuantity(required),
    missing: toRpcQuantity(missing),
    value: toRpcQuantity(value),
    maximumFee: toRpcQuantity(maximumFee)
  })
}

export function assertTransactionFunding(
  transaction: TransactionData,
  available: unknown,
  l1Fee: unknown = '0x0'
) {
  const evidence = transactionFundingEvidence(transaction, available, l1Fee)
  if (evidence.missing !== '0x0') {
    throw new TransactionFundingError(
      TRANSACTION_FUNDING_ERROR,
      'The selected account cannot cover this transaction and its maximum fee. Nothing was signed or sent.',
      evidence
    )
  }
  return evidence
}

export function walletCallFundingEvidence(
  transactions: readonly TransactionData[],
  availableValue: unknown,
  l1FeeValues: readonly unknown[] = []
): TransactionFundingEvidence {
  const available = parseRpcQuantity(availableValue)
  if (
    available === undefined ||
    transactions.length < 1 ||
    transactions.length > 16 ||
    (l1FeeValues.length !== 0 && l1FeeValues.length !== transactions.length)
  ) {
    throw new WalletCallFundingError(
      WALLET_CALL_FUNDING_UNAVAILABLE,
      'The wallet-call funding requirement could not be verified. Nothing was signed or sent.'
    )
  }

  let value = 0n
  let maximumFee = 0n
  for (let index = 0; index < transactions.length; index += 1) {
    let evidence: TransactionFundingEvidence
    try {
      evidence = transactionFundingEvidence(
        transactions[index] as TransactionData,
        availableValue,
        l1FeeValues.length === 0 ? '0x0' : l1FeeValues[index]
      )
    } catch {
      throw new WalletCallFundingError(
        WALLET_CALL_FUNDING_UNAVAILABLE,
        'The wallet-call funding requirement could not be verified. Nothing was signed or sent.'
      )
    }
    value += parseRpcQuantity(evidence.value) as bigint
    maximumFee += parseRpcQuantity(evidence.maximumFee) as bigint
    if (value > MAX_UINT256 || maximumFee > MAX_UINT256 || value + maximumFee > MAX_UINT256) {
      throw new WalletCallFundingError(
        WALLET_CALL_FUNDING_UNAVAILABLE,
        'The wallet-call funding requirement exceeds the supported quantity range. Nothing was signed or sent.'
      )
    }
  }

  const required = value + maximumFee
  const missing = required > available ? required - available : 0n
  return Object.freeze({
    available: toRpcQuantity(available),
    required: toRpcQuantity(required),
    missing: toRpcQuantity(missing),
    value: toRpcQuantity(value),
    maximumFee: toRpcQuantity(maximumFee)
  })
}

export function assertWalletCallFunding(
  transactions: readonly TransactionData[],
  available: unknown,
  l1Fees: readonly unknown[] = []
) {
  const evidence = walletCallFundingEvidence(transactions, available, l1Fees)
  if (evidence.missing !== '0x0') {
    throw new WalletCallFundingError(
      WALLET_CALL_FUNDING_ERROR,
      'The selected account cannot cover this wallet-call batch and its maximum fees. Nothing was signed or sent.',
      evidence
    )
  }
  return evidence
}
