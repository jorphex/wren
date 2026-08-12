const UNSAFE_FORWARDING_PREFIXES = ['account_', 'admin_', 'engine_', 'miner_', 'personal_', 'wallet_']

// Geth's debug namespace also contains destructive and file-writing methods.
const SAFE_DEBUG_METHODS = new Set([
  'debug_getBadBlocks',
  'debug_getRawBlock',
  'debug_getRawBlockAccessList',
  'debug_getRawHeader',
  'debug_getRawReceipts',
  'debug_getRawTransaction',
  'debug_traceBlock',
  'debug_traceBlockByHash',
  'debug_traceBlockByNumber',
  'debug_traceCall',
  'debug_traceChain',
  'debug_traceTransaction'
])

export function isUnsafeRpcForwardingMethod(method: string) {
  if (method.startsWith('debug_')) return !SAFE_DEBUG_METHODS.has(method)

  return (
    method.startsWith('eth_sign') || UNSAFE_FORWARDING_PREFIXES.some((prefix) => method.startsWith(prefix))
  )
}

export function unsupportedRawTransactionFamily(payload: RPCRequestPayload) {
  if (payload.method !== 'eth_sendRawTransaction' || !Array.isArray(payload.params)) return
  const rawTransaction = payload.params[0]
  if (typeof rawTransaction !== 'string') return

  const type = rawTransaction.slice(0, 4).toLowerCase()
  if (type === '0x03') return 'EIP-4844 type-3 transactions'
  if (type === '0x04') return 'EIP-7702 authorization transactions'
  return
}
