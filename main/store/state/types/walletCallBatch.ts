import { z } from 'zod'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const MAX_RECEIPT_BYTES = 256 * 1024

export const PERSISTED_WALLET_CALL_BATCH_TTL_MS = 24 * 60 * 60 * 1000

const AddressSchema = z
  .string()
  .regex(ADDRESS)
  .transform((value) => value.toLowerCase())
const HashSchema = z
  .string()
  .regex(HASH)
  .transform((value) => value.toLowerCase())
const DataSchema = z
  .string()
  .max(MAX_RECEIPT_BYTES * 2 + 2)
  .regex(DATA)
  .transform((value) => value.toLowerCase())
const QuantitySchema = z
  .string()
  .max(66)
  .regex(QUANTITY)
  .transform((value) => value.toLowerCase())

const WalletCallLogSchema = z
  .object({
    address: AddressSchema,
    data: DataSchema,
    topics: z.array(HashSchema).max(4)
  })
  .strict()

export const WalletCallReceiptSchema = z
  .object({
    logs: z.array(WalletCallLogSchema).max(2048),
    status: z.enum(['0x0', '0x1']),
    type: z.enum(['0x0', '0x1', '0x2']).optional(),
    blockHash: HashSchema,
    blockNumber: QuantitySchema,
    gasUsed: QuantitySchema,
    effectiveGasPrice: QuantitySchema.optional(),
    transactionHash: HashSchema
  })
  .strict()

const WalletCallTransactionSchema = z
  .object({
    hash: HashSchema,
    state: z.enum(['signed', 'submitted']),
    receipt: WalletCallReceiptSchema.optional()
  })
  .strict()
  .superRefine((transaction, ctx) => {
    if (transaction.receipt && transaction.state !== 'submitted') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unsubmitted transaction has a receipt' })
    }
    if (transaction.receipt && transaction.receipt.transactionHash !== transaction.hash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'receipt transaction hash does not match' })
    }
  })

export const WalletCallBatchSchema = z
  .object({
    id: z.string().min(1).max(4096),
    operationId: z.uuid().optional(),
    origin: z.string().min(1).max(256),
    account: AddressSchema,
    chainId: QuantitySchema,
    atomic: z.literal(false),
    callCount: z.number().int().min(1).max(16),
    execution: z.enum(['pending', 'complete', 'failed']),
    transactions: z.array(WalletCallTransactionSchema).max(16),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict()
  .superRefine((batch, ctx) => {
    if (batch.updatedAt < batch.createdAt || batch.expiresAt <= batch.createdAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid batch timestamps' })
    }
    if (batch.expiresAt - batch.createdAt !== PERSISTED_WALLET_CALL_BATCH_TTL_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid batch expiry' })
    }
    if (Buffer.byteLength(batch.id, 'utf8') > 4096) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'batch id exceeds 4096 UTF-8 bytes' })
    }
    if (batch.transactions.length > batch.callCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too many batch transactions' })
    }
    const signedIndex = batch.transactions.findIndex((transaction) => transaction.state === 'signed')
    if (signedIndex >= 0 && signedIndex !== batch.transactions.length - 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'signed reservation is out of order' })
    }
    if (
      batch.execution === 'complete' &&
      (batch.transactions.length !== batch.callCount ||
        batch.transactions.some((transaction) => transaction.state !== 'submitted'))
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'completed batch is missing transactions' })
    }
  })

export const WalletCallBatchesSchema = z.record(z.string().regex(/^0x[0-9a-f]{64}$/), WalletCallBatchSchema)

export type WalletCallReceipt = z.infer<typeof WalletCallReceiptSchema>
export type WalletCallBatch = z.infer<typeof WalletCallBatchSchema>
export type WalletCallBatches = z.infer<typeof WalletCallBatchesSchema>
