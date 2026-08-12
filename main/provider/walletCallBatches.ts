import crypto from 'crypto'

import {
  WalletCallBatch,
  WalletCallBatchSchema,
  WalletCallBatches,
  WalletCallReceipt,
  WalletCallReceiptSchema,
  PERSISTED_WALLET_CALL_BATCH_TTL_MS
} from '../store/state/types/walletCallBatch'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import { MAX_WALLET_CALL_ID_BYTES } from './walletCalls'

export const WALLET_CALL_BATCH_TTL_MS = PERSISTED_WALLET_CALL_BATCH_TTL_MS
export const MAX_RETAINED_WALLET_CALL_BATCHES = 256
export const MAX_RETAINED_WALLET_CALL_BATCHES_PER_ORIGIN = 64
export const MAX_PERSISTED_WALLET_CALL_RECEIPT_BYTES = 256 * 1024
export const MAX_PERSISTED_WALLET_CALL_BATCH_BYTES = 1024 * 1024
export const MAX_PERSISTED_WALLET_CALL_LEDGER_BYTES = 32 * 1024 * 1024

const INTERNAL_KEY = /^0x[0-9a-f]{64}$/

export interface WalletCallBatchStorage {
  load(): unknown
  save(batches: WalletCallBatches): void
}

export interface WalletCallOperationLifecycleLedger {
  get(id: string, now?: number): OperationLifecycle | undefined
  put(operation: OperationLifecycle, now?: number): OperationLifecycle
  remove(id: string, now?: number): boolean
  evictOldestHandledTerminal(now?: number): boolean
}

export type WalletCallBatchWithOperationId = WalletCallBatch & { operationId: string }

export interface CreateWalletCallBatch {
  id?: string
  origin: string
  account: string
  chainId: string
  callCount: number
}

export interface WalletCallsStatus {
  version: '2.0.0'
  id: string
  chainId: string
  status: 100 | 200 | 400 | 500 | 600
  atomic: false
  receipts?: WalletCallReceipt[]
}

export interface WalletCallTransactionCandidate {
  origin: string
  account: string
  id: string
  chainId: string
  hash: string
}

function rpcError(code: number, message: string): EVMError {
  return { code, message }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function randomIdentifier() {
  return `0x${crypto.randomBytes(32).toString('hex')}`
}

function persistedBytes(value: unknown) {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(serialized, 'utf8')
  } catch (_error) {
    return Number.POSITIVE_INFINITY
  }
}

function operationIdForLegacyBatch(key: string) {
  const digest = crypto.createHash('sha256').update(`wren:wallet-call:${key}`).digest('hex').slice(0, 32)
  const versioned = `${digest.slice(0, 12)}4${digest.slice(13, 16)}${(
    (Number.parseInt(digest[16] || '0', 16) & 0x3) |
    0x8
  ).toString(16)}${digest.slice(17)}`
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(
    16,
    20
  )}-${versioned.slice(20)}`
}

function normalizeLoadedBatches(value: unknown): WalletCallBatches {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  let totalBytes = 2
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<WalletCallBatches>((batches, [key, candidate]) => {
      if (!INTERNAL_KEY.test(key)) return batches
      if (persistedBytes(candidate) > MAX_PERSISTED_WALLET_CALL_BATCH_BYTES) return batches
      const parsed = WalletCallBatchSchema.safeParse(candidate)
      if (!parsed.success) return batches
      const normalized = parsed.data.operationId
        ? parsed.data
        : { ...parsed.data, operationId: operationIdForLegacyBatch(key) }

      const candidateBytes = persistedBytes({ [key]: normalized })
      if (
        persistedBytes(normalized) > MAX_PERSISTED_WALLET_CALL_BATCH_BYTES ||
        totalBytes + candidateBytes > MAX_PERSISTED_WALLET_CALL_LEDGER_BYTES
      ) {
        return batches
      }

      batches[key] = normalized
      totalBytes += candidateBytes
      return batches
    }, {})
}

function deriveStatus(batch: WalletCallBatch): WalletCallsStatus {
  const submitted = batch.transactions.filter((transaction) => transaction.state === 'submitted')
  const receipts = submitted.flatMap((transaction) => (transaction.receipt ? [transaction.receipt] : []))
  let status: WalletCallsStatus['status'] = 100

  if (batch.execution === 'failed' && submitted.length === 0) {
    status = 400
  } else if (batch.execution !== 'pending' && receipts.length === submitted.length) {
    if (submitted.length < batch.callCount) {
      status = 600
    } else if (receipts.every((receipt) => receipt.status === '0x1')) {
      status = 200
    } else if (receipts.every((receipt) => receipt.status === '0x0')) {
      status = 500
    } else {
      status = 600
    }
  }

  return {
    version: '2.0.0',
    id: batch.id,
    chainId: batch.chainId,
    status,
    atomic: false,
    ...(receipts.length > 0 ? { receipts: clone(receipts) } : {})
  }
}

export class WalletCallBatchLedger {
  constructor(
    private storage: WalletCallBatchStorage,
    private operationLifecycles?: WalletCallOperationLifecycleLedger
  ) {}

  private read(now: number) {
    const loaded = this.storage.load()
    const batches = normalizeLoadedBatches(loaded)
    const loadedCount =
      loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? Object.keys(loaded).length : 0
    let changed =
      Object.keys(batches).length !== loadedCount ||
      (() => {
        try {
          return JSON.stringify(loaded) !== JSON.stringify(batches)
        } catch (_) {
          return true
        }
      })()

    Object.entries(batches).forEach(([key, batch]) => {
      if (batch.expiresAt <= now) {
        delete batches[key]
        changed = true
      }
    })

    if (changed) this.storage.save(clone(batches))
    Object.values(batches).forEach((batch) => {
      if (batch.transactions.length > 0) this.ensureOperation(batch as WalletCallBatchWithOperationId, now)
    })
    return batches
  }

  private operationState(batch: WalletCallBatch): OperationLifecycle['state'] {
    if (batch.execution === 'failed') return 'failed'
    return 'submitted'
  }

  private ensureOperation(
    batch: WalletCallBatchWithOperationId,
    now: number,
    requestedState = this.operationState(batch)
  ) {
    if (!this.operationLifecycles) return
    const current = this.operationLifecycles.get(batch.operationId, Math.min(now, batch.expiresAt - 1))
    if (current) {
      if (
        current.kind !== 'walletCalls' ||
        current.account !== batch.account ||
        current.origin !== batch.origin ||
        current.chainId !== Number(BigInt(batch.chainId)) ||
        current.walletCalls?.batchOperationId !== batch.operationId
      ) {
        throw new Error('Wallet-call operation lifecycle identity does not match its batch')
      }
      const terminal = ['confirmed', 'failed', 'replaced', 'stopped', 'verified-clearance'].includes(
        current.state
      )
      if (terminal || current.state === requestedState || requestedState !== 'failed') return current
      return this.operationLifecycles.put(
        { ...current, state: requestedState, updatedAt: Math.max(now, current.updatedAt) },
        now
      )
    }

    const operation: OperationLifecycle = {
      id: batch.operationId,
      kind: 'walletCalls',
      account: batch.account,
      origin: batch.origin,
      chainId: Number(BigInt(batch.chainId)),
      state: requestedState,
      createdAt: now,
      updatedAt: now,
      expiresAt: batch.expiresAt,
      visibleInActivity: true,
      notification: {},
      walletCalls: { batchOperationId: batch.operationId }
    }
    try {
      return this.operationLifecycles.put(operation, now)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Operation lifecycle limit reached') throw error
      if (!this.operationLifecycles.evictOldestHandledTerminal(now)) throw error
      return this.operationLifecycles.put(operation, now)
    }
  }

  private write(batches: WalletCallBatches) {
    this.storage.save(clone(batches))
  }

  private writeBatch(batches: WalletCallBatches, key: string, candidate: WalletCallBatch) {
    const parsed = WalletCallBatchSchema.safeParse(candidate)
    if (!parsed.success) throw new Error('Invalid wallet call batch update')
    if (persistedBytes(parsed.data) > MAX_PERSISTED_WALLET_CALL_BATCH_BYTES) {
      throw new Error('Wallet call batch exceeds persistence limit')
    }

    const updated = { ...batches, [key]: parsed.data }
    if (persistedBytes(updated) > MAX_PERSISTED_WALLET_CALL_LEDGER_BYTES) {
      throw new Error('Wallet call ledger exceeds persistence limit')
    }
    this.write(updated)
  }

  private find(batches: WalletCallBatches, origin: string, account: string, id: string) {
    const normalizedAccount = account.toLowerCase()
    return Object.entries(batches).find(
      ([_key, batch]) => batch.origin === origin && batch.account === normalizedAccount && batch.id === id
    )
  }

  private require(batches: WalletCallBatches, origin: string, account: string, id: string) {
    const found = this.find(batches, origin, account, id)
    if (!found) throw rpcError(5730, 'Unknown bundle id')
    return found
  }

  create(input: CreateWalletCallBatch, now = Date.now()) {
    const batches = this.read(now)
    if (input.id !== undefined && Buffer.byteLength(input.id, 'utf8') > MAX_WALLET_CALL_ID_BYTES) {
      throw rpcError(-32602, 'Invalid params: batch id exceeds 4096 UTF-8 bytes')
    }
    const candidate = WalletCallBatchSchema.safeParse({
      id: input.id ?? 'pending-generated-id',
      operationId: crypto.randomUUID(),
      origin: input.origin,
      account: input.account,
      chainId: input.chainId,
      atomic: false,
      callCount: input.callCount,
      execution: 'pending',
      transactions: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + WALLET_CALL_BATCH_TTL_MS
    })

    if (!candidate.success) throw rpcError(-32602, 'Invalid wallet call batch metadata')
    if (input.id !== undefined && this.find(batches, input.origin, candidate.data.account, input.id)) {
      throw rpcError(5720, 'Duplicate ID')
    }

    const originCount = Object.values(batches).filter((batch) => batch.origin === input.origin).length
    if (
      Object.keys(batches).length >= MAX_RETAINED_WALLET_CALL_BATCHES ||
      originCount >= MAX_RETAINED_WALLET_CALL_BATCHES_PER_ORIGIN
    ) {
      throw rpcError(5740, 'Bundle too large: retained batch limit reached')
    }

    let key = randomIdentifier()
    while (batches[key]) key = randomIdentifier()

    let id = input.id
    if (!id) {
      do id = randomIdentifier()
      while (Object.values(batches).some((batch) => batch.id === id))
    }

    const batch = { ...candidate.data, id }
    batches[key] = batch
    this.write(batches)

    const rollbackTarget = clone(batch)
    let admissionOpen = true
    const requireOpenAdmission = () => {
      if (!admissionOpen) throw new Error('Wallet call batch admission is already closed')
    }

    return {
      key,
      batch: clone(batch),
      commit: () => {
        requireOpenAdmission()
        admissionOpen = false
      },
      rollback: () => {
        requireOpenAdmission()
        const current = this.read(rollbackTarget.createdAt)
        if (!current[key] || JSON.stringify(current[key]) !== JSON.stringify(rollbackTarget)) {
          throw new Error('Wallet call batch is no longer eligible for admission rollback')
        }

        delete current[key]
        this.write(current)
        admissionOpen = false
      }
    }
  }

  get(origin: string, account: string, id: string, now = Date.now()) {
    const [_key, batch] = this.require(this.read(now), origin, account, id)
    return clone(batch)
  }

  getStatus(origin: string, account: string, id: string, now = Date.now()) {
    return deriveStatus(this.get(origin, account, id, now))
  }

  getByOperationId(operationId: string, now = Date.now()) {
    const batch = Object.values(this.read(now)).find((candidate) => candidate.operationId === operationId)
    return batch ? (clone(batch) as WalletCallBatchWithOperationId) : undefined
  }

  listLifecycleCandidates(now = Date.now()) {
    return Object.freeze(
      Object.values(this.read(now))
        .filter((batch): batch is WalletCallBatchWithOperationId => Boolean(batch.operationId))
        .filter((batch) => batch.transactions.length > 0)
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.operationId.localeCompare(right.operationId)
        )
        .map((batch) => Object.freeze(clone(batch)))
    )
  }

  listReconciliationCandidates(now = Date.now()): readonly Readonly<WalletCallTransactionCandidate>[] {
    const candidates = Object.entries(this.read(now))
      .sort((left, right) => left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]))
      .flatMap(([_key, batch]) => {
        const transaction = batch.transactions[batch.transactions.length - 1]
        if (!transaction || transaction.state !== 'signed') return []

        return [
          Object.freeze({
            origin: batch.origin,
            account: batch.account,
            id: batch.id,
            chainId: batch.chainId,
            hash: transaction.hash
          })
        ]
      })

    return Object.freeze(candidates)
  }

  listReceiptCandidates(now = Date.now()): readonly Readonly<WalletCallTransactionCandidate>[] {
    const candidates = Object.entries(this.read(now))
      .sort((left, right) => left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]))
      .flatMap(([_key, batch]) =>
        batch.transactions.flatMap((transaction) => {
          if (transaction.state !== 'submitted' || transaction.receipt) return []

          return [
            Object.freeze({
              origin: batch.origin,
              account: batch.account,
              id: batch.id,
              chainId: batch.chainId,
              hash: transaction.hash
            })
          ]
        })
      )

    return Object.freeze(candidates)
  }

  reserveTransaction(origin: string, account: string, id: string, hash: string, now = Date.now()) {
    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    const normalizedHash = hash.toLowerCase()

    if (!INTERNAL_KEY.test(normalizedHash)) throw new Error('Invalid transaction hash')
    if (batch.execution !== 'pending') throw new Error('Batch execution is already closed')
    if (batch.transactions.some((transaction) => transaction.hash === normalizedHash)) {
      throw new Error('Transaction hash is already recorded')
    }
    if (batch.transactions.some((transaction) => transaction.state === 'signed')) {
      throw new Error('Previous signed transaction is not submitted')
    }
    if (batch.transactions.length >= batch.callCount) throw new Error('Batch transaction limit reached')

    const operationId = batch.operationId
    if (!operationId) throw new Error('Wallet-call batch is missing its durable operation identity')
    const operation = this.operationLifecycles?.get(operationId, Math.min(now, batch.expiresAt - 1))
    this.ensureOperation(batch as WalletCallBatchWithOperationId, now, 'submitted')
    try {
      this.writeBatch(batches, key, {
        ...batch,
        transactions: [...batch.transactions, { hash: normalizedHash, state: 'signed' }],
        updatedAt: Math.max(now, batch.updatedAt)
      })
    } catch (error) {
      if (!operation) this.operationLifecycles?.remove(operationId, now)
      throw error
    }
  }

  markTransactionSubmitted(origin: string, account: string, id: string, hash: string, now = Date.now()) {
    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    const normalizedHash = hash.toLowerCase()
    if (!INTERNAL_KEY.test(normalizedHash)) throw new Error('Invalid transaction hash')

    const index = batch.transactions.findIndex((transaction) => transaction.hash === normalizedHash)
    if (index < 0) throw new Error('Transaction hash is not reserved')
    const existingTransaction = batch.transactions[index]
    if (!existingTransaction) throw new Error('Reserved transaction is missing')
    if (existingTransaction.state === 'submitted') return

    const transactions = [...batch.transactions]
    transactions[index] = { ...existingTransaction, state: 'submitted' }
    this.writeBatch(batches, key, { ...batch, transactions, updatedAt: Math.max(now, batch.updatedAt) })
    if (batch.operationId) {
      this.ensureOperation(batch as WalletCallBatchWithOperationId, now, 'submitted')
    }
  }

  recordTransaction(origin: string, account: string, id: string, hash: string, now = Date.now()) {
    this.reserveTransaction(origin, account, id, hash, now)
    this.markTransactionSubmitted(origin, account, id, hash, now)
  }

  recordReceipt(origin: string, account: string, id: string, receipt: WalletCallReceipt, now = Date.now()) {
    if (persistedBytes(receipt) > MAX_PERSISTED_WALLET_CALL_RECEIPT_BYTES) {
      throw new Error('Wallet call receipt exceeds persistence limit')
    }
    const parsed = WalletCallReceiptSchema.safeParse(receipt)
    if (!parsed.success) throw new Error('Invalid wallet call receipt')

    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    const index = batch.transactions.findIndex(
      (transaction) => transaction.hash === parsed.data.transactionHash
    )
    if (index < 0) throw new Error('Receipt transaction is not part of this batch')
    const existingTransaction = batch.transactions[index]
    if (!existingTransaction) throw new Error('Receipt transaction is missing')
    const existingReceipt = existingTransaction.receipt
    if (existingReceipt) {
      if (JSON.stringify(existingReceipt) !== JSON.stringify(parsed.data)) {
        throw new Error('Transaction receipt is already recorded')
      }
      return
    }

    const transactions = [...batch.transactions]
    transactions[index] = { ...existingTransaction, state: 'submitted', receipt: parsed.data }
    this.writeBatch(batches, key, { ...batch, transactions, updatedAt: Math.max(now, batch.updatedAt) })
  }

  setReceipt(origin: string, account: string, id: string, receipt: WalletCallReceipt, now = Date.now()) {
    if (persistedBytes(receipt) > MAX_PERSISTED_WALLET_CALL_RECEIPT_BYTES) {
      throw new Error('Wallet call receipt exceeds persistence limit')
    }
    const parsed = WalletCallReceiptSchema.safeParse(receipt)
    if (!parsed.success) throw new Error('Invalid wallet call receipt')
    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    const index = batch.transactions.findIndex(
      (transaction) => transaction.hash === parsed.data.transactionHash
    )
    if (index < 0) throw new Error('Receipt transaction is not part of this batch')
    const transaction = batch.transactions[index]
    if (!transaction) throw new Error('Receipt transaction is missing')
    const transactions = [...batch.transactions]
    transactions[index] = { ...transaction, state: 'submitted', receipt: parsed.data }
    this.writeBatch(batches, key, { ...batch, transactions, updatedAt: Math.max(now, batch.updatedAt) })
  }

  clearReceipt(origin: string, account: string, id: string, hash: string, now = Date.now()) {
    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    const normalizedHash = hash.toLowerCase()
    const index = batch.transactions.findIndex((transaction) => transaction.hash === normalizedHash)
    if (index < 0) throw new Error('Transaction hash is not part of this batch')
    const transaction = batch.transactions[index]
    if (!transaction?.receipt) return
    const { receipt: _receipt, ...withoutReceipt } = transaction
    const transactions = [...batch.transactions]
    transactions[index] = withoutReceipt
    this.writeBatch(batches, key, { ...batch, transactions, updatedAt: Math.max(now, batch.updatedAt) })
  }

  complete(origin: string, account: string, id: string, now = Date.now()) {
    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    if (batch.execution !== 'pending') throw new Error('Batch execution is already closed')
    if (
      batch.transactions.length !== batch.callCount ||
      batch.transactions.some((transaction) => transaction.state !== 'submitted')
    ) {
      throw new Error('Batch is missing transactions or contains unsubmitted reservations')
    }

    this.writeBatch(batches, key, {
      ...batch,
      execution: 'complete',
      updatedAt: Math.max(now, batch.updatedAt)
    })
  }

  fail(origin: string, account: string, id: string, now = Date.now()) {
    const batches = this.read(now)
    const [key, batch] = this.require(batches, origin, account, id)
    if (batch.execution !== 'pending') throw new Error('Batch execution is already closed')

    this.writeBatch(batches, key, {
      ...batch,
      execution: 'failed',
      updatedAt: Math.max(now, batch.updatedAt)
    })
    const operation = batch.operationId
      ? this.operationLifecycles?.get(batch.operationId, Math.min(now, batch.expiresAt - 1))
      : undefined
    if (batch.operationId && (operation || batch.transactions.length > 0)) {
      this.ensureOperation(batch as WalletCallBatchWithOperationId, now, 'failed')
    }
  }
}
