import { z } from 'zod'

import { MAX_RECENT_RECIPIENT_USES, RECENT_RECIPIENT_RETENTION_MS } from './constants'

export { MAX_RECENT_RECIPIENT_USES, RECENT_RECIPIENT_RETENTION_MS } from './constants'

const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => value.toLowerCase())

export const RecentRecipientUseSchema = z
  .object({
    operationId: z.uuid(),
    address: AddressSchema,
    confirmedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()

export const RecentRecipientUsesSchema = z
  .array(RecentRecipientUseSchema)
  .max(MAX_RECENT_RECIPIENT_USES)
  .superRefine((uses, context) => {
    const operationIds = new Set<string>()
    for (const [index, use] of uses.entries()) {
      if (operationIds.has(use.operationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate recent-recipient operation',
          path: [index, 'operationId']
        })
      }
      operationIds.add(use.operationId)
    }
  })

export type RecentRecipientUse = z.infer<typeof RecentRecipientUseSchema>
export type RecentRecipientUses = z.infer<typeof RecentRecipientUsesSchema>

const newestFirst = (left: RecentRecipientUse, right: RecentRecipientUse) =>
  right.confirmedAt - left.confirmedAt || right.operationId.localeCompare(left.operationId)

export function pruneRecentRecipientUses(value: unknown, now = Date.now()): RecentRecipientUses {
  if (!Array.isArray(value)) return []
  const cutoff = Math.max(0, now - RECENT_RECIPIENT_RETENTION_MS)
  const operationIds = new Set<string>()

  return value
    .flatMap((candidate) => {
      const parsed = RecentRecipientUseSchema.safeParse(candidate)
      if (!parsed.success || parsed.data.confirmedAt < cutoff || parsed.data.confirmedAt > now) {
        return []
      }
      return [parsed.data]
    })
    .sort(newestFirst)
    .filter(({ operationId }) => {
      if (operationIds.has(operationId)) return false
      operationIds.add(operationId)
      return true
    })
    .slice(0, MAX_RECENT_RECIPIENT_USES)
}

export function addRecentRecipientUse(
  current: unknown,
  candidate: unknown,
  now = Date.now()
): RecentRecipientUses {
  const use = RecentRecipientUseSchema.parse(candidate)
  if (use.confirmedAt > now || use.confirmedAt < Math.max(0, now - RECENT_RECIPIENT_RETENTION_MS)) {
    return pruneRecentRecipientUses(current, now)
  }
  const pruned = pruneRecentRecipientUses(current, now)
  return pruneRecentRecipientUses(
    [use, ...pruned.filter(({ operationId }) => operationId !== use.operationId)],
    now
  )
}

export function removeRecentRecipientUse(
  current: unknown,
  operationId: string,
  now = Date.now()
): RecentRecipientUses {
  return pruneRecentRecipientUses(current, now).filter((use) => use.operationId !== operationId)
}

export function projectRecentRecipients(value: unknown, now = Date.now()): RecentRecipientUse[] {
  const addresses = new Set<string>()
  return pruneRecentRecipientUses(value, now).filter(({ address }) => {
    if (addresses.has(address)) return false
    addresses.add(address)
    return true
  })
}
