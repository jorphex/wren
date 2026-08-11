import { z } from 'zod'

export const AccountMetadataSchema = z
  .object({
    name: z.string(),
    lastUpdated: z.number().int().nonnegative()
  })
  .passthrough()

export const AccountSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    lastSignerType: z.string().optional(),
    active: z.boolean().optional(),
    address: z.string().optional(),
    status: z.string().optional(),
    signer: z.string().optional(),
    requests: z.record(z.string(), z.unknown()).optional(),
    activeRequestId: z.string().nullable().optional(),
    ensName: z.string().optional(),
    created: z.string().optional(),
    balances: z
      .object({
        lastUpdated: z.number().int().nonnegative().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

export type AccountMetadata = z.infer<typeof AccountMetadataSchema>
export type Account = z.infer<typeof AccountSchema>
