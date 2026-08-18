import { parseRpcQuantity, toRpcQuantity } from '../transaction/quantity'

export type NativeMaxFeeEvidence =
  | Readonly<{
      feeModel: 'legacy'
      gasPrice: string
    }>
  | Readonly<{
      feeModel: 'eip1559'
      maxFeePerGas: string
      maxPriorityFeePerGas: string
    }>

export type NativeMaxEvidence = Readonly<{
  balance: string
  gasLimit: string
  l1Fee: string
  nonce: string
  fee: NativeMaxFeeEvidence
}>

export type NativeMaxReserve = Readonly<{
  feeModel: NativeMaxFeeEvidence['feeModel']
  gasLimit: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  executionFee: string
  l1Fee: string
  total: string
}>

export type NativeMaxCalculation = Readonly<{
  amount: string
  amountQuantity: string
  reserve: NativeMaxReserve
}>

function requiredQuantity(value: unknown, field: string, allowZero = true): bigint {
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined || (!allowZero && parsed === 0n)) {
    throw new Error(`Invalid native Max ${field}`)
  }
  return parsed
}

export function calculateNativeMax(evidence: NativeMaxEvidence): NativeMaxCalculation {
  const balance = requiredQuantity(evidence.balance, 'balance', false)
  const gasLimit = requiredQuantity(evidence.gasLimit, 'gas limit', false)
  const l1Fee = requiredQuantity(evidence.l1Fee, 'L1 fee')
  const feePerGas =
    evidence.fee.feeModel === 'legacy'
      ? requiredQuantity(evidence.fee.gasPrice, 'gas price', false)
      : requiredQuantity(evidence.fee.maxFeePerGas, 'maximum fee per gas', false)

  if (evidence.fee.feeModel === 'eip1559') {
    const priority = requiredQuantity(evidence.fee.maxPriorityFeePerGas, 'maximum priority fee per gas')
    if (priority > feePerGas) throw new Error('Invalid native Max EIP-1559 fee relationship')
  }

  const executionFee = gasLimit * feePerGas
  const total = executionFee + l1Fee
  if (executionFee > (1n << 256n) - 1n || total > (1n << 256n) - 1n) {
    throw new Error('Native Max fee reserve exceeds uint256')
  }
  if (balance <= total) throw new Error('Native Max leaves no positive amount')

  const amount = balance - total
  return {
    amount: amount.toString(10),
    amountQuantity: toRpcQuantity(amount),
    reserve: {
      feeModel: evidence.fee.feeModel,
      gasLimit: toRpcQuantity(gasLimit),
      ...(evidence.fee.feeModel === 'legacy'
        ? { gasPrice: toRpcQuantity(feePerGas) }
        : {
            maxFeePerGas: toRpcQuantity(feePerGas),
            maxPriorityFeePerGas: toRpcQuantity(
              requiredQuantity(evidence.fee.maxPriorityFeePerGas, 'maximum priority fee per gas')
            )
          }),
      executionFee: executionFee.toString(10),
      l1Fee: l1Fee.toString(10),
      total: total.toString(10)
    }
  }
}

export function sameNativeMaxEvidence(left: NativeMaxEvidence, right: NativeMaxEvidence): boolean {
  if (
    left.balance !== right.balance ||
    left.gasLimit !== right.gasLimit ||
    left.l1Fee !== right.l1Fee ||
    left.nonce !== right.nonce ||
    left.fee.feeModel !== right.fee.feeModel
  ) {
    return false
  }
  if (left.fee.feeModel === 'legacy' && right.fee.feeModel === 'legacy') {
    return left.fee.gasPrice === right.fee.gasPrice
  }
  if (left.fee.feeModel === 'eip1559' && right.fee.feeModel === 'eip1559') {
    return (
      left.fee.maxFeePerGas === right.fee.maxFeePerGas &&
      left.fee.maxPriorityFeePerGas === right.fee.maxPriorityFeePerGas
    )
  }
  return false
}
