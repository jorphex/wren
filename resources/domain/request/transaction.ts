import { addHexPrefix, isHexString } from '@ethereumjs/util'

function parseChainId(chainId: string) {
  return isHexString(chainId) ? parseInt(chainId, 16) : Number(chainId)
}

export function normalizeTransactionChainId(tx: RPC.SendTransaction.TxParams, targetChain?: number) {
  if (!tx.chainId) return tx

  const chainId = parseChainId(tx.chainId)
  if (!chainId) {
    throw new Error(`Chain for transaction (${tx.chainId}) is not a hex-prefixed string`)
  }
  if (targetChain && targetChain !== chainId) {
    throw new Error(
      `Chain for transaction (${tx.chainId}) does not match request target chain (${targetChain})`
    )
  }

  return { ...tx, chainId: addHexPrefix(chainId.toString(16)) }
}
