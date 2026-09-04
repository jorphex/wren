export const MAX_UINT256 = (1n << 256n) - 1n

const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/

export function parseRpcQuantity(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || value.length > 66 || !quantityPattern.test(value)) return

  const quantity = BigInt(value)
  return quantity <= MAX_UINT256 ? quantity : undefined
}

export function toRpcQuantity(value: bigint): string {
  if (value < 0n || value > MAX_UINT256) throw new Error('RPC quantity exceeds uint256')
  return `0x${value.toString(16)}`
}

const transactionQuantityFields = [
  'nonce',
  'gasPrice',
  'gas',
  'gasLimit',
  'value',
  'chainId',
  'type',
  'maxPriorityFeePerGas',
  'maxFeePerGas'
] as const

function canonicalTransactionQuantity(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Invalid transaction ${field}`)
  }

  const digits = value.slice(2).replace(/^0+/, '') || '0'
  if (digits.length > 64) throw new Error(`Invalid transaction ${field}`)
  return `0x${digits.toLowerCase()}`
}

export function normalizeTransactionQuantities<T extends object>(transaction: T): T {
  const normalized = { ...transaction } as unknown as Record<string, unknown>
  transactionQuantityFields.forEach((field) => {
    if (normalized[field] !== undefined) {
      normalized[field] = canonicalTransactionQuantity(normalized[field], field)
    }
  })
  return normalized as unknown as T
}
