import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import {
  WalletCallReceiptSchema,
  type WalletCallBatch,
  type WalletCallReceipt
} from '../store/state/types/walletCallBatch'
import type { OperationLifecycleLedger } from '../operationLifecycle/ledger'
import type { OperationLifecycleRpc } from '../operationLifecycle/rpc'
import type { OperationReconciliationObserver } from '../operationLifecycle/reconciler'
import { BACKGROUND_SETTLEMENT_FALLBACK_CONFIRMATIONS } from '../operationLifecycle/settlement'
import type { WalletCallBatchWithOperationId } from './walletCallBatches'

const HASH = /^0x[0-9a-fA-F]{64}$/u

const isBackgroundSettlementCandidate = (operation: OperationLifecycle) =>
  operation.kind === 'walletCalls' &&
  (operation.state === 'confirmed' || operation.state === 'failed') &&
  operation.settlement?.status === 'monitoring'

export const isWalletCallLifecycleCandidate = (
  operation: OperationLifecycle,
  hasSubmittedPrefix: boolean
) => {
  if (operation.kind !== 'walletCalls') return false
  if (operation.state === 'failed') {
    return hasSubmittedPrefix && operation.settlement?.status !== 'complete'
  }
  return (
    ['submitted', 'confirming', 'reorged'].includes(operation.state) ||
    isBackgroundSettlementCandidate(operation)
  )
}

type BlockEvidence = Readonly<{ number: string; hash: string }>

interface WalletCallLifecycleBatchLedger {
  listLifecycleCandidates(now?: number): readonly Readonly<WalletCallBatchWithOperationId>[]
  getByOperationId(operationId: string, now?: number): WalletCallBatchWithOperationId | undefined
  markTransactionSubmitted(origin: string, account: string, id: string, hash: string, now?: number): void
  setReceipt(origin: string, account: string, id: string, receipt: WalletCallReceipt, now?: number): void
  clearReceipt(origin: string, account: string, id: string, hash: string, now?: number): void
}

export type WalletCallLifecycleOutcome = Readonly<{
  operationId: string
  status: 'updated' | 'unchanged' | 'error'
  reason?: string
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseBlock = (value: unknown): BlockEvidence => {
  if (!isRecord(value)) throw new Error('Invalid wallet-call block response')
  const number = value['number']
  const hash = value['hash']
  const parsedNumber = parseRpcQuantity(number)
  if (
    parsedNumber === undefined ||
    toRpcQuantity(parsedNumber) !== number ||
    typeof hash !== 'string' ||
    !HASH.test(hash)
  ) {
    throw new Error('Invalid wallet-call block response')
  }
  return Object.freeze({ number, hash: hash.toLowerCase() })
}

const receiptEvidence = (value: unknown) => {
  if (!isRecord(value)) return value
  const logs = Array.isArray(value['logs'])
    ? value['logs'].map((entry) => {
        if (!isRecord(entry)) return entry
        return { address: entry['address'], data: entry['data'], topics: entry['topics'] }
      })
    : value['logs']
  return {
    logs,
    status: value['status'],
    ...(value['type'] !== undefined ? { type: value['type'] } : {}),
    blockHash: value['blockHash'],
    blockNumber: value['blockNumber'],
    gasUsed: value['gasUsed'],
    ...(value['effectiveGasPrice'] !== undefined ? { effectiveGasPrice: value['effectiveGasPrice'] } : {}),
    transactionHash: value['transactionHash']
  }
}

const parseReceipt = (value: unknown, expectedHash: string) => {
  if (value === null || value === undefined) return
  const parsed = WalletCallReceiptSchema.safeParse(receiptEvidence(value))
  if (!parsed.success || parsed.data.transactionHash !== expectedHash) {
    throw new Error('Wallet-call receipt is malformed or does not match its transaction')
  }
  return parsed.data
}

const transactionMatches = (value: unknown, hash: string) =>
  isRecord(value) && typeof value['hash'] === 'string' && value['hash'].toLowerCase() === hash

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message.slice(0, 240) : 'Wallet-call reconciliation failed'

export class WalletCallLifecycleReconciler {
  constructor(
    private readonly batches: WalletCallLifecycleBatchLedger,
    private readonly operations: OperationLifecycleLedger,
    private readonly rpc: OperationLifecycleRpc,
    private readonly observer: OperationReconciliationObserver = () => {}
  ) {}

  private transition(
    previous: OperationLifecycle,
    state: OperationLifecycle['state'],
    now: number,
    confirmations?: number,
    pendingEvidence?: boolean,
    settlement?: OperationLifecycle['settlement'] | null,
    preserveUpdatedAt = false
  ) {
    const { settlement: _settlement, ...withoutSettlement } = previous
    const next = {
      ...(settlement === null ? withoutSettlement : previous),
      state,
      updatedAt: preserveUpdatedAt ? previous.updatedAt : Math.max(now, previous.updatedAt),
      ...(settlement && { settlement })
    }
    if (previous.state === state && JSON.stringify(previous.settlement) === JSON.stringify(next.settlement)) {
      this.observer(
        Object.freeze({
          previous,
          current: previous,
          ...(confirmations === undefined ? {} : { confirmations }),
          ...(pendingEvidence === undefined ? {} : { pendingEvidence })
        })
      )
      return previous
    }
    const current = this.operations.put(next, state === 'stopped' ? -1 : now)
    this.observer(
      Object.freeze({
        previous,
        current,
        ...(confirmations === undefined ? {} : { confirmations }),
        ...(pendingEvidence === undefined ? {} : { pendingEvidence })
      })
    )
    return current
  }

  private async settlementBasis(
    operation: OperationLifecycle,
    receiptBlocks: readonly BlockEvidence[],
    minimumConfirmations: bigint
  ): Promise<'finalized' | 'confirmations' | 'reorged' | undefined> {
    if (minimumConfirmations >= BACKGROUND_SETTLEMENT_FALLBACK_CONFIRMATIONS) return 'confirmations'
    try {
      const finalized = parseBlock(
        await this.rpc(operation.chainId, 'eth_getBlockByNumber', ['finalized', false])
      )
      const finalizedNumber = parseRpcQuantity(finalized.number)
      if (finalizedNumber === undefined) return undefined
      const receiptNumbers = receiptBlocks.map(({ number }) => parseRpcQuantity(number) as bigint)
      if (!receiptNumbers.every((receiptNumber) => finalizedNumber >= receiptNumber)) return undefined
      const confirmedReceiptBlocks = await Promise.all(
        receiptBlocks.map(({ number }) =>
          this.rpc(operation.chainId, 'eth_getBlockByNumber', [number, false]).then(parseBlock)
        )
      )
      if (
        confirmedReceiptBlocks.some(
          (block, index) =>
            block.number !== receiptBlocks[index]?.number || block.hash !== receiptBlocks[index]?.hash
        )
      ) {
        return 'reorged'
      }
      return 'finalized'
    } catch (_error) {
      // Finalized tags are optional on custom EVM endpoints. Canonical depth is
      // the bounded fallback and never delays the first user-visible outcome.
    }
    return undefined
  }

  private async reconcileSignedReservation(batch: WalletCallBatchWithOperationId, now: number) {
    const signed = batch.transactions[batch.transactions.length - 1]
    if (!signed || signed.state !== 'signed') return batch

    const rawReceipt = await this.rpc(Number(BigInt(batch.chainId)), 'eth_getTransactionReceipt', [
      signed.hash
    ])
    const receipt = parseReceipt(rawReceipt, signed.hash)
    if (receipt) {
      this.batches.markTransactionSubmitted(batch.origin, batch.account, batch.id, signed.hash, now)
      return this.batches.getByOperationId(batch.operationId, now) || batch
    }

    const transaction = await this.rpc(Number(BigInt(batch.chainId)), 'eth_getTransactionByHash', [
      signed.hash
    ])
    if (transactionMatches(transaction, signed.hash)) {
      this.batches.markTransactionSubmitted(batch.origin, batch.account, batch.id, signed.hash, now)
      return this.batches.getByOperationId(batch.operationId, now) || batch
    }
    if (transaction !== null && transaction !== undefined) {
      throw new Error('Wallet-call transaction response does not match its signed reservation')
    }
    return batch
  }

  private async canonicalEvidence(batch: WalletCallBatch, now: number) {
    const submitted = batch.transactions.filter((transaction) => transaction.state === 'submitted')
    if (!submitted.length) return []
    const chainId = Number(BigInt(batch.chainId))
    const latest = parseBlock(await this.rpc(chainId, 'eth_getBlockByNumber', ['latest', false]))
    const latestNumber = parseRpcQuantity(latest.number) as bigint

    return Promise.all(
      submitted.map(async (transaction) => {
        const receipt = parseReceipt(
          await this.rpc(chainId, 'eth_getTransactionReceipt', [transaction.hash]),
          transaction.hash
        )
        if (!receipt) return { transaction, status: 'missing' as const }
        const block = parseBlock(
          await this.rpc(chainId, 'eth_getBlockByNumber', [receipt.blockNumber, false])
        )
        const receiptNumber = parseRpcQuantity(receipt.blockNumber) as bigint
        if (
          block.number !== receipt.blockNumber ||
          block.hash !== receipt.blockHash ||
          latestNumber < receiptNumber
        ) {
          return { transaction, status: 'reorged' as const }
        }
        return {
          transaction,
          status: 'canonical' as const,
          receipt,
          confirmations: latestNumber - receiptNumber + 1n,
          checkedAt: now
        }
      })
    )
  }

  async reconcile(operationId: string, now = Date.now()): Promise<WalletCallLifecycleOutcome> {
    const operation = this.operations.listStored().find((candidate) => candidate.id === operationId)
    if (!operation || operation.kind !== 'walletCalls') {
      return { operationId, status: 'unchanged' }
    }
    if (
      !['submitted', 'confirming', 'reorged'].includes(operation.state) &&
      !(operation.state === 'failed' && operation.settlement?.status !== 'complete') &&
      !isBackgroundSettlementCandidate(operation)
    ) {
      return { operationId, status: 'unchanged' }
    }
    if (operation.expiresAt <= now) {
      if (isBackgroundSettlementCandidate(operation)) {
        const current = this.operations.put(
          { ...operation, settlement: { status: 'complete', basis: 'expired' } },
          -1
        )
        this.observer(Object.freeze({ previous: operation, current, pendingEvidence: false }))
        return { operationId, status: 'updated' }
      }
      this.transition(operation, 'stopped', operation.expiresAt, undefined, false)
      return { operationId, status: 'updated' }
    }

    let batch = this.batches.getByOperationId(operationId, now)
    if (!batch) {
      this.observer(Object.freeze({ previous: operation, current: operation, pendingEvidence: false }))
      return { operationId, status: 'unchanged' }
    }

    try {
      if (batch.execution === 'failed' && batch.transactions.length === 0) {
        this.transition(operation, 'failed', now, undefined, false)
        return { operationId, status: 'unchanged' }
      }
      batch = await this.reconcileSignedReservation(batch, now)
      const evidence = await this.canonicalEvidence(batch, now)
      let reorged = false
      let hasCanonicalReceipt = false
      let minimumConfirmations: bigint | undefined

      for (const item of evidence) {
        if (item.status === 'canonical') {
          hasCanonicalReceipt = true
          minimumConfirmations =
            minimumConfirmations === undefined || item.confirmations < minimumConfirmations
              ? item.confirmations
              : minimumConfirmations
          const receiptChanged =
            item.transaction.receipt !== undefined &&
            JSON.stringify(item.transaction.receipt) !== JSON.stringify(item.receipt)
          if (JSON.stringify(item.transaction.receipt) !== JSON.stringify(item.receipt)) {
            this.batches.setReceipt(batch.origin, batch.account, batch.id, item.receipt, now)
          }
          if (receiptChanged) reorged = true
        } else if (item.transaction.receipt) {
          this.batches.clearReceipt(batch.origin, batch.account, batch.id, item.transaction.hash, now)
          reorged = true
        }
        if (item.status === 'reorged') reorged = true
      }

      const submitted = batch.transactions.filter((transaction) => transaction.state === 'submitted')
      const allCallsSubmitted =
        batch.execution === 'complete' &&
        submitted.length === batch.callCount &&
        batch.transactions.every((transaction) => transaction.state === 'submitted')
      const failedPrefixSubmitted =
        batch.execution === 'failed' && submitted.length > 0 && submitted.length === batch.transactions.length
      const canonical = evidence.filter((item) => item.status === 'canonical')
      const allCanonical = canonical.length === submitted.length && submitted.length > 0
      const confirmations = minimumConfirmations === undefined ? undefined : Number(minimumConfirmations)

      if (reorged || (operation.state === 'reorged' && !allCanonical)) {
        this.transition(operation, 'reorged', now, confirmations, false, null)
      } else if ((allCallsSubmitted || failedPrefixSubmitted) && allCanonical) {
        const state = failedPrefixSubmitted
          ? 'failed'
          : canonical.every((item) => item.receipt.status === '0x1')
            ? 'confirmed'
            : 'failed'
        if (!isBackgroundSettlementCandidate(operation)) {
          this.transition(operation, state, now, confirmations, false, { status: 'monitoring' })
        } else if (minimumConfirmations !== undefined) {
          const receiptBlocks = canonical.map((item) => ({
            number: item.receipt.blockNumber,
            hash: item.receipt.blockHash
          }))
          const basis = await this.settlementBasis(operation, receiptBlocks, minimumConfirmations)
          if (basis === 'reorged') {
            for (const item of canonical) {
              this.batches.clearReceipt(batch.origin, batch.account, batch.id, item.transaction.hash, now)
            }
            this.transition(operation, 'reorged', now, confirmations, false, null)
          } else if (basis) {
            this.transition(operation, state, now, confirmations, false, { status: 'complete', basis }, true)
          } else {
            this.transition(operation, state, now, confirmations, false)
          }
        }
      } else if (hasCanonicalReceipt) {
        this.transition(operation, 'confirming', now, confirmations, true)
      } else {
        this.transition(operation, 'submitted', now, undefined, false)
      }
      return { operationId, status: 'updated' }
    } catch (error) {
      this.observer(Object.freeze({ previous: operation, current: operation, pendingEvidence: false }))
      return { operationId, status: 'error', reason: errorMessage(error) }
    }
  }

  async reconcileAll(now = Date.now()) {
    // Reading candidates upgrades legacy batches and recreates a missing lifecycle
    // from bounded persisted evidence before the operation list is captured.
    this.batches.listLifecycleCandidates(now)
    const candidates = this.operations
      .listStored()
      .filter((operation) =>
        isWalletCallLifecycleCandidate(
          operation,
          Boolean(this.batches.getByOperationId(operation.id, now)?.transactions.length)
        )
      )
    const outcomes: WalletCallLifecycleOutcome[] = []
    for (const operation of candidates) outcomes.push(await this.reconcile(operation.id, now))
    return outcomes
  }
}
