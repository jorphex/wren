import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from './quantity'

interface ReplacementData {
  nonce?: unknown
  gasPrice?: unknown
  maxFeePerGas?: unknown
  maxPriorityFeePerGas?: unknown
}

interface ReplacementRequest {
  mode?: string
  status?: string
  data?: ReplacementData
}

export type ReplacementFeeMarket = Readonly<{
  gasPrice?: unknown
  maxBaseFeePerGas?: unknown
  maxPriorityFeePerGas?: unknown
}>

export type ReplacementFees = Readonly<
  { gasPrice: string } | { maxFeePerGas: string; maxPriorityFeePerGas: string }
>

export type ReplacementStatus = {
  replacement: boolean
  possible: boolean
  reason?: 'nonce-used' | 'gas-price-too-low' | 'gas-fees-too-low'
}

export const increaseByTenPercent = (value: bigint) => (value * 11n + 9n) / 10n

export function minimumReplacementFee(value: bigint) {
  const increased = increaseByTenPercent(value)
  return increased > value ? increased : value + 1n
}

export const requiresReplacementFeeBump = (current: bigint, requested: bigint) =>
  requested < minimumReplacementFee(current)

export function maximumRpcQuantity<T>(values: readonly T[], getValue: (value: T) => unknown) {
  return values.reduce<bigint | undefined>((maximum, value) => {
    const quantity = parseRpcQuantity(getValue(value))
    if (quantity === undefined) return maximum
    return maximum === undefined || quantity > maximum ? quantity : maximum
  }, undefined)
}

export function getReplacementStatus(
  request: ReplacementRequest,
  requests: readonly ReplacementRequest[]
): ReplacementStatus {
  const status: ReplacementStatus = { replacement: false, possible: true }
  const nonce = request.data?.nonce
  if (request.mode === 'monitor' || !nonce) return status

  const existing = requests.filter(
    (candidate) =>
      candidate.mode === 'monitor' && candidate.status !== 'error' && candidate.data?.nonce === nonce
  )
  if (existing.length === 0) return status

  status.replacement = true
  if (existing.some((candidate) => candidate.status === 'confirming' || candidate.status === 'confirmed')) {
    return { replacement: true, possible: false, reason: 'nonce-used' }
  }

  if (request.data?.maxPriorityFeePerGas && request.data?.maxFeePerGas) {
    const requestedPriority = parseRpcQuantity(request.data.maxPriorityFeePerGas)
    const requestedMax = parseRpcQuantity(request.data.maxFeePerGas)
    if (requestedPriority === undefined || requestedMax === undefined || requestedMax < requestedPriority) {
      return status
    }

    const existingPriority = maximumRpcQuantity(existing, (candidate) => candidate.data?.maxPriorityFeePerGas)
    const existingMax = maximumRpcQuantity(existing, (candidate) => candidate.data?.maxFeePerGas)
    if (
      existingPriority !== undefined &&
      existingMax !== undefined &&
      existingMax >= existingPriority &&
      (requiresReplacementFeeBump(existingPriority, requestedPriority) ||
        requiresReplacementFeeBump(existingMax, requestedMax))
    ) {
      return { replacement: true, possible: false, reason: 'gas-fees-too-low' }
    }

    return status
  }

  const requestedPrice = parseRpcQuantity(request.data?.gasPrice)
  const existingPrice = maximumRpcQuantity(existing, (candidate) => candidate.data?.gasPrice)
  if (
    requestedPrice !== undefined &&
    existingPrice !== undefined &&
    requiresReplacementFeeBump(existingPrice, requestedPrice)
  ) {
    return { replacement: true, possible: false, reason: 'gas-price-too-low' }
  }

  return status
}

/**
 * Returns the least fee values that satisfy both the current wallet fee market and
 * the replacement minimum for every live same-nonce transaction known to Wren.
 * Callers still apply the normal transaction fee cap before signing.
 */
export function replacementFees(
  request: ReplacementRequest,
  requests: readonly ReplacementRequest[],
  market: ReplacementFeeMarket
): ReplacementFees {
  const nonce = request.data?.nonce
  if (typeof nonce !== 'string' || parseRpcQuantity(nonce) === undefined) {
    throw new Error('Original transaction has no valid nonce')
  }

  const existing = requests.filter(
    (candidate) =>
      candidate.mode === 'monitor' && candidate.status !== 'error' && candidate.data?.nonce === nonce
  )
  if (existing.length === 0) throw new Error('Original transaction is no longer replaceable')

  if (request.data?.maxPriorityFeePerGas !== undefined || request.data?.maxFeePerGas !== undefined) {
    const existingPriority = maximumRpcQuantity(existing, (candidate) => candidate.data?.maxPriorityFeePerGas)
    const existingMaximum = maximumRpcQuantity(existing, (candidate) => candidate.data?.maxFeePerGas)
    const currentPriority = parseRpcQuantity(market.maxPriorityFeePerGas)
    const currentBase = parseRpcQuantity(market.maxBaseFeePerGas)
    if (
      existingPriority === undefined ||
      existingMaximum === undefined ||
      existingMaximum < existingPriority ||
      currentPriority === undefined ||
      currentBase === undefined
    ) {
      throw new Error('Current EIP-1559 replacement fees are unavailable')
    }

    const priority = [minimumReplacementFee(existingPriority), currentPriority].reduce((a, b) =>
      a > b ? a : b
    )
    const maximum = [minimumReplacementFee(existingMaximum), currentBase + currentPriority, priority].reduce(
      (a, b) => (a > b ? a : b)
    )
    if (priority > MAX_UINT256 || maximum > MAX_UINT256) {
      throw new Error('Replacement fees exceed the transaction quantity limit')
    }
    return Object.freeze({
      maxFeePerGas: toRpcQuantity(maximum),
      maxPriorityFeePerGas: toRpcQuantity(priority)
    })
  }

  const existingPrice = maximumRpcQuantity(existing, (candidate) => candidate.data?.gasPrice)
  const currentPrice = parseRpcQuantity(market.gasPrice)
  if (existingPrice === undefined || currentPrice === undefined) {
    throw new Error('Current legacy replacement gas price is unavailable')
  }
  const minimumPrice = minimumReplacementFee(existingPrice)
  const gasPrice = minimumPrice > currentPrice ? minimumPrice : currentPrice
  if (gasPrice > MAX_UINT256) throw new Error('Replacement gas price exceeds the transaction quantity limit')
  return Object.freeze({ gasPrice: toRpcQuantity(gasPrice) })
}
