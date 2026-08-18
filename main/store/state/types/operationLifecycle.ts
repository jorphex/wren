import { z } from 'zod'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u
const HASH = /^0x[0-9a-fA-F]{64}$/u
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u

export const MAX_OPERATION_LIFECYCLES = 500
export const MAX_OPERATION_LIFECYCLE_AGE_MS = 30 * 24 * 60 * 60 * 1000

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
const OriginSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 256, 'origin exceeds 256 UTF-8 bytes')

const NotificationStateSchema = z
  .object({
    terminalHandledAt: z.number().int().nonnegative().optional(),
    longPendingShownAt: z.number().int().nonnegative().optional()
  })
  .strict()

const ReceiptEvidenceSchema = z
  .object({
    transactionHash: HashSchema,
    blockHash: HashSchema,
    blockNumber: QuantitySchema,
    status: z.enum(['0x0', '0x1'])
  })
  .strict()

const SettlementSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('monitoring') }).strict(),
  z
    .object({
      status: z.literal('complete'),
      basis: z.enum(['finalized', 'confirmations', 'expired'])
    })
    .strict()
])

export const OperationLifecycleSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['transaction', 'walletCalls', 'eip7702Revoke']),
    account: AddressSchema,
    origin: OriginSchema,
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum([
      'submitted',
      'confirming',
      'confirmed',
      'failed',
      'replaced',
      'reorged',
      'stopped',
      'clearance-unverified',
      'verified-clearance'
    ]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    visibleInActivity: z.boolean(),
    notification: NotificationStateSchema,
    transaction: z
      .object({ hash: HashSchema, nonce: QuantitySchema, replacementOf: z.uuid().optional() })
      .strict()
      .optional(),
    replacement: z.object({ operationId: z.uuid() }).strict().optional(),
    walletCalls: z.object({ batchOperationId: z.uuid() }).strict().optional(),
    eip7702Revoke: z.object({ hash: HashSchema, expectedFinalNonce: QuantitySchema }).strict().optional(),
    receipt: ReceiptEvidenceSchema.optional(),
    settlement: SettlementSchema.optional()
  })
  .strict()
  .superRefine((operation, ctx) => {
    if (
      operation.updatedAt < operation.createdAt ||
      operation.expiresAt <= operation.createdAt ||
      operation.updatedAt > operation.expiresAt ||
      operation.expiresAt - operation.createdAt > MAX_OPERATION_LIFECYCLE_AGE_MS
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid operation lifecycle timestamps' })
    }

    const evidence = [operation.transaction, operation.walletCalls, operation.eip7702Revoke].filter(Boolean)
    const expectedEvidence =
      (operation.kind === 'transaction' && operation.transaction) ||
      (operation.kind === 'walletCalls' && operation.walletCalls) ||
      (operation.kind === 'eip7702Revoke' && operation.eip7702Revoke)
    if (evidence.length !== 1 || !expectedEvidence) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'operation evidence does not match its kind' })
    }

    const operationHash = operation.transaction?.hash ?? operation.eip7702Revoke?.hash
    if (operation.receipt && operation.receipt.transactionHash !== operationHash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'receipt transaction hash does not match' })
    }

    if (
      operation.settlement &&
      (operation.kind === 'eip7702Revoke' || !['confirmed', 'failed'].includes(operation.state))
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid background settlement state' })
    }
    if (operation.kind === 'transaction' && operation.settlement && !operation.receipt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'transaction settlement requires a receipt' })
    }
    if (
      operation.replacement &&
      (operation.kind !== 'transaction' ||
        operation.state !== 'replaced' ||
        operation.settlement ||
        operation.replacement.operationId === operation.id)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid transaction replacement evidence' })
    }
    if (operation.transaction?.replacementOf === operation.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'transaction cannot replace itself' })
    }

    for (const timestamp of [
      operation.notification.terminalHandledAt,
      operation.notification.longPendingShownAt
    ]) {
      if (timestamp !== undefined && (timestamp < operation.createdAt || timestamp > operation.expiresAt)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid notification timestamp' })
      }
    }
  })

export const OperationLifecyclesSchema = z
  .record(z.uuid(), OperationLifecycleSchema)
  .refine((operations) => Object.keys(operations).length <= MAX_OPERATION_LIFECYCLES, {
    message: 'too many operation lifecycles'
  })

export type OperationLifecycle = z.infer<typeof OperationLifecycleSchema>
export type OperationLifecycles = z.infer<typeof OperationLifecyclesSchema>

export const pruneOperationLifecycles = (value: unknown, now = Date.now()): OperationLifecycles => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([id, candidate]) => {
        const parsed = OperationLifecycleSchema.safeParse(candidate)
        return parsed.success && parsed.data.id === id && parsed.data.expiresAt > now
          ? [[id, parsed.data] as const]
          : []
      })
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt || right[0].localeCompare(left[0]))
      .slice(0, MAX_OPERATION_LIFECYCLES)
  )
}
