import { z } from 'zod'

const Address = z.string().regex(/^0x[0-9a-f]{40}$/u)
const Hash = z.string().regex(/^0x[0-9a-f]{64}$/u)
const Height = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const ObservedActivitySchema = z
  .object({
    hash: Hash,
    from: Address,
    blockHash: Hash,
    blockNumber: Height,
    source: z.enum(['external', 'wren']),
    action: z.enum([
      'received',
      'sent',
      'transfer',
      'approve',
      'deposit',
      'withdraw',
      'redeem',
      'mint',
      'call',
      'deploy'
    ])
  })
  .strict()
export const AccountActivityCursorSchema = z
  .object({
    number: Height,
    hash: Hash,
    history: z.array(z.object({ number: Height, hash: Hash }).strict()).max(12),
    watchFrom: z.record(Address, Height).refine((value) => Object.keys(value).length <= 500),
    notified: z.array(Hash).max(1000)
  })
  .strict()
export type AccountActivityCursor = z.infer<typeof AccountActivityCursorSchema>
export type ObservedActivity = z.infer<typeof ObservedActivitySchema>
export type AccountActivityCursors = Record<string, AccountActivityCursor>
export function pruneAccountActivityCursors(value: unknown): AccountActivityCursors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .flatMap(([id, cursor]) => {
        const parsed = AccountActivityCursorSchema.safeParse(cursor)
        return /^[1-9][0-9]*$/u.test(id) && Number.isSafeInteger(Number(id)) && parsed.success
          ? [[id, parsed.data]]
          : []
      })
  )
}
