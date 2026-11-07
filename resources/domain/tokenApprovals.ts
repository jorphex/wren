import { z } from 'zod'

import { MAX_OBSERVED_TOKEN_APPROVALS, TOKEN_APPROVAL_RETENTION_MS } from './tokenApprovalsLimits'
export {
  MAX_OBSERVED_TOKEN_APPROVALS,
  MAX_TOKEN_APPROVAL_REFRESH,
  TOKEN_APPROVAL_RETENTION_MS
} from './tokenApprovalsLimits'
const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => value.toLowerCase())

export const TokenApprovalObservationSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{64}$/u),
    account: Address,
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    token: Address,
    spender: Address,
    transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/u),
    submittedTransactionHash: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/u)
      .optional(),
    observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()

export type TokenApprovalObservation = z.infer<typeof TokenApprovalObservationSchema>

const VisibleObservation = TokenApprovalObservationSchema.omit({
  transactionHash: true,
  submittedTransactionHash: true
})
export const TokenApprovalViewSchema = z.discriminatedUnion('status', [
  VisibleObservation.extend({
    status: z.literal('current'),
    amount: z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/u),
    checkedAt: z.number().int().nonnegative()
  }),
  VisibleObservation.extend({ status: z.enum(['unchecked', 'unavailable', 'network-off']) })
])
export type TokenApprovalView = z.infer<typeof TokenApprovalViewSchema>

export const pruneObservedTokenApprovals = (input: unknown, now = Date.now()): TokenApprovalObservation[] => {
  if (!Array.isArray(input)) return []
  const records = input
    .slice(0, MAX_OBSERVED_TOKEN_APPROVALS * 4)
    .flatMap((value) => {
      const parsed = TokenApprovalObservationSchema.safeParse(value)
      return parsed.success &&
        parsed.data.observedAt <= now &&
        now - parsed.data.observedAt < TOKEN_APPROVAL_RETENTION_MS
        ? [parsed.data]
        : []
    })
    .sort((left, right) => right.observedAt - left.observedAt)
  const ids = new Set<string>()
  return records
    .filter(({ id }) => {
      if (ids.has(id)) return false
      ids.add(id)
      return true
    })
    .slice(0, MAX_OBSERVED_TOKEN_APPROVALS)
}
