import { z } from 'zod'
import { ChainIdSchema } from './chain'

const SessionSchema = z.object({
  requests: z.number().gte(0),
  startedAt: z.number().gte(0),
  endedAt: z.number().gte(0).optional(),
  lastUpdatedAt: z.number().gte(0)
})

export const OriginSchema = z.object({
  chain: ChainIdSchema,
  name: z.string(),
  provenance: z.enum(['direct', 'companion', 'native', 'internal', 'managed', 'legacy']).default('legacy'),
  sourceId: z.string().min(1).max(256).optional(),
  sessionOnly: z.boolean().default(false),
  session: SessionSchema
})

export type Session = z.infer<typeof SessionSchema>
export type Origin = z.infer<typeof OriginSchema>
