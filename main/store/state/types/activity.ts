import { z } from 'zod'

const AddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/u)
const HashSchema = z.string().regex(/^0x[0-9a-f]{64}$/u)

export const ActivityEntrySchema = z
  .object({
    id: z.uuid(),
    account: AddressSchema,
    origin: z.string().min(1).max(256),
    type: z.enum([
      'sign',
      'signTypedData',
      'signErc20Permit',
      'transaction',
      'access',
      'addChain',
      'addToken',
      'walletCalls',
      'eip7702Revoke'
    ]),
    outcome: z.enum(['completed', 'declined', 'failed', 'submitted', 'confirmed']),
    createdAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative(),
    chainId: z.number().int().positive().optional(),
    transactionHash: HashSchema.optional()
  })
  .strict()
  .refine((entry) => entry.completedAt >= entry.createdAt, {
    message: 'Activity completion cannot predate creation'
  })

export const ActivitySchema = z.array(ActivityEntrySchema).max(500)

export type ActivityEntry = z.infer<typeof ActivityEntrySchema>
