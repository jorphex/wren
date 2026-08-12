import { z } from 'zod'

export const MAX_OUTBOUND_ADDRESS_MEMORY = 500
export const OUTBOUND_ADDRESS_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u)

export const OutboundAddressMemoryEntrySchema = z
  .object({
    digest: DigestSchema,
    prefix: z.string().regex(/^[0-9a-f]{4}$/u),
    suffix: z.string().regex(/^[0-9a-f]{4}$/u),
    lastSubmittedAt: z.number().int().nonnegative()
  })
  .strict()

export const OutboundAddressMemorySchema = z
  .record(DigestSchema, OutboundAddressMemoryEntrySchema)
  .superRefine((entries, ctx) => {
    if (Object.keys(entries).length > MAX_OUTBOUND_ADDRESS_MEMORY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too many outbound address entries' })
    }
    for (const [digest, entry] of Object.entries(entries)) {
      if (entry.digest !== digest) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'outbound address digest key mismatch' })
      }
    }
  })

export type OutboundAddressMemoryEntry = z.infer<typeof OutboundAddressMemoryEntrySchema>
export type OutboundAddressMemory = z.infer<typeof OutboundAddressMemorySchema>

export const pruneOutboundAddressMemory = (value: unknown, now = Date.now()): OutboundAddressMemory => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const cutoff = Math.max(0, now - OUTBOUND_ADDRESS_RETENTION_MS)
  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([digest, candidate]) => {
        const parsed = OutboundAddressMemoryEntrySchema.safeParse(candidate)
        return parsed.success && parsed.data.digest === digest && parsed.data.lastSubmittedAt >= cutoff
          ? ([[digest, parsed.data]] as const)
          : []
      })
      .sort(
        (left, right) => right[1].lastSubmittedAt - left[1].lastSubmittedAt || left[0].localeCompare(right[0])
      )
      .slice(0, MAX_OUTBOUND_ADDRESS_MEMORY)
  )
}
