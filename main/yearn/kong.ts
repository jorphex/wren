import { z } from 'zod'

import {
  YearnCatalogCacheSchema,
  type YearnApy,
  type YearnCatalogCache,
  type YearnVault,
  type YearnVaultVariant
} from '../../resources/domain/yearn'
import { YEARN_CATALOG, YEARN_CATALOG_VERSION, type YearnCatalogDefinition, yearnVaultKey } from './catalog'

const KongAssetSchema = z
  .object({
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    name: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    decimals: z.number().int().min(0).max(255)
  })
  .passthrough()

const OptionalRateSchema = z.number().finite().nullable().optional()
const KongVaultSchema = z
  .object({
    chainId: z.number().int().positive(),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    name: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    kind: z.string().nullable(),
    origin: z.string().optional(),
    inclusion: z.object({ isYearn: z.boolean().optional() }).passthrough().optional(),
    isHidden: z.boolean().optional(),
    isRetired: z.boolean().optional(),
    isHighlighted: z.boolean().optional(),
    asset: KongAssetSchema,
    decimals: z.number().int().min(0).max(255),
    tvl: z.number().finite().nonnegative(),
    riskLevel: z.number().int().min(1).max(5).nullable().optional(),
    fees: z
      .object({
        managementFee: z.number().int().min(0).max(10_000).optional(),
        performanceFee: z.number().int().min(0).max(10_000).optional()
      })
      .passthrough()
      .optional(),
    performance: z
      .object({
        estimated: z
          .object({
            apy: OptionalRateSchema,
            apr: OptionalRateSchema,
            type: z.string().max(64).optional(),
            components: z
              .object({
                katanaNativeYield: OptionalRateSchema,
                katanaAppRewardsAPR: OptionalRateSchema
              })
              .passthrough()
              .optional()
          })
          .passthrough()
          .nullable()
          .optional(),
        oracle: z
          .object({ netAPY: OptionalRateSchema, apy: OptionalRateSchema })
          .passthrough()
          .nullable()
          .optional(),
        historical: z
          .object({ monthlyNet: OptionalRateSchema, weeklyNet: OptionalRateSchema })
          .passthrough()
          .nullable()
          .optional()
      })
      .passthrough()
      .optional(),
    inceptTime: z.number().int().nonnegative().nullable().optional()
  })
  .passthrough()

type KongVault = z.infer<typeof KongVaultSchema>

export interface CatalogNormalizationError {
  chainId?: 1 | 8453 | 747474
  message: string
}

const finiteRate = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export function resolveYearnApy(vault: KongVault): YearnApy {
  const estimated = finiteRate(vault.performance?.estimated?.apy)
  if (estimated !== null) {
    const components = vault.performance?.estimated?.components
    return {
      value: estimated,
      label: 'Est. APY',
      source: vault.performance?.estimated?.type || 'estimated',
      ...(finiteRate(components?.katanaNativeYield) !== null && {
        baseValue: finiteRate(components?.katanaNativeYield)
      }),
      ...(finiteRate(components?.katanaAppRewardsAPR) !== null && {
        appRewardsValue: finiteRate(components?.katanaAppRewardsAPR)
      })
    }
  }

  const oracle = finiteRate(vault.performance?.oracle?.netAPY) ?? finiteRate(vault.performance?.oracle?.apy)
  if (oracle !== null) return { value: oracle, label: 'Est. APY', source: 'oracle' }

  const historical =
    finiteRate(vault.performance?.historical?.monthlyNet) ??
    finiteRate(vault.performance?.historical?.weeklyNet)
  if (historical !== null) {
    return { value: historical, label: 'Historical APY', source: 'historical' }
  }

  return { value: null, label: 'Unavailable', source: 'unavailable' }
}

const riskLabel = (riskLevel: number | null | undefined): YearnVault['riskLabel'] => {
  if (riskLevel === 1) return 'Conservative'
  if (riskLevel === 2) return 'Moderate'
  if (typeof riskLevel === 'number' && riskLevel >= 3) return 'Aggressive'
  return 'Unrated'
}

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

const variantFromKong = (
  id: YearnVaultVariant['id'],
  vault: KongVault,
  decimals: number,
  asset: YearnVaultVariant['asset']
): YearnVaultVariant => ({
  id,
  address: vault.address,
  name: vault.name,
  symbol: vault.symbol,
  asset,
  decimals,
  tvlUsd: vault.tvl,
  apy: resolveYearnApy(vault)
})

const isYearnEntry = (vault: KongVault) => vault.origin === 'yearn' && vault.inclusion?.isYearn !== false

const isEligibleRoot = (vault: KongVault) =>
  isYearnEntry(vault) &&
  vault.kind === 'Multi Strategy' &&
  vault.isHighlighted === true &&
  vault.isHidden !== true &&
  vault.isRetired !== true

const isEligibleCompanion = (vault: KongVault) =>
  isYearnEntry(vault) && vault.isHidden !== true && vault.isRetired !== true

const rootMatchesPolicy = (definition: YearnCatalogDefinition, vault: KongVault) =>
  sameAddress(vault.asset.address, definition.asset.address) &&
  vault.asset.decimals === definition.asset.decimals &&
  vault.decimals === definition.decimals

const companionMatchesPolicy = (
  definition: YearnCatalogDefinition,
  companion: NonNullable<YearnCatalogDefinition['companions']>[number],
  vault: KongVault
) =>
  sameAddress(vault.asset.address, definition.address) &&
  vault.asset.decimals === definition.decimals &&
  vault.decimals === companion.decimals

const policyAsset = (definition: YearnCatalogDefinition, name?: string) => ({
  address: definition.asset.address,
  name: name || definition.asset.symbol,
  symbol: definition.asset.symbol,
  decimals: definition.asset.decimals
})

const unavailableVault = (
  definition: (typeof YEARN_CATALOG)[number],
  reason: string,
  fallback?: KongVault,
  companions: ReadonlyArray<{
    definition: NonNullable<(typeof YEARN_CATALOG)[number]['companions']>[number]
    vault: KongVault | undefined
  }> = []
): YearnVault => {
  const asset = policyAsset(definition, fallback?.asset.name)
  const rootVariant = fallback
    ? variantFromKong(
        definition.kind === 'yvUSD' ? 'unlocked' : 'direct',
        fallback,
        definition.decimals,
        asset
      )
    : {
        id: definition.kind === 'yvUSD' ? ('unlocked' as const) : ('direct' as const),
        address: definition.address,
        name: definition.name,
        symbol: 'N/A',
        asset,
        decimals: definition.decimals,
        tvlUsd: 0,
        apy: { value: null, label: 'Unavailable' as const, source: 'unavailable' }
      }

  return {
    id: definition.id,
    chainId: definition.chainId,
    chainName: definition.chainName,
    address: definition.address,
    kind: definition.kind,
    name: definition.name,
    symbol: fallback?.symbol || 'N/A',
    description: definition.description,
    asset,
    decimals: definition.decimals,
    tvlUsd: fallback?.tvl || 0,
    apy: fallback ? resolveYearnApy(fallback) : rootVariant.apy,
    riskLevel: fallback?.riskLevel ?? null,
    riskLabel: riskLabel(fallback?.riskLevel),
    performanceFeeBps: fallback?.fees?.performanceFee || 0,
    managementFeeBps: fallback?.fees?.managementFee || 0,
    inceptionTime: fallback?.inceptTime ?? null,
    yearnUrl: `https://yearn.fi/vaults/${definition.chainId}/${definition.address}`,
    status: 'unavailable',
    statusReason: reason,
    variants: [
      rootVariant,
      ...companions.map(({ definition: companion, vault }) =>
        vault
          ? variantFromKong(companion.id, vault, companion.decimals, {
              address: definition.address,
              name: fallback?.name || definition.name,
              symbol: fallback?.symbol || definition.name,
              decimals: definition.decimals
            })
          : {
              id: companion.id,
              address: companion.address,
              name: `${definition.name} ${companion.id}`,
              symbol: 'N/A',
              asset: {
                address: definition.address,
                name: fallback?.name || definition.name,
                symbol: fallback?.symbol || definition.name,
                decimals: definition.decimals
              },
              decimals: companion.decimals,
              tvlUsd: 0,
              apy: { value: null, label: 'Unavailable' as const, source: 'unavailable' }
            }
      )
    ]
  }
}

export function normalizeKongCatalog(
  payload: unknown,
  fetchedAt: number
): { cache: YearnCatalogCache; errors: CatalogNormalizationError[] } {
  if (!Array.isArray(payload) || payload.length > 20_000) {
    throw new Error('Kong vault list has an invalid shape')
  }

  const selectedKeys = new Set(
    YEARN_CATALOG.flatMap((definition) => [
      yearnVaultKey(definition.chainId, definition.address),
      ...(definition.companions || []).map((entry) => yearnVaultKey(definition.chainId, entry.address))
    ])
  )
  const rows = new Map<string, KongVault>()
  const errors: CatalogNormalizationError[] = []

  payload.forEach((candidate) => {
    const minimal = z
      .object({ chainId: z.number().int(), address: z.string() })
      .passthrough()
      .safeParse(candidate)
    if (!minimal.success) return
    const key = yearnVaultKey(minimal.data.chainId, minimal.data.address)
    if (!selectedKeys.has(key)) return

    const parsed = KongVaultSchema.safeParse(candidate)
    if (!parsed.success) {
      errors.push({ message: `Kong metadata was invalid for ${minimal.data.address}` })
      return
    }
    rows.set(key, parsed.data)
  })

  const vaults = YEARN_CATALOG.map((definition): YearnVault => {
    const root = rows.get(yearnVaultKey(definition.chainId, definition.address))
    const companions = (definition.companions || []).map((companion) => ({
      definition: companion,
      vault: rows.get(yearnVaultKey(definition.chainId, companion.address))
    }))
    if (!root) {
      const message = `${definition.name} is missing from Kong`
      errors.push({ chainId: definition.chainId, message })
      return unavailableVault(definition, message, undefined, companions)
    }
    if (!isEligibleRoot(root)) {
      const message = `${definition.name} is not currently eligible for deposits`
      errors.push({ chainId: definition.chainId, message })
      return unavailableVault(definition, message, root, companions)
    }

    if (!rootMatchesPolicy(definition, root)) {
      const message = `${definition.name} token metadata does not match Wren's curated policy`
      errors.push({ chainId: definition.chainId, message })
      return unavailableVault(definition, message, root, companions)
    }

    const invalidCompanion = companions.find(({ vault }) => !vault || !isEligibleCompanion(vault))
    if (invalidCompanion) {
      const message = `${definition.name} product metadata is incomplete`
      errors.push({ chainId: definition.chainId, message })
      return unavailableVault(definition, message, root, companions)
    }
    const mismatchedCompanion = companions.find(
      ({ definition: companion, vault }) => vault && !companionMatchesPolicy(definition, companion, vault)
    )
    if (mismatchedCompanion) {
      const message = `${definition.name} companion metadata does not match Wren's curated policy`
      errors.push({ chainId: definition.chainId, message })
      return unavailableVault(definition, message, root, companions)
    }

    const rootVariantId = definition.kind === 'yvUSD' ? 'unlocked' : 'direct'
    const rootAsset = policyAsset(definition, root.asset.name)
    const variants: YearnVaultVariant[] = [
      variantFromKong(rootVariantId, root, definition.decimals, rootAsset)
    ]
    companions.forEach(({ definition: companion, vault }) => {
      if (vault) {
        variants.push(
          variantFromKong(companion.id, vault, companion.decimals, {
            address: definition.address,
            name: root.name,
            symbol: root.symbol,
            decimals: definition.decimals
          })
        )
      }
    })
    const displayVariant = definition.kind === 'yBOLD' ? variants[1] || variants[0] : variants[0]
    if (!displayVariant) throw new Error(`No display variant for ${definition.id}`)

    return {
      id: definition.id,
      chainId: definition.chainId,
      chainName: definition.chainName,
      address: definition.address,
      kind: definition.kind,
      name: definition.name,
      symbol: displayVariant.symbol,
      description: definition.description,
      asset: {
        address: definition.asset.address,
        name: root.asset.name,
        symbol: definition.asset.symbol,
        decimals: definition.asset.decimals
      },
      decimals: definition.kind === 'yBOLD' ? displayVariant.decimals : definition.decimals,
      tvlUsd: displayVariant.tvlUsd,
      apy: displayVariant.apy,
      riskLevel: root.riskLevel ?? null,
      riskLabel: riskLabel(root.riskLevel),
      performanceFeeBps: root.fees?.performanceFee || 0,
      managementFeeBps: root.fees?.managementFee || 0,
      inceptionTime: root.inceptTime ?? null,
      yearnUrl: `https://yearn.fi/vaults/${definition.chainId}/${definition.address}`,
      status: 'available',
      variants
    }
  })

  return {
    cache: YearnCatalogCacheSchema.parse({
      version: YEARN_CATALOG_VERSION,
      fetchedAt,
      vaults
    }),
    errors
  }
}

export { KongVaultSchema }
