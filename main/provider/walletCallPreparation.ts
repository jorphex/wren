import { GasFeesSource, type TransactionData } from '../../resources/domain/transaction'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { maxFee } from '../transaction'
import type { WalletCallBatchAdjustment, WalletCallFeeAdjustment } from './walletCallAdjustment'
import { snapshotWalletCalls } from './walletCallExecution'
import type { WalletCall } from './walletCalls'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const MAX_ERROR_MESSAGE_LENGTH = 240
const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER)

export interface WalletCallPreparationInput {
  account: string
  chainId: string
  pendingNonce: string
  calls: readonly WalletCall[]
  adjustment?: Readonly<WalletCallBatchAdjustment>
}

export interface FilledWalletCallTransaction {
  tx: TransactionData
  approvals: readonly unknown[]
}

interface WalletCallPreparationDependencies {
  fillTransaction(
    transaction: Readonly<{
      from: string
      chainId: string
      nonce: string
      to?: string
      data: string
      value: string
      gasLimit?: string
      gasPrice?: string
      maxFeePerGas?: string
      maxPriorityFeePerGas?: string
    }>,
    index: number
  ): Promise<FilledWalletCallTransaction>
}

export interface PreparedWalletCall {
  transaction: Readonly<TransactionData>
  maxFee: string
}

export interface PreparedWalletCallBatch {
  calls: readonly Readonly<PreparedWalletCall>[]
  maxFee: string
}

function boundedError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
  return new Error((message.trim() || fallback).slice(0, MAX_ERROR_MESSAGE_LENGTH))
}

function snapshotInput(input: WalletCallPreparationInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid wallet call preparation input')
  }
  if (typeof input.account !== 'string' || !ADDRESS.test(input.account)) {
    throw new Error('Invalid wallet call preparation account')
  }

  const chainId = parseRpcQuantity(input.chainId)
  const pendingNonce = parseRpcQuantity(input.adjustment?.startingNonce ?? input.pendingNonce)
  if (chainId === undefined || chainId === 0n || chainId > MAX_SAFE_CHAIN_ID) {
    throw new Error('Invalid wallet call preparation chain')
  }
  if (pendingNonce === undefined) throw new Error('Invalid wallet call preparation nonce')

  const calls = snapshotWalletCalls(input.calls)
  if (pendingNonce + BigInt(calls.length - 1) > MAX_UINT256) {
    throw new Error('Wallet call nonce range exceeds uint256')
  }

  let feeAdjustments: readonly Readonly<WalletCallFeeAdjustment>[] | undefined
  if (input.adjustment !== undefined) {
    if (!Array.isArray(input.adjustment.calls) || input.adjustment.calls.length !== calls.length) {
      throw new Error('Wallet call fee adjustment does not match calls')
    }
    feeAdjustments = Object.freeze(
      input.adjustment.calls.map((adjustment) => {
        const gasLimit = parseRpcQuantity(adjustment?.gasLimit)
        const gasPrice = parseRpcQuantity(adjustment?.gasPrice)
        const maxFeePerGas = parseRpcQuantity(adjustment?.maxFeePerGas)
        const maxPriorityFeePerGas = parseRpcQuantity(adjustment?.maxPriorityFeePerGas)
        const legacy =
          gasPrice !== undefined && maxFeePerGas === undefined && maxPriorityFeePerGas === undefined
        const baseFee =
          gasPrice === undefined && maxFeePerGas !== undefined && maxPriorityFeePerGas !== undefined
        if (
          gasLimit === undefined ||
          gasLimit === 0n ||
          (!legacy && !baseFee) ||
          (baseFee && (maxPriorityFeePerGas as bigint) > (maxFeePerGas as bigint))
        ) {
          throw new Error('Invalid wallet call fee adjustment')
        }
        return Object.freeze({
          gasLimit: toRpcQuantity(gasLimit),
          ...(legacy
            ? { gasPrice: toRpcQuantity(gasPrice as bigint) }
            : {
                maxFeePerGas: toRpcQuantity(maxFeePerGas as bigint),
                maxPriorityFeePerGas: toRpcQuantity(maxPriorityFeePerGas as bigint)
              })
        })
      })
    )
  }

  return Object.freeze({
    account: input.account.toLowerCase(),
    chainId: toRpcQuantity(chainId),
    pendingNonce,
    calls: Object.freeze(calls),
    feeAdjustments
  })
}

function prepareFilledTransaction(
  filled: FilledWalletCallTransaction,
  intent: Readonly<{
    from: string
    chainId: string
    nonce: string
    to?: string
    data: string
    value: string
  }>,
  feeAdjustment?: Readonly<WalletCallFeeAdjustment>
) {
  if (!filled || typeof filled !== 'object' || Array.isArray(filled)) {
    throw new Error('Transaction preparation returned invalid metadata')
  }
  if (!Array.isArray(filled.approvals)) {
    throw new Error('Transaction preparation returned invalid approvals')
  }
  if (filled.approvals.length > 0) {
    throw new Error('Wallet call requires an unsupported transaction approval')
  }

  const tx = filled.tx
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
    throw new Error('Transaction preparation returned invalid transaction data')
  }

  const from = typeof tx.from === 'string' && ADDRESS.test(tx.from) ? tx.from.toLowerCase() : ''
  const to = typeof tx.to === 'string' && ADDRESS.test(tx.to) ? tx.to.toLowerCase() : undefined
  const chainId = parseRpcQuantity(tx.chainId)
  const nonce = parseRpcQuantity(tx.nonce)
  const value = parseRpcQuantity(tx.value)
  const gasLimit = parseRpcQuantity(tx.gasLimit)
  const type = parseRpcQuantity(tx.type)

  if (
    from !== intent.from ||
    chainId === undefined ||
    toRpcQuantity(chainId) !== intent.chainId ||
    nonce === undefined ||
    toRpcQuantity(nonce) !== intent.nonce ||
    value === undefined ||
    toRpcQuantity(value) !== intent.value ||
    (intent.to ? to !== intent.to : tx.to !== undefined) ||
    tx.data !== intent.data ||
    gasLimit === undefined ||
    gasLimit === 0n ||
    type === undefined ||
    type > 2n ||
    tx.accessList !== undefined
  ) {
    throw new Error('Prepared transaction does not match the approved wallet call')
  }

  if (tx.gasFeesSource !== GasFeesSource.Dapp && tx.gasFeesSource !== GasFeesSource.Frame) {
    throw new Error('Prepared transaction has an invalid gas fee source')
  }

  const baseFeeTransaction = type === 2n
  const feePerGas = parseRpcQuantity(baseFeeTransaction ? tx.maxFeePerGas : tx.gasPrice)
  const priorityFee = baseFeeTransaction ? parseRpcQuantity(tx.maxPriorityFeePerGas) : 0n
  if (
    feePerGas === undefined ||
    priorityFee === undefined ||
    priorityFee > feePerGas ||
    (baseFeeTransaction
      ? tx.gasPrice !== undefined
      : tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined) ||
    tx.v !== undefined ||
    tx.r !== undefined ||
    tx.s !== undefined
  ) {
    throw new Error('Prepared transaction has invalid gas fees')
  }

  if (feeAdjustment) {
    const expectedGasLimit = parseRpcQuantity(feeAdjustment.gasLimit)
    const expectedGasPrice = parseRpcQuantity(feeAdjustment.gasPrice)
    const expectedMaxFeePerGas = parseRpcQuantity(feeAdjustment.maxFeePerGas)
    const expectedPriorityFee = parseRpcQuantity(feeAdjustment.maxPriorityFeePerGas)
    const expectedBaseFee =
      expectedGasPrice === undefined &&
      expectedMaxFeePerGas !== undefined &&
      expectedPriorityFee !== undefined
    const feesMatch = expectedBaseFee
      ? baseFeeTransaction && feePerGas === expectedMaxFeePerGas && priorityFee === expectedPriorityFee
      : !baseFeeTransaction && feePerGas === expectedGasPrice
    if (gasLimit !== expectedGasLimit || !feesMatch || tx.gasFeesSource !== GasFeesSource.Dapp) {
      throw new Error('Prepared transaction changed the adjusted wallet-call fees')
    }
  }

  const transaction = Object.freeze({
    from,
    chainId: intent.chainId,
    nonce: intent.nonce,
    type: toRpcQuantity(type),
    gasLimit: toRpcQuantity(gasLimit),
    ...(intent.to ? { to: intent.to } : {}),
    data: intent.data,
    value: intent.value,
    ...(baseFeeTransaction
      ? {
          maxFeePerGas: toRpcQuantity(feePerGas),
          maxPriorityFeePerGas: toRpcQuantity(priorityFee)
        }
      : { gasPrice: toRpcQuantity(feePerGas) }),
    gasFeesSource: tx.gasFeesSource
  }) as Readonly<TransactionData>

  const transactionMaxFee = gasLimit * feePerGas
  if (transactionMaxFee > maxFee(transaction)) {
    throw new Error('Wallet call maximum fee exceeds Wren hard limit')
  }

  return Object.freeze({ transaction, maxFee: transactionMaxFee })
}

export async function prepareWalletCallBatch(
  input: WalletCallPreparationInput,
  dependencies: WalletCallPreparationDependencies
): Promise<PreparedWalletCallBatch> {
  try {
    const snapshot = snapshotInput(input)
    const prepared: Array<Readonly<{ transaction: Readonly<TransactionData>; maxFee: bigint }>> = []
    let aggregateMaxFee = 0n

    for (let index = 0; index < snapshot.calls.length; index += 1) {
      const call = snapshot.calls[index]
      if (!call) throw new Error('Wallet call is missing during preparation')
      const intent = Object.freeze({
        from: snapshot.account,
        chainId: snapshot.chainId,
        nonce: toRpcQuantity(snapshot.pendingNonce + BigInt(index)),
        ...(call.to ? { to: call.to } : {}),
        data: call.data,
        value: call.value
      })
      const filled = await dependencies.fillTransaction(
        Object.freeze({ ...intent, ...(snapshot.feeAdjustments?.[index] || {}) }),
        index
      )
      const preparedCall = prepareFilledTransaction(filled, intent, snapshot.feeAdjustments?.[index])
      aggregateMaxFee += preparedCall.maxFee
      if (aggregateMaxFee > maxFee(preparedCall.transaction)) {
        throw new Error('Wallet call batch maximum fee exceeds Wren hard limit')
      }
      prepared.push(preparedCall)
    }

    return Object.freeze({
      calls: Object.freeze(
        prepared.map((call) =>
          Object.freeze({ transaction: call.transaction, maxFee: toRpcQuantity(call.maxFee) })
        )
      ),
      maxFee: toRpcQuantity(aggregateMaxFee)
    })
  } catch (error) {
    throw boundedError(error, 'Wallet call preparation failed')
  }
}
