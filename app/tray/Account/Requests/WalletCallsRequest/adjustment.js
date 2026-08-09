const INTEGER = /^(?:0|[1-9][0-9]*)$/
const GWEI = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/
const MAX_UINT256 = (1n << 256n) - 1n

const parseQuantity = (value) => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) return
  try {
    return BigInt(value)
  } catch {
    return
  }
}

const decimalToQuantity = (value) => {
  if (typeof value !== 'string' || !INTEGER.test(value)) return
  try {
    const parsed = BigInt(value)
    return parsed <= MAX_UINT256 ? `0x${parsed.toString(16)}` : undefined
  } catch {
    return
  }
}

const quantityToDecimal = (value) => parseQuantity(value)?.toString() || ''

const gweiToQuantity = (value) => {
  if (typeof value !== 'string' || !GWEI.test(value)) return
  const [whole, fraction = ''] = value.split('.')
  try {
    const parsed = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0')
    return parsed <= MAX_UINT256 ? `0x${parsed.toString(16)}` : undefined
  } catch {
    return
  }
}

const quantityToGwei = (value) => {
  const parsed = parseQuantity(value)
  if (parsed === undefined) return ''
  const whole = parsed / 1_000_000_000n
  const fraction = (parsed % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export const createWalletCallsDraft = (req) => {
  if (req?.preparation?.status !== 'succeeded' || !Array.isArray(req.preparation.calls)) return
  const firstNonce = req.preparation.calls[0]?.transaction?.nonce
  if (parseQuantity(firstNonce) === undefined) return

  const calls = req.preparation.calls.map(({ transaction }) => {
    const type = parseQuantity(transaction?.type)
    const gasLimit = quantityToDecimal(transaction?.gasLimit)
    if (!gasLimit || type === undefined) return
    if (type === 2n) {
      return {
        mode: 'eip1559',
        gasLimit,
        maxFeePerGas: quantityToGwei(transaction.maxFeePerGas),
        maxPriorityFeePerGas: quantityToGwei(transaction.maxPriorityFeePerGas)
      }
    }
    return { mode: 'legacy', gasLimit, gasPrice: quantityToGwei(transaction.gasPrice) }
  })
  if (calls.some((call) => !call)) return
  return { startingNonce: quantityToDecimal(firstNonce), calls }
}

export const parseWalletCallsDraft = (req, draft) => {
  if (
    !draft ||
    !Array.isArray(draft.calls) ||
    draft.calls.length === 0 ||
    draft.calls.length !== req?.calls?.length
  ) {
    return { valid: false, error: 'Fee settings do not match this batch.' }
  }

  const startingNonce = decimalToQuantity(draft.startingNonce)
  if (!startingNonce || BigInt(startingNonce) + BigInt(draft.calls.length - 1) > MAX_UINT256) {
    return { valid: false, error: 'Enter a valid starting nonce.' }
  }

  const calls = []
  for (const call of draft.calls) {
    const gasLimit = decimalToQuantity(call?.gasLimit)
    if (!gasLimit || BigInt(gasLimit) === 0n) {
      return { valid: false, error: 'Every gas limit must be greater than zero.' }
    }
    if (call.mode === 'eip1559') {
      const maxFeePerGas = gweiToQuantity(call.maxFeePerGas)
      const maxPriorityFeePerGas = gweiToQuantity(call.maxPriorityFeePerGas)
      if (!maxFeePerGas || !maxPriorityFeePerGas || BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) {
        return { valid: false, error: 'Priority fee cannot exceed the maximum fee.' }
      }
      calls.push({ gasLimit, maxFeePerGas, maxPriorityFeePerGas })
    } else if (call.mode === 'legacy') {
      const gasPrice = gweiToQuantity(call.gasPrice)
      if (!gasPrice) return { valid: false, error: 'Enter a valid gas price.' }
      calls.push({ gasLimit, gasPrice })
    } else {
      return { valid: false, error: 'Unsupported transaction fee model.' }
    }
  }

  return { valid: true, adjustment: { startingNonce, calls } }
}

export const walletCallMaximum = (call) => {
  const gasLimit = decimalToQuantity(call?.gasLimit)
  const fee = gweiToQuantity(call?.mode === 'eip1559' ? call.maxFeePerGas : call?.gasPrice)
  if (!gasLimit || !fee) return
  return BigInt(gasLimit) * BigInt(fee)
}

export const formatNativeMaximum = (value, decimals = 18, symbol = '') => {
  if (typeof value !== 'bigint' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return `? ${symbol}`.trim()
  }
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
  if (value > 0n && whole === 0n && !fraction && decimals > 0) {
    const precision = Math.min(decimals, 6)
    return `<0.${'0'.repeat(precision - 1)}1 ${symbol}`.trim()
  }
  return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`.trim()
}
