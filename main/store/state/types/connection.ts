import { z } from 'zod'

const statusValues = [
  'connected',
  'disconnected',
  'degraded',
  'loading',
  'pending',
  'syncing',
  'standby',
  'off',
  'error',
  'chain mismatch'
] as const

const presetValues = ['local', 'custom', 'publicnode'] as const

export const ConnectionSchema = z.object({
  id: z.string().min(1).max(64),
  on: z.boolean(),
  connected: z.boolean(),
  current: z.enum(presetValues),
  status: z.enum(statusValues),
  custom: z.string().default(''),
  type: z.string().optional(),
  network: z.string().optional(),
  latencyMs: z.number().finite().nonnegative().optional()
})

export type Connection = z.infer<typeof ConnectionSchema>
