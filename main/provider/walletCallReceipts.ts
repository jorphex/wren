import { WalletCallReceiptSchema, type WalletCallReceipt } from '../store/state/types/walletCallBatch'
import type { WalletCallTransactionCandidate } from './walletCallBatches'
import {
  MAX_SUBMITTED_TRANSACTION_CANDIDATES,
  snapshotWalletCallCandidate,
  snapshotWalletCallCandidateQueue,
  walletCallDiagnostic
} from './walletCallEvidence'

interface WalletCallReceiptLedger {
  recordReceipt(origin: string, account: string, id: string, receipt: WalletCallReceipt): void
}

interface WalletCallReceiptDependencies {
  ledger: WalletCallReceiptLedger
  getTransactionReceipt(chainId: string, hash: string): Promise<unknown>
}

export interface WalletCallReceiptOutcome {
  status: 'receipt-recorded' | 'pending' | 'error'
  reason?: string
}

function receiptEvidence(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const receipt = value as Record<string, unknown>
  const logs = Array.isArray(receipt['logs'])
    ? receipt['logs'].map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value
        const log = value as Record<string, unknown>
        return { address: log['address'], data: log['data'], topics: log['topics'] }
      })
    : receipt['logs']
  return {
    logs,
    status: receipt['status'],
    ...(receipt['type'] !== undefined ? { type: receipt['type'] } : {}),
    blockHash: receipt['blockHash'],
    blockNumber: receipt['blockNumber'],
    gasUsed: receipt['gasUsed'],
    ...(receipt['effectiveGasPrice'] !== undefined
      ? { effectiveGasPrice: receipt['effectiveGasPrice'] }
      : {}),
    transactionHash: receipt['transactionHash']
  }
}

export async function collectWalletCallReceipt(
  candidate: WalletCallTransactionCandidate,
  dependencies: WalletCallReceiptDependencies
): Promise<WalletCallReceiptOutcome> {
  let target: Readonly<WalletCallTransactionCandidate>
  try {
    target = snapshotWalletCallCandidate(candidate)
  } catch (error) {
    return { status: 'error', reason: walletCallDiagnostic(error, 'Invalid receipt candidate') }
  }

  let receipt: unknown
  try {
    receipt = await dependencies.getTransactionReceipt(target.chainId, target.hash)
  } catch (error) {
    return { status: 'error', reason: walletCallDiagnostic(error, 'Transaction receipt lookup failed') }
  }

  if (receipt === null || receipt === undefined) return { status: 'pending' }

  const parsed = WalletCallReceiptSchema.safeParse(receiptEvidence(receipt))
  if (!parsed.success || parsed.data.transactionHash !== target.hash) {
    return {
      status: 'error',
      reason: 'Transaction receipt is malformed or does not match the submitted hash'
    }
  }

  try {
    dependencies.ledger.recordReceipt(target.origin, target.account, target.id, parsed.data)
    return { status: 'receipt-recorded' }
  } catch (error) {
    return { status: 'error', reason: walletCallDiagnostic(error, 'Transaction receipt persistence failed') }
  }
}

export async function collectWalletCallReceipts(
  candidates: readonly WalletCallTransactionCandidate[],
  dependencies: WalletCallReceiptDependencies
) {
  const queue = snapshotWalletCallCandidateQueue(candidates, MAX_SUBMITTED_TRANSACTION_CANDIDATES)
  const outcomes: WalletCallReceiptOutcome[] = []
  for (const candidate of queue) {
    try {
      outcomes.push(await collectWalletCallReceipt(candidate, dependencies))
    } catch (error) {
      outcomes.push({ status: 'error', reason: walletCallDiagnostic(error, 'Receipt collection failed') })
    }
  }
  return outcomes
}
