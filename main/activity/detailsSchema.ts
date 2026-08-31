import { z } from 'zod'

const MAX_TRANSACTION_INPUT_BYTES = 256 * 1024
const MAX_SAFE_ARGUMENTS = 16
const AddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/u)
const HashSchema = z.string().regex(/^0x[0-9a-f]{64}$/u)
const DecimalQuantitySchema = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/u)

const ActivityActionArgumentSchema = z
  .object({
    name: z.string().min(1).max(64),
    type: z.string().min(1).max(32),
    value: z.string().min(1).max(128)
  })
  .strict()

export const ActivityTransactionActionSchema = z
  .object({
    transactionHash: HashSchema,
    kind: z.enum(['native-value-transfer', 'contract-call', 'contract-deployment', 'transaction']),
    from: AddressSchema,
    to: AddressSchema.nullable(),
    value: DecimalQuantitySchema,
    inputBytes: z.number().int().nonnegative().max(MAX_TRANSACTION_INPUT_BYTES),
    selector: z
      .string()
      .regex(/^0x[0-9a-f]{8}$/u)
      .optional(),
    method: z.string().min(1).max(128).optional(),
    signature: z.string().min(1).max(256).optional(),
    arguments: z.array(ActivityActionArgumentSchema).max(MAX_SAFE_ARGUMENTS),
    argumentsTruncated: z.boolean().optional()
  })
  .strict()

export const ActivityDetailsResultSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      actions: z.array(ActivityTransactionActionSchema).min(1).max(16),
      partial: z.boolean()
    })
    .strict(),
  z
    .object({
      success: z.literal(false),
      error: z.enum(['evidence-unavailable', 'lookup-failed', 'not-found'])
    })
    .strict()
])

export type ActivityDetailsResult = z.infer<typeof ActivityDetailsResultSchema>
export type ActivityTransactionAction = z.infer<typeof ActivityTransactionActionSchema>
