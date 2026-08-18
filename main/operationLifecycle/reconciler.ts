import { parseAccountCode } from '../../resources/domain/account/code'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import type { OperationLifecycleLedger } from './ledger'
import type { OperationLifecycleRpc } from './rpc'
import { BACKGROUND_SETTLEMENT_FALLBACK_CONFIRMATIONS } from './settlement'

const HASH = /^0x[0-9a-fA-F]{64}$/u
const EIP7702_CONFIRMATIONS_REQUIRED = 12n

type BlockEvidence = Readonly<{ number: string; hash: string }>
type ReceiptEvidence = Readonly<{
  transactionHash: string
  blockHash: string
  blockNumber: string
  status: '0x0' | '0x1'
}>

export type OperationReconciliationObservation = Readonly<{
  previous: OperationLifecycle
  current: OperationLifecycle
  confirmations?: number
  receipt?: Readonly<Record<string, unknown>>
  // This process saw enough canonical network evidence to keep a non-terminal
  // operation under active confirmation. It intentionally is not persisted:
  // after restart, a fresh reconciliation must establish it again.
  pendingEvidence?: boolean
}>

export type OperationReconciliationObserver = (observation: OperationReconciliationObservation) => void

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseBlock = (value: unknown): BlockEvidence => {
  if (!isRecord(value)) throw new Error('Invalid block response')
  const number = value['number']
  const hash = value['hash']
  const parsedNumber = parseRpcQuantity(number)
  if (
    parsedNumber === undefined ||
    toRpcQuantity(parsedNumber) !== number ||
    typeof hash !== 'string' ||
    !HASH.test(hash)
  ) {
    throw new Error('Invalid block response')
  }
  return Object.freeze({ number, hash: hash.toLowerCase() })
}

const parseReceipt = (
  value: unknown,
  expectedHash: string
): Readonly<{ persisted: ReceiptEvidence; live: Readonly<Record<string, unknown>> }> | undefined => {
  if (value === null || value === undefined) return
  if (!isRecord(value)) throw new Error('Invalid transaction receipt response')
  const transactionHash = value['transactionHash']
  const blockHash = value['blockHash']
  const blockNumber = value['blockNumber']
  const status = value['status']
  if (
    typeof transactionHash !== 'string' ||
    transactionHash.toLowerCase() !== expectedHash ||
    typeof blockHash !== 'string' ||
    !HASH.test(blockHash) ||
    parseRpcQuantity(blockNumber) === undefined ||
    toRpcQuantity(parseRpcQuantity(blockNumber) as bigint) !== blockNumber ||
    (status !== '0x0' && status !== '0x1')
  ) {
    throw new Error('Invalid transaction receipt response')
  }
  return Object.freeze({
    persisted: Object.freeze({
      transactionHash: expectedHash,
      blockHash: blockHash.toLowerCase(),
      blockNumber,
      status
    }),
    live: Object.freeze({ ...value })
  })
}

const operationHash = (operation: OperationLifecycle) =>
  operation.transaction?.hash ?? operation.eip7702Revoke?.hash

const withoutReceipt = (operation: OperationLifecycle, state: OperationLifecycle['state'], now: number) => {
  const { receipt: _receipt, settlement: _settlement, ...without } = operation
  return { ...without, state, updatedAt: Math.max(now, operation.updatedAt) }
}

const isBackgroundSettlementCandidate = (operation: OperationLifecycle) =>
  operation.kind === 'transaction' &&
  (operation.state === 'confirmed' || operation.state === 'failed') &&
  operation.settlement?.status === 'monitoring'

export class OperationLifecycleReconciler {
  constructor(
    private readonly ledger: OperationLifecycleLedger,
    private readonly rpc: OperationLifecycleRpc,
    private readonly observer: OperationReconciliationObserver = () => {}
  ) {}

  private emit(previous: OperationLifecycle, current: OperationLifecycle, detail = {}) {
    this.observer(Object.freeze({ previous, current, ...detail }))
  }

  private transition(
    previous: OperationLifecycle,
    current: OperationLifecycle,
    now: number,
    detail: Omit<OperationReconciliationObservation, 'previous' | 'current'> = {}
  ) {
    const sameState = previous.state === current.state
    const sameReceipt = JSON.stringify(previous.receipt) === JSON.stringify(current.receipt)
    const sameSettlement = JSON.stringify(previous.settlement) === JSON.stringify(current.settlement)
    if (sameState && sameReceipt && sameSettlement) {
      this.emit(previous, previous, detail)
      return previous
    }
    const saved = this.ledger.put(current, now)
    this.emit(previous, saved, detail)
    return saved
  }

  private replacementFor(operation: OperationLifecycle) {
    const transaction = operation.transaction
    if (!transaction) return
    return this.ledger
      .listStored()
      .find(
        (candidate) =>
          candidate.id !== operation.id &&
          candidate.kind === 'transaction' &&
          candidate.account === operation.account &&
          candidate.chainId === operation.chainId &&
          candidate.transaction?.nonce === transaction.nonce &&
          candidate.transaction?.hash !== transaction.hash &&
          (candidate.state === 'confirmed' || candidate.state === 'failed') &&
          candidate.settlement?.status !== 'monitoring'
      )
  }

  private async settlementBasis(
    operation: OperationLifecycle,
    receiptBlock: BlockEvidence,
    confirmations: bigint
  ): Promise<'finalized' | 'confirmations' | 'reorged' | undefined> {
    if (confirmations >= BACKGROUND_SETTLEMENT_FALLBACK_CONFIRMATIONS) return 'confirmations'
    try {
      const finalized = parseBlock(
        await this.rpc(operation.chainId, 'eth_getBlockByNumber', ['finalized', false])
      )
      const finalizedNumber = parseRpcQuantity(finalized.number)
      const receiptNumber = parseRpcQuantity(receiptBlock.number)
      if (finalizedNumber === undefined || receiptNumber === undefined || finalizedNumber < receiptNumber) {
        return undefined
      }
      const confirmedReceiptBlock = parseBlock(
        await this.rpc(operation.chainId, 'eth_getBlockByNumber', [receiptBlock.number, false])
      )
      if (
        confirmedReceiptBlock.number !== receiptBlock.number ||
        confirmedReceiptBlock.hash !== receiptBlock.hash
      ) {
        return 'reorged'
      }
      return 'finalized'
    } catch (_error) {
      // Finalized tags are not uniformly available across custom EVM endpoints.
      // Canonical confirmation monitoring remains the bounded fallback.
    }
    return undefined
  }

  private async canonicalEvidence(operation: OperationLifecycle) {
    const hash = operationHash(operation)
    if (!hash) throw new Error('Operation is missing a transaction hash')
    const rawReceipt = await this.rpc(operation.chainId, 'eth_getTransactionReceipt', [hash])
    const receipt = parseReceipt(rawReceipt, hash)
    if (!receipt) return
    if (operation.receipt && JSON.stringify(operation.receipt) !== JSON.stringify(receipt.persisted)) {
      return { reorged: true as const }
    }
    const [receiptBlockValue, latestBlockValue] = await Promise.all([
      this.rpc(operation.chainId, 'eth_getBlockByNumber', [receipt.persisted.blockNumber, false]),
      this.rpc(operation.chainId, 'eth_getBlockByNumber', ['latest', false])
    ])
    const receiptBlock = parseBlock(receiptBlockValue)
    const latestBlock = parseBlock(latestBlockValue)
    if (
      receiptBlock.number !== receipt.persisted.blockNumber ||
      receiptBlock.hash !== receipt.persisted.blockHash
    ) {
      return { reorged: true as const }
    }
    const latestNumber = parseRpcQuantity(latestBlock.number)
    const receiptNumber = parseRpcQuantity(receiptBlock.number)
    if (latestNumber === undefined || receiptNumber === undefined || latestNumber < receiptNumber) {
      throw new Error('Invalid confirmation evidence')
    }
    return {
      receipt,
      receiptBlock,
      latestBlock,
      confirmations: latestNumber - receiptNumber + 1n
    }
  }

  async reconcile(operationId: string, now = Date.now()) {
    const operation = this.ledger.listStored().find(({ id }) => id === operationId)
    if (!operation) return
    if (
      !['submitted', 'confirming', 'reorged'].includes(operation.state) &&
      !isBackgroundSettlementCandidate(operation)
    ) {
      return operation
    }

    if (operation.expiresAt <= now) {
      if (isBackgroundSettlementCandidate(operation)) {
        const settled = this.ledger.put(
          { ...operation, settlement: { status: 'complete', basis: 'expired' } },
          -1
        )
        this.emit(operation, settled, { pendingEvidence: false })
        return settled
      }
      // Expired rows remain durable until the Activity/notification projection marks the
      // terminal outcome handled. This prevents restart from silently losing "stopped".
      return this.transition(
        operation,
        {
          ...operation,
          state: operation.kind === 'eip7702Revoke' && operation.receipt ? 'clearance-unverified' : 'stopped',
          updatedAt: operation.expiresAt
        },
        -1,
        { pendingEvidence: false }
      )
    }

    if (this.replacementFor(operation)) {
      return this.transition(operation, { ...operation, state: 'replaced', updatedAt: now }, now, {
        pendingEvidence: false
      })
    }

    try {
      const evidence = await this.canonicalEvidence(operation)
      if (!evidence) {
        const state = operation.receipt
          ? 'reorged'
          : operation.state === 'reorged'
            ? 'submitted'
            : 'submitted'
        return this.transition(operation, withoutReceipt(operation, state, now), now, {
          pendingEvidence: false
        })
      }
      if ('reorged' in evidence) {
        return this.transition(operation, withoutReceipt(operation, 'reorged', now), now, {
          pendingEvidence: false
        })
      }

      const confirmations = Number(evidence.confirmations)
      const detail = { confirmations, receipt: evidence.receipt.live, pendingEvidence: true }
      const withReceipt = { ...operation, receipt: evidence.receipt.persisted, updatedAt: now }
      if (operation.kind === 'transaction') {
        const state = evidence.receipt.persisted.status === '0x1' ? 'confirmed' : 'failed'
        if (!isBackgroundSettlementCandidate(operation)) {
          return this.transition(
            operation,
            { ...withReceipt, state, settlement: { status: 'monitoring' } },
            now,
            { ...detail, pendingEvidence: false }
          )
        }
        const basis = await this.settlementBasis(operation, evidence.receiptBlock, evidence.confirmations)
        if (basis === 'reorged') {
          return this.transition(operation, withoutReceipt(operation, 'reorged', now), now, {
            pendingEvidence: false
          })
        }
        if (!basis) {
          this.emit(operation, operation, { ...detail, pendingEvidence: false })
          return operation
        }
        return this.transition(
          operation,
          {
            ...withReceipt,
            state,
            updatedAt: operation.updatedAt,
            settlement: { status: 'complete', basis }
          },
          now,
          { ...detail, pendingEvidence: false }
        )
      }
      if (operation.kind !== 'eip7702Revoke') return operation

      if (evidence.confirmations < EIP7702_CONFIRMATIONS_REQUIRED) {
        return this.transition(operation, { ...withReceipt, state: 'confirming' }, now, detail)
      }

      const code = await this.rpc(operation.chainId, 'eth_getCode', [
        operation.account,
        { blockHash: evidence.latestBlock.hash, requireCanonical: true }
      ])
      const [confirmedReceiptBlockValue, confirmedLatestBlockValue] = await Promise.all([
        this.rpc(operation.chainId, 'eth_getBlockByNumber', [evidence.receiptBlock.number, false]),
        this.rpc(operation.chainId, 'eth_getBlockByNumber', [evidence.latestBlock.number, false])
      ])
      const confirmedReceiptBlock = parseBlock(confirmedReceiptBlockValue)
      const confirmedLatestBlock = parseBlock(confirmedLatestBlockValue)
      if (
        confirmedReceiptBlock.hash !== evidence.receiptBlock.hash ||
        confirmedReceiptBlock.number !== evidence.receiptBlock.number ||
        confirmedLatestBlock.hash !== evidence.latestBlock.hash ||
        confirmedLatestBlock.number !== evidence.latestBlock.number
      ) {
        return this.transition(operation, withoutReceipt(operation, 'reorged', now), now, {
          pendingEvidence: false
        })
      }
      const parsedCode = parseAccountCode(code)
      if (!parsedCode) {
        return this.transition(operation, { ...withReceipt, state: 'confirming' }, now, detail)
      }
      return this.transition(
        operation,
        {
          ...withReceipt,
          state: parsedCode.status === 'no-code' ? 'verified-clearance' : 'failed'
        },
        now,
        { ...detail, pendingEvidence: false }
      )
    } catch (_error) {
      this.emit(operation, operation, { pendingEvidence: false })
      return operation
    }
  }

  async reconcileAll(now = Date.now()) {
    const operations = this.ledger.listStored()
    await Promise.all(operations.map(({ id }) => this.reconcile(id, now)))
  }
}
