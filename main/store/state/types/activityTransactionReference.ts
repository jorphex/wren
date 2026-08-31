import { z } from 'zod'

import { ACTIVITY_RETENTION_MS } from './activity'
import type { OperationLifecycle } from './operationLifecycle'
import type { WalletCallBatch } from './walletCallBatch'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const HASH = /^0x[0-9a-fA-F]{64}$/u
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u

export const MAX_ACTIVITY_TRANSACTION_REFERENCES = 500
export const MAX_ACTIVITY_REFERENCE_TRANSACTIONS = 16

const AddressSchema = z
  .string()
  .regex(ADDRESS)
  .transform((value) => value.toLowerCase())
const HashSchema = z
  .string()
  .regex(HASH)
  .transform((value) => value.toLowerCase())
const QuantitySchema = z
  .string()
  .max(66)
  .regex(QUANTITY)
  .transform((value) => value.toLowerCase())

const CanonicalBlockSchema = z
  .object({
    hash: HashSchema,
    number: QuantitySchema
  })
  .strict()

const ActivityTransactionTargetSchema = z
  .object({
    hash: HashSchema,
    canonicalBlock: CanonicalBlockSchema.optional()
  })
  .strict()

export const ActivityTransactionReferenceSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['transaction', 'walletCalls', 'eip7702Revoke']),
    account: AddressSchema,
    origin: z.string().min(1).max(256),
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    transactions: z.array(ActivityTransactionTargetSchema).min(1).max(MAX_ACTIVITY_REFERENCE_TRANSACTIONS)
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.expiresAt - reference.updatedAt !== ACTIVITY_RETENTION_MS) {
      context.addIssue({ code: 'custom', message: 'invalid Activity transaction reference expiry' })
    }
    const hashes = reference.transactions.map(({ hash }) => hash)
    if (new Set(hashes).size !== hashes.length) {
      context.addIssue({ code: 'custom', message: 'duplicate Activity transaction reference hash' })
    }
  })

export const ActivityTransactionReferencesSchema = z
  .record(z.uuid(), ActivityTransactionReferenceSchema)
  .superRefine((references, context) => {
    if (Object.keys(references).length > MAX_ACTIVITY_TRANSACTION_REFERENCES) {
      context.addIssue({ code: 'custom', message: 'too many Activity transaction references' })
    }
    Object.entries(references).forEach(([id, reference]) => {
      if (reference.id !== id) {
        context.addIssue({ code: 'custom', message: 'Activity transaction reference key does not match' })
      }
    })
  })

export type ActivityTransactionReference = z.infer<typeof ActivityTransactionReferenceSchema>
export type ActivityTransactionReferences = z.infer<typeof ActivityTransactionReferencesSchema>

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const pruneActivityTransactionReferences = (
  value: unknown,
  now = Date.now()
): ActivityTransactionReferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([id, candidate]) => {
        const parsed = ActivityTransactionReferenceSchema.safeParse(candidate)
        return parsed.success && parsed.data.id === id && parsed.data.expiresAt >= now
          ? [[id, parsed.data] as const]
          : []
      })
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt || right[0].localeCompare(left[0]))
      .slice(0, MAX_ACTIVITY_TRANSACTION_REFERENCES)
  )
}

const sameIdentity = (left: ActivityTransactionReference, right: ActivityTransactionReference) =>
  left.id === right.id &&
  left.kind === right.kind &&
  left.account === right.account &&
  left.origin === right.origin &&
  left.chainId === right.chainId

const existingHashesArePrefix = (
  current: ActivityTransactionReference,
  candidate: ActivityTransactionReference
) => current.transactions.every(({ hash }, index) => candidate.transactions[index]?.hash === hash)

export const recordActivityTransactionReference = (
  value: unknown,
  candidate: unknown,
  now = Date.now()
): ActivityTransactionReferences => {
  const references = pruneActivityTransactionReferences(value, now)
  const parsed = ActivityTransactionReferenceSchema.safeParse(candidate)
  if (!parsed.success || parsed.data.expiresAt < now) return references

  const current = references[parsed.data.id]
  if (current) {
    if (!sameIdentity(current, parsed.data) || !existingHashesArePrefix(current, parsed.data)) {
      throw new Error('Activity transaction reference identity cannot change')
    }
    if (parsed.data.updatedAt < current.updatedAt) return references
  }

  return pruneActivityTransactionReferences({ ...references, [parsed.data.id]: clone(parsed.data) }, now)
}

const canonicalBlock = (receipt: { blockHash: string; blockNumber: string } | undefined) =>
  receipt ? { hash: receipt.blockHash, number: receipt.blockNumber } : undefined

const transactionTarget = (hash: string, receipt: { blockHash: string; blockNumber: string } | undefined) => {
  const block = canonicalBlock(receipt)
  return { hash, ...(block ? { canonicalBlock: block } : {}) }
}

const matchingBatch = (operation: OperationLifecycle, batches: Record<string, WalletCallBatch>) => {
  const operationId = operation.walletCalls?.batchOperationId
  if (!operationId) return
  return Object.values(batches).find(
    (batch) =>
      batch.operationId === operationId &&
      batch.account === operation.account &&
      batch.origin === operation.origin &&
      Number(BigInt(batch.chainId)) === operation.chainId
  )
}

export const activityTransactionReferenceForOperation = (
  operation: OperationLifecycle,
  batches: Record<string, WalletCallBatch> = {}
): ActivityTransactionReference | undefined => {
  const operationHash = operation.transaction?.hash ?? operation.eip7702Revoke?.hash
  const batch = operation.kind === 'walletCalls' ? matchingBatch(operation, batches) : undefined
  const transactions = operationHash
    ? [transactionTarget(operationHash, operation.receipt)]
    : batch
      ? batch.transactions.flatMap((transaction) =>
          transaction.state === 'submitted' ? [transactionTarget(transaction.hash, transaction.receipt)] : []
        )
      : []
  if (!transactions.length) return

  const updatedAt = Math.max(operation.updatedAt, batch?.updatedAt ?? 0)
  return ActivityTransactionReferenceSchema.parse({
    id: operation.id,
    kind: operation.kind,
    account: operation.account,
    origin: operation.origin,
    chainId: operation.chainId,
    updatedAt,
    expiresAt: updatedAt + ACTIVITY_RETENTION_MS,
    transactions
  })
}
