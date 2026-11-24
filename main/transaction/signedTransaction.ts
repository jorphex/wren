import { Capability, TransactionFactory } from '@ethereumjs/tx'

import type { TransactionData } from '../../resources/domain/transaction'
import { normalizeTransactionQuantities } from '../../resources/domain/transaction/quantity'
import chainConfig from '../chains/config'

export function transactionSigningIntent(transaction: Readonly<TransactionData>) {
  const normalized = normalizeTransactionQuantities(transaction)
  const chainId = Number(normalized.chainId)
  const type = Number(normalized.type)
  if (
    !normalized.from ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    (type !== 0 && type !== 1 && type !== 2) ||
    (type === 0 && normalized.accessList !== undefined) ||
    normalized.v !== undefined ||
    normalized.r !== undefined ||
    normalized.s !== undefined
  ) {
    throw new Error('Invalid authorized transaction')
  }

  const common = chainConfig(chainId, type === 2 ? 'london' : 'berlin')
  const unsigned = TransactionFactory.fromTxData(normalized, { common })
  // Commit to the canonical signing preimage, including the access list in order.
  return Object.freeze({
    from: normalized.from.toLowerCase(),
    chainId,
    type,
    digest: unsigned.getMessageToSign().toString('hex')
  })
}

export function verifySignedTransaction(
  rawTransaction: unknown,
  intent: ReturnType<typeof transactionSigningIntent>
) {
  if (
    typeof rawTransaction !== 'string' ||
    rawTransaction.length % 2 !== 0 ||
    !/^0x[0-9a-fA-F]+$/.test(rawTransaction)
  ) {
    throw new Error('Invalid signed transaction bytes')
  }

  const common = chainConfig(intent.chainId, intent.type === 2 ? 'london' : 'berlin')
  const bytes = Buffer.from(rawTransaction.slice(2), 'hex')
  const signed = TransactionFactory.fromSerializedData(bytes, { common })
  if (
    !signed.isSigned() ||
    signed.type !== intent.type ||
    signed.common.chainId() !== BigInt(intent.chainId) ||
    (signed.type === 0 && !signed.supports(Capability.EIP155ReplayProtection)) ||
    signed.getMessageToVerifySignature().toString('hex') !== intent.digest ||
    signed.getSenderAddress().toString().toLowerCase() !== intent.from ||
    !signed.serialize().equals(bytes)
  ) {
    throw new Error('Signed transaction does not match authorized transaction')
  }

  return rawTransaction
}
