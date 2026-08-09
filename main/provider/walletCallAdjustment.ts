import type { TransactionData } from '../../resources/domain/transaction'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { maxFee } from '../transaction'
import type { PreparedWalletCallBatch } from './walletCallPreparation'

export interface WalletCallFeeAdjustment {
  gasLimit: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}

export interface WalletCallBatchAdjustment {
  startingNonce: string
  calls: readonly Readonly<WalletCallFeeAdjustment>[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function quantity(value: unknown, label: string) {
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined) throw new Error(`Invalid wallet-call ${label}`)
  return parsed
}

export function snapshotWalletCallBatchAdjustment(
  value: unknown,
  preparation: PreparedWalletCallBatch
): Readonly<WalletCallBatchAdjustment> {
  if (!isRecord(value) || !Array.isArray(value['calls']) || !Array.isArray(preparation?.calls)) {
    throw new Error('Invalid wallet-call adjustment')
  }
  if (value['calls'].length !== preparation.calls.length || value['calls'].length === 0) {
    throw new Error('Wallet-call adjustment does not match prepared transactions')
  }

  const startingNonce = quantity(value['startingNonce'], 'starting nonce')
  if (startingNonce + BigInt(value['calls'].length - 1) > MAX_UINT256) {
    throw new Error('Wallet-call nonce range exceeds uint256')
  }

  let aggregateMaximum = 0n
  const calls = value['calls'].map((candidate, index) => {
    const prepared = preparation.calls[index]
    if (!prepared || !isRecord(candidate)) throw new Error('Invalid wallet-call fee adjustment')

    const transaction = prepared.transaction as Readonly<TransactionData>
    const type = quantity(transaction.type, 'transaction type')
    const gasLimit = quantity(candidate['gasLimit'], 'gas limit')
    if (gasLimit === 0n) throw new Error('Wallet-call gas limit must be greater than zero')

    let feePerGas: bigint
    let adjustment: WalletCallFeeAdjustment
    if (type === 2n) {
      const maxFeePerGas = quantity(candidate['maxFeePerGas'], 'maximum fee')
      const maxPriorityFeePerGas = quantity(candidate['maxPriorityFeePerGas'], 'priority fee')
      if (maxPriorityFeePerGas > maxFeePerGas || candidate['gasPrice'] !== undefined) {
        throw new Error('Invalid EIP-1559 wallet-call fees')
      }
      feePerGas = maxFeePerGas
      adjustment = {
        gasLimit: toRpcQuantity(gasLimit),
        maxFeePerGas: toRpcQuantity(maxFeePerGas),
        maxPriorityFeePerGas: toRpcQuantity(maxPriorityFeePerGas)
      }
    } else {
      const gasPrice = quantity(candidate['gasPrice'], 'gas price')
      if (candidate['maxFeePerGas'] !== undefined || candidate['maxPriorityFeePerGas'] !== undefined) {
        throw new Error('Invalid legacy wallet-call fees')
      }
      feePerGas = gasPrice
      adjustment = { gasLimit: toRpcQuantity(gasLimit), gasPrice: toRpcQuantity(gasPrice) }
    }

    const maximum = gasLimit * feePerGas
    if (maximum > maxFee(transaction)) {
      throw new Error('Wallet-call transaction fee exceeds Wren hard limit')
    }
    aggregateMaximum += maximum
    if (aggregateMaximum > maxFee(transaction)) {
      throw new Error('Wallet-call batch fee exceeds Wren hard limit')
    }

    return Object.freeze(adjustment)
  })

  return Object.freeze({
    startingNonce: toRpcQuantity(startingNonce),
    calls: Object.freeze(calls)
  })
}
