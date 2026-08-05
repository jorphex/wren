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
  on: z.boolean(),
  connected: z.boolean(),
  current: z.enum(presetValues),
  status: z.enum(statusValues),
  custom: z.string().default('')
})

export type Connection = z.infer<typeof ConnectionSchema>
