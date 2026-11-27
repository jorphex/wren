import { z } from 'zod'

export const YEARN_CHAIN_IDS = [1, 8453] as const
export const YEARN_WORKFLOW_POLICY_VERSION = 1
export type YearnChainId = (typeof YEARN_CHAIN_IDS)[number]

const RETIRED_KATANA_CHAIN_ID = 747474
export const YearnChainIdSchema = z.literal(YEARN_CHAIN_IDS)
export const YearnAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

export const YearnAssetSchema = z
  .object({
    address: YearnAddressSchema,
    name: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    decimals: z.number().int().min(0).max(255)
  })
  .strict()

export const YearnApySchema = z
  .object({
    value: z.number().finite().nonnegative().nullable(),
    label: z.enum(['Est. APY', 'Historical APY', 'Unavailable']),
    source: z.string().min(1).max(64),
    baseValue: z.number().finite().nonnegative().nullable().optional(),
    appRewardsValue: z.number().finite().nonnegative().nullable().optional()
  })
  .strict()

export const YearnVaultVariantSchema = z
  .object({
    id: z.enum(['direct', 'unlocked', 'locked', 'staked']),
    address: YearnAddressSchema,
    name: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    asset: YearnAssetSchema,
    decimals: z.number().int().min(0).max(255),
    tvlUsd: z.number().finite().nonnegative(),
    apy: YearnApySchema
  })
  .strict()

export const YearnVaultSchema = z
  .object({
    id: z.string().min(1).max(128),
    chainId: YearnChainIdSchema,
    chainName: z.enum(['Ethereum', 'Base']),
    address: YearnAddressSchema,
    kind: z.enum(['direct', 'yvUSD', 'yBOLD']),
    name: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    description: z.string().min(1).max(1024),
    asset: YearnAssetSchema,
    decimals: z.number().int().min(0).max(255),
    tvlUsd: z.number().finite().nonnegative(),
    apy: YearnApySchema,
    riskLevel: z.number().int().min(1).max(5).nullable(),
    riskLabel: z.enum(['Conservative', 'Moderate', 'Aggressive', 'Unrated']),
    performanceFeeBps: z.number().int().min(0).max(10_000),
    managementFeeBps: z.number().int().min(0).max(10_000),
    inceptionTime: z.number().int().nonnegative().nullable(),
    yearnUrl: z.string().url().max(8192),
    status: z.enum(['available', 'unavailable', 'withdraw-only']),
    statusReason: z.string().min(1).max(240).optional(),
    variants: z.array(YearnVaultVariantSchema).min(1).max(3)
  })
  .strict()

const RetiredKatanaVaultSchema = YearnVaultSchema.extend({
  chainId: z.literal(RETIRED_KATANA_CHAIN_ID),
  chainName: z.literal('Katana')
})

export const StoredYearnCatalogCacheSchema = z
  .object({
    version: z.literal(2),
    fetchedAt: z.number().int().nonnegative(),
    vaults: z.array(z.union([YearnVaultSchema, RetiredKatanaVaultSchema])).max(16)
  })
  .strict()

export const YearnCatalogCacheSchema = StoredYearnCatalogCacheSchema.transform(({ vaults, ...cache }) => ({
  ...cache,
  vaults: vaults.filter((vault) => vault.chainId !== RETIRED_KATANA_CHAIN_ID)
}))

export const YearnCatalogResultSchema = z
  .object({
    status: z.enum(['fresh', 'stale', 'unavailable']),
    fetchedAt: z.number().int().nonnegative().nullable(),
    vaults: z.array(YearnVaultSchema).max(16),
    errors: z
      .array(
        z
          .object({
            chainId: YearnChainIdSchema.optional(),
            message: z.string().min(1).max(240)
          })
          .strict()
      )
      .max(16)
  })
  .strict()

const BaseUnitAmountSchema = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)

export const YearnPositionVariantSchema = z
  .object({
    id: z.enum(['direct', 'unlocked', 'locked', 'staked']),
    address: YearnAddressSchema,
    symbol: z.string().min(1).max(32),
    decimals: z.number().int().min(0).max(255),
    sharesRaw: BaseUnitAmountSchema,
    shares: z.string().min(1).max(96),
    assetSymbol: z.string().min(1).max(32),
    assetDecimals: z.number().int().min(0).max(255),
    assetsRaw: BaseUnitAmountSchema.nullable(),
    assets: z.string().min(1).max(96).nullable(),
    cooldown: z
      .object({
        status: z.enum(['none', 'cooling-down', 'withdrawal-window', 'expired']),
        sharesRaw: BaseUnitAmountSchema,
        shares: z.string().min(1).max(96),
        cooldownEnd: z.number().int().nonnegative(),
        windowEnd: z.number().int().nonnegative(),
        cooldownDuration: z.number().int().nonnegative(),
        withdrawalWindow: z.number().int().nonnegative()
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict()

export const YearnPositionSchema = z
  .object({
    vaultId: z.string().min(1).max(128),
    chainId: YearnChainIdSchema,
    status: z.enum(['available', 'unavailable', 'withdraw-only']),
    hasPosition: z.boolean(),
    assetBalanceRaw: BaseUnitAmountSchema.nullable(),
    assetBalance: z.string().min(1).max(96).nullable(),
    variants: z.array(YearnPositionVariantSchema).min(1).max(3),
    error: z.string().min(1).max(240).optional()
  })
  .strict()

export const YearnPositionChainSchema = z
  .object({
    chainId: YearnChainIdSchema,
    status: z.enum(['no-account', 'disabled', 'disconnected', 'ready', 'partial', 'error']),
    reason: z.string().min(1).max(240).optional(),
    positions: z.array(YearnPositionSchema).max(8)
  })
  .strict()

export const YearnPositionsResultSchema = z
  .object({
    account: z
      .object({
        address: YearnAddressSchema,
        name: z.string().max(128),
        readOnly: z.boolean()
      })
      .strict()
      .nullable(),
    chains: z.array(YearnPositionChainSchema).length(YEARN_CHAIN_IDS.length)
  })
  .strict()

export const YearnWorkflowActionSchema = z.enum([
  'deposit',
  'withdraw',
  'stake',
  'start-cooldown',
  'cancel-cooldown',
  'revoke'
])
export const YearnWorkflowStepKindSchema = z.enum([
  'approve',
  'deposit',
  'withdraw',
  'redeem',
  'stake',
  'start-cooldown',
  'cancel-cooldown',
  'revoke'
])
export const YearnReceiptTransferSchema = z
  .object({
    token: YearnAddressSchema,
    direction: z.enum(['in', 'out']),
    amountRaw: BaseUnitAmountSchema,
    symbol: z.string().min(1).max(32),
    decimals: z.number().int().min(0).max(255)
  })
  .strict()
export const YearnWorkflowStepSchema = z
  .object({
    id: z.string().uuid(),
    kind: YearnWorkflowStepKindSchema,
    label: z.string().min(1).max(96),
    target: YearnAddressSchema,
    data: z.string().regex(/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2}){0,16380}$/),
    amountRaw: BaseUnitAmountSchema,
    status: z.enum(['pending', 'ready', 'awaiting-review', 'submitted', 'confirmed', 'error', 'canceled']),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    error: z.string().min(1).max(240).optional(),
    approvalToken: YearnAddressSchema.optional(),
    approvalSpender: YearnAddressSchema.optional(),
    receiptTransfers: z.array(YearnReceiptTransferSchema).max(8).optional(),
    receiptTransfersTruncated: z.boolean().optional()
  })
  .strict()

export const YearnWorkflowSchema = z
  .object({
    policyVersion: z.literal(YEARN_WORKFLOW_POLICY_VERSION),
    id: z.string().uuid(),
    parentWorkflowId: z.string().uuid().optional(),
    account: YearnAddressSchema,
    vaultId: z.string().min(1).max(128),
    // Older Earn workflows remain valid saved records after Katana is retired.
    chainId: z.union([YearnChainIdSchema, z.literal(RETIRED_KATANA_CHAIN_ID)]),
    action: YearnWorkflowActionSchema,
    variant: z.enum(['direct', 'unlocked', 'locked', 'staked']),
    amountRaw: BaseUnitAmountSchema,
    displayAmount: z.string().min(1).max(96),
    symbol: z.string().min(1).max(32),
    max: z.boolean(),
    maxLossBps: z.literal(0),
    cleanupRecovery: z.enum(['unknown-outcome', 'allowance-nonzero']).optional(),
    status: z.enum(['ready', 'active', 'waiting-confirmation', 'complete', 'error', 'canceled']),
    steps: z.array(YearnWorkflowStepSchema).min(1).max(4),
    currentStep: z.number().int().min(0).max(3),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    error: z.string().min(1).max(240).optional()
  })
  .strict()
  .superRefine((workflow, context) => {
    if (!workflow.cleanupRecovery) return
    const step = workflow.steps[workflow.currentStep]
    if (
      workflow.action !== 'revoke' ||
      workflow.status !== 'canceled' ||
      workflow.amountRaw !== '0' ||
      !step ||
      step.kind !== 'revoke' ||
      step.amountRaw !== '0'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cleanupRecovery'],
        message: 'Cleanup recovery must describe a canceled zero-allowance revoke'
      })
    }
  })

export const YearnWorkflowsSchema = z.record(z.string().uuid(), YearnWorkflowSchema)
export const YearnWorkflowRequestSchema = z
  .object({
    vaultId: z.string().min(1).max(128),
    action: z.enum(['deposit', 'withdraw', 'stake', 'start-cooldown', 'cancel-cooldown']),
    variant: z.enum(['direct', 'unlocked', 'locked', 'staked']),
    amount: z
      .string()
      .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
      .max(96),
    max: z.boolean()
  })
  .strict()
export const YearnWorkflowResultSchema = z.object({ workflow: YearnWorkflowSchema }).strict()
export const YearnWorkflowIdRequestSchema = z.object({ id: z.string().uuid() }).strict()
export const YearnWorkflowMutationResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), workflow: YearnWorkflowSchema }).strict(),
  z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
])
export const YearnWorkflowListResultSchema = z
  .object({ workflows: z.array(YearnWorkflowSchema).max(64) })
  .strict()

export type YearnAsset = z.infer<typeof YearnAssetSchema>
export type YearnApy = z.infer<typeof YearnApySchema>
export type YearnVaultVariant = z.infer<typeof YearnVaultVariantSchema>
export type YearnVault = z.infer<typeof YearnVaultSchema>
export type YearnCatalogCache = z.infer<typeof YearnCatalogCacheSchema>
export type YearnCatalogResult = z.infer<typeof YearnCatalogResultSchema>
export type YearnPositionVariant = z.infer<typeof YearnPositionVariantSchema>
export type YearnPosition = z.infer<typeof YearnPositionSchema>
export type YearnPositionChain = z.infer<typeof YearnPositionChainSchema>
export type YearnPositionsResult = z.infer<typeof YearnPositionsResultSchema>
export type YearnWorkflowAction = z.infer<typeof YearnWorkflowActionSchema>
export type YearnWorkflowStepKind = z.infer<typeof YearnWorkflowStepKindSchema>
export type YearnReceiptTransfer = z.infer<typeof YearnReceiptTransferSchema>
export type YearnWorkflowStep = z.infer<typeof YearnWorkflowStepSchema>
export type YearnWorkflow = z.infer<typeof YearnWorkflowSchema>
export type YearnWorkflows = z.infer<typeof YearnWorkflowsSchema>
export type YearnWorkflowRequest = z.infer<typeof YearnWorkflowRequestSchema>
export type YearnWorkflowIdRequest = z.infer<typeof YearnWorkflowIdRequestSchema>
export type YearnWorkflowMutationResult = z.infer<typeof YearnWorkflowMutationResultSchema>
