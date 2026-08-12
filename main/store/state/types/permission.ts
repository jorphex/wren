import { z } from 'zod'

const AddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/)
const MethodSchema = z.string().min(1).max(128)
const ChainSchema = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/)

export const PermissionScopeSchema = z
  .object({
    account: AddressSchema,
    methods: z.array(MethodSchema).min(1).max(64),
    chains: z.array(ChainSchema).max(64),
    expiresAt: z.number().int().positive()
  })
  .strict()

export const PermissionScopeCaveatSchema = z
  .object({
    type: z.literal('wren:permissionScope'),
    value: PermissionScopeSchema
  })
  .strict()

export const PermissionSchema = z
  .object({
    version: z.literal(1),
    origin: z.string(),
    provider: z.literal(true),
    handlerId: z.string(),
    parentCapability: z.literal('eth_accounts'),
    caveats: z.tuple([PermissionScopeCaveatSchema]),
    grantedAt: z.number().int().nonnegative()
  })
  .strict()

export type Permission = z.infer<typeof PermissionSchema>
export type PermissionScope = z.infer<typeof PermissionScopeSchema>
