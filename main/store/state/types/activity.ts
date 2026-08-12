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
    outcome: z.enum(['completed', 'declined', 'failed', 'submitted', 'confirmed', 'dropped']),
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

export const ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export const pruneActivity = (activity: unknown, now = Date.now()) => {
  if (!Array.isArray(activity)) return []
  const cutoff = now - ACTIVITY_RETENTION_MS
  return activity
    .flatMap((entry) => {
      const parsed = ActivityEntrySchema.safeParse(entry)
      return parsed.success && parsed.data.completedAt >= cutoff ? [parsed.data] : []
    })
    .sort((left, right) => right.completedAt - left.completedAt || right.id.localeCompare(left.id))
    .slice(0, 500)
}

export type ActivityEntry = z.infer<typeof ActivityEntrySchema>
