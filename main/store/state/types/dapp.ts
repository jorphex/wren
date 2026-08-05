import { z } from 'zod'

const ManifestSchema = z.record(z.string(), z.unknown())

export const DappSchema = z.object({
  id: z.string().optional(),
  ens: z.string(),
  status: z.enum(['initial', 'loading', 'updating', 'ready', 'failed']),
  config: z.record(z.string(), z.string()),
  content: z.string().optional(),
  manifest: ManifestSchema.optional(),
  openWhenReady: z.boolean().default(false),
  checkStatusRetryCount: z.number().gte(0).default(0)
})

export type Dapp = z.infer<typeof DappSchema>
