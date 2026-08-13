import { z } from 'zod'

import type { BridgeMethod } from '../../resources/bridge/roles'
import { ShortcutSchema as StoredShortcutSchema } from '../store/state/types/shortcuts'
import {
  YearnCatalogResultSchema,
  YearnPositionsResultSchema,
  YearnWorkflowIdRequestSchema,
  YearnWorkflowListResultSchema,
  YearnWorkflowMutationResultSchema,
  YearnWorkflowRequestSchema
} from '../../resources/domain/yearn'
import {
  AddressBookAddressInputSchema,
  AddressBookEntrySchema,
  AddressBookSaveRequestSchema
} from '../../resources/domain/addressBook'

const MAX_TEXT = 4096
const MAX_URL = 8192
const MAX_NAV_DATA = 256 * 1024
const MAX_NAV_KEYS = 128

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const HashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const IdSchema = z.string().min(1).max(256)
const HandlerIdSchema = z.string().uuid()
const OriginSchema = z.string().min(1).max(512)
const ChainNumberSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const ChainKeySchema = z.union([ChainNumberSchema, z.string().regex(/^[1-9][0-9]{0,15}$/)])
const NetworkTypeSchema = z.literal('ethereum')
const BoundedStringSchema = z.string().max(MAX_TEXT)
const BackupPasswordSchema = z.string().min(12).max(1024)
const UrlInputSchema = z.string().max(MAX_URL)
const RpcQuantitySchema = z
  .string()
  .max(66)
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/)
const DecimalAmountSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/)
const WindowIdSchema = z.enum(['dash', 'panel'])
const AccentSchema = z.enum([
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'accent7',
  'accent8'
])

const PlainRecordSchema = z.record(z.string().max(128), z.unknown()).superRefine((value, ctx) => {
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string' || serialized.length > MAX_NAV_DATA) {
      ctx.addIssue({ code: 'custom', message: 'navigation data is too large' })
      return
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'navigation data must be JSON serializable' })
    return
  }

  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }]
  while (pending.length > 0) {
    const current = pending.pop() as { depth: number; value: unknown }
    if (current.depth > 20) {
      ctx.addIssue({ code: 'custom', message: 'navigation data is too deeply nested' })
      return
    }
    if (current.value === null || ['string', 'boolean'].includes(typeof current.value)) continue
    if (typeof current.value === 'number' && Number.isFinite(current.value)) continue
    if (Array.isArray(current.value)) {
      if (current.value.length > 1024) {
        ctx.addIssue({ code: 'custom', message: 'navigation data array is too large' })
        return
      }
      current.value.forEach((entry) => pending.push({ depth: current.depth + 1, value: entry }))
      continue
    }
    if (typeof current.value === 'object') {
      const entries = Object.entries(current.value)
      if (entries.length > MAX_NAV_KEYS) {
        ctx.addIssue({ code: 'custom', message: 'navigation data has too many keys' })
        return
      }
      if (entries.some(([key]) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
        ctx.addIssue({ code: 'custom', message: 'navigation data has an unsafe key' })
        return
      }
      entries.forEach(([, entry]) => pending.push({ depth: current.depth + 1, value: entry }))
      continue
    }
    ctx.addIssue({ code: 'custom', message: 'navigation data contains an unsupported value' })
    return
  }
})

const BreadcrumbSchema = z
  .object({ view: z.string().min(1).max(128), data: PlainRecordSchema })
  .strict()
  .superRefine(({ view, data }, ctx) => {
    if (view === 'accounts' && Object.prototype.hasOwnProperty.call(data, 'accountData')) {
      ctx.addIssue({ code: 'custom', message: 'account setup data must not be stored in navigation' })
    }
  })
const BreadcrumbUpdateSchema = z
  .object({ view: z.string().min(1).max(128).optional(), data: PlainRecordSchema })
  .strict()
  .superRefine(({ data }, ctx) => {
    if (Object.prototype.hasOwnProperty.call(data, 'accountData')) {
      ctx.addIssue({ code: 'custom', message: 'account setup data must not be stored in navigation' })
    }
  })
const AccountRequestReferenceSchema = z
  .object({ account: AddressSchema, handlerId: HandlerIdSchema })
  .transform(({ account, handlerId }) => ({ account, handlerId }))
const AssetSuggestionReferenceSchema = AccountRequestReferenceSchema
const WalletCallFeeAdjustmentSchema = z
  .object({
    gasLimit: RpcQuantitySchema,
    gasPrice: RpcQuantitySchema.optional(),
    maxFeePerGas: RpcQuantitySchema.optional(),
    maxPriorityFeePerGas: RpcQuantitySchema.optional()
  })
  .strict()
const WalletCallsAdjustmentSchema = z
  .object({
    account: AddressSchema,
    handlerId: HandlerIdSchema,
    adjustment: z
      .object({
        startingNonce: RpcQuantitySchema,
        calls: z.array(WalletCallFeeAdjustmentSchema).min(1).max(16)
      })
      .strict()
  })
  .strict()
const WalletCallsStatusRefreshSchema = z
  .object({
    account: AddressSchema,
    id: IdSchema,
    origin: OriginSchema
  })
  .strict()
const AddChainRequestReferenceSchema = AccountRequestReferenceSchema
const AccessReferenceSchema = z
  .object({
    type: z.literal('access'),
    handlerId: HandlerIdSchema,
    origin: OriginSchema,
    account: AddressSchema
  })
  .transform(({ type, handlerId, origin, account }) => ({ type, handlerId, origin, account }))
const NetworkReferenceSchema = z
  .object({ type: NetworkTypeSchema, id: ChainNumberSchema })
  .transform(({ type, id }) => ({ type, id }))

const NetworkBaseSchema = z.object({
  type: NetworkTypeSchema,
  id: ChainNumberSchema,
  name: z.string().trim().min(1).max(128),
  explorer: UrlInputSchema,
  symbol: z.string().trim().min(1).max(32),
  isTestnet: z.boolean(),
  primaryColor: AccentSchema
})
const ExistingNetworkSchema = NetworkBaseSchema.strict()
const UpdatedNetworkSchema = NetworkBaseSchema.extend({
  icon: UrlInputSchema,
  nativeCurrencyIcon: UrlInputSchema,
  nativeCurrencyName: z.string().trim().max(128),
  nativeCurrencyDecimals: z.number().int().min(0).max(255)
}).strict()
const AddChainSchema = UpdatedNetworkSchema.extend({
  rpcUrls: z.array(UrlInputSchema).min(1).max(5),
  nativeCurrencyDecimals: z.number().int().min(0).max(255)
}).strict()

const TokenIdSchema = z
  .object({ address: AddressSchema, chainId: ChainNumberSchema })
  .transform(({ address, chainId }) => ({ address, chainId }))
const TokenSchema = z
  .object({
    address: AddressSchema,
    chainId: ChainNumberSchema,
    name: z.string().trim().min(1).max(128),
    symbol: z.string().trim().min(1).max(32),
    decimals: z.number().int().min(0).max(255),
    logoURI: UrlInputSchema.optional()
  })
  .strict()

const ShortcutSchema = StoredShortcutSchema.required().strict()

const noArgs = z.tuple([])
const EndpointIdSchema = z.string().min(1).max(64)
const actionSchemas = {
  addEndpoint: z.tuple([NetworkTypeSchema, ChainKeySchema]),
  activateNetwork: z.tuple([NetworkTypeSchema, ChainKeySchema, z.boolean()]),
  backDash: z.tuple([z.number().int().min(1).max(32).optional()]),
  clearPermissions: z.tuple([AddressSchema]),
  clearActivity: noArgs,
  closeDash: noArgs,
  muteBetaDisclosure: noArgs,
  muteWelcomeWarning: noArgs,
  navDash: z.tuple([BreadcrumbSchema]),
  navReplace: z.tuple([z.literal('dash'), z.array(BreadcrumbSchema).max(32).optional()]),
  removeNetwork: z.tuple([NetworkReferenceSchema]),
  removeEndpoint: z.tuple([NetworkTypeSchema, ChainKeySchema, EndpointIdSchema]),
  retryDapp: z.tuple([IdSchema]),
  setAccountCloseLock: z.tuple([z.boolean()]),
  setAccountFilter: z.tuple([z.string().max(256)]),
  setAutohide: z.tuple([z.boolean()]),
  setTransactionNotifications: z.tuple([z.boolean()]),
  setDash: z.tuple([z.object({ showing: z.boolean() }).strict()]),
  setFooterHeight: z.tuple([z.literal('panel'), z.number().finite().min(0).max(4096)]),
  setGlideSide: z.tuple([z.enum(['left', 'right'])]),
  setInterfaceScale: z.tuple([z.union([z.literal(1), z.literal(1.25), z.literal(1.5)])]),
  setKeyboardLayout: z.tuple([z.object({ isUS: z.boolean() }).strict()]),
  setLatticeAccountLimit: z.tuple([z.number().int().min(1).max(100)]),
  setLatticeDerivation: z.tuple([z.enum(['standard', 'legacy', 'live'])]),
  setLatticeEndpointCustom: z.tuple([UrlInputSchema]),
  setLatticeEndpointMode: z.tuple([z.enum(['default', 'custom'])]),
  setLedgerDerivation: z.tuple([z.enum(['live', 'legacy', 'standard', 'testnet'])]),
  setLiveAccountLimit: z.tuple([z.number().int().min(1).max(100)]),
  setMenubarGasPrice: z.tuple([z.boolean()]),
  setOnboard: z.tuple([z.object({ showing: z.boolean() }).strict()]),
  setEndpointUrl: z.tuple([NetworkTypeSchema, ChainKeySchema, EndpointIdSchema, UrlInputSchema]),
  setShortcut: z.tuple([z.literal('summon'), ShortcutSchema]),
  setTrezorDerivation: z.tuple([z.enum(['standard', 'legacy', 'testnet'])]),
  switchOriginChain: z.tuple([HandlerIdSchema, ChainNumberSchema, NetworkTypeSchema]),
  toggleAccess: z.tuple([AddressSchema, HandlerIdSchema, z.boolean()]),
  toggleEndpoint: z.tuple([NetworkTypeSchema, ChainKeySchema, EndpointIdSchema, z.boolean().optional()]),
  moveEndpoint: z.tuple([
    NetworkTypeSchema,
    ChainKeySchema,
    EndpointIdSchema,
    z.union([z.literal(-1), z.literal(1)])
  ]),
  toggleExplorerWarning: noArgs,
  toggleGasFeeWarning: noArgs,
  toggleLaunch: noArgs,
  toggleReveal: noArgs,
  toggleShowLocalNameWithENS: noArgs,
  toggleSignerCompatibilityWarning: noArgs,
  updateAccountModule: z.tuple([
    z.enum([
      'activity',
      'balances',
      'chains',
      'gas',
      'inventory',
      'permissions',
      'requests',
      'settings',
      'signer',
      'verify'
    ]),
    z.object({ height: z.number().finite().min(0).max(4096) }).strict()
  ]),
  updateBadge: z.tuple([z.string().max(64), z.string().max(128).optional()]),
  updateNetwork: z.tuple([ExistingNetworkSchema, UpdatedNetworkSchema])
} satisfies Record<string, z.ZodType>

export const rendererActionNames = Object.freeze(Object.keys(actionSchemas))

const TrayActionArgsSchema = z
  .tuple([z.string().min(1).max(64)])
  .rest(z.unknown())
  .transform((args, ctx) => {
    const [action, ...actionArgs] = args
    const schema = actionSchemas[action as keyof typeof actionSchemas]
    if (!schema) {
      ctx.addIssue({ code: 'custom', message: 'unrecognized renderer store action' })
      return z.NEVER
    }
    const parsed = schema.safeParse(actionArgs)
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => ctx.addIssue({ ...issue, path: [action, ...issue.path] }))
      return z.NEVER
    }
    return [action, ...parsed.data]
  })

const eventSchemas: Record<string, z.ZodType> = {
  '*:contextmenu': z.tuple([z.number().finite(), z.number().finite()]),
  'dash:reloadSigner': z.tuple([IdSchema]),
  'dash:removeSigner': z.tuple([IdSchema]),
  'frame:close': noArgs,
  'frame:max': noArgs,
  'frame:min': noArgs,
  'frame:unmax': noArgs,
  'nav:back': z.tuple([WindowIdSchema, z.number().int().min(1).max(32).optional()]),
  'nav:forward': z.tuple([WindowIdSchema, BreadcrumbSchema]),
  'nav:update': z.tuple([WindowIdSchema, BreadcrumbUpdateSchema, z.boolean().optional()]),
  'tray:action': TrayActionArgsSchema,
  'tray:addToken': z.tuple([
    z.union([TokenSchema, z.literal(false)]),
    AssetSuggestionReferenceSchema.optional()
  ]),
  'tray:adjustNonce': z.tuple([AccountRequestReferenceSchema, z.union([z.literal(-1), z.literal(1)])]),
  'tray:clearRequests': z.tuple([AddressSchema]),
  'tray:clipboardData': z.tuple([BoundedStringSchema]),
  'tray:copyTxHash': z.tuple([HashSchema]),
  'tray:dismissUpdate': z.tuple([z.string().min(1).max(128), z.boolean()]),
  'tray:giveAccess': z.tuple([AccessReferenceSchema, z.boolean()]),
  'tray:installAvailableUpdate': noArgs,
  'tray:mouseout': noArgs,
  'tray:openExplorer': z.tuple([
    NetworkReferenceSchema,
    z.union([HashSchema, z.null()]).optional(),
    AddressSchema.optional()
  ]),
  'tray:openExternal': z.tuple([z.string().url().max(MAX_URL)]),
  'tray:quit': noArgs,
  'tray:ready': noArgs,
  'tray:rejectRequest': z.tuple([AccountRequestReferenceSchema]),
  'tray:removeToken': z.tuple([TokenIdSchema]),
  'tray:renameAccount': z.tuple([AddressSchema, z.string().trim().min(1).max(128)]),
  'tray:replaceTx': z.tuple([AccountRequestReferenceSchema, z.enum(['cancel', 'speed'])]),
  'tray:resetAllSettings': noArgs,
  'tray:resetNonce': z.tuple([AccountRequestReferenceSchema]),
  'tray:updateRestart': noArgs
}

const invokeSchemas = {
  'addressBook:export': z.tuple([]),
  'addressBook:import': z.tuple([]),
  'addressBook:remove': z.tuple([AddressBookAddressInputSchema]),
  'addressBook:save': z.tuple([AddressBookSaveRequestSchema]),
  'profile:export': z.tuple([BackupPasswordSchema]),
  'profile:inspectBackup': z.tuple([BackupPasswordSchema]),
  'profile:stageRestore': z.tuple([z.uuid(), BackupPasswordSchema, z.literal('REPLACE_PROFILE_ON_RESTART')]),
  'send:maxAmount': z.tuple([ChainNumberSchema, AddressSchema, AddressSchema.optional()]),
  'send:queue': z.tuple([
    z
      .object({
        account: AddressSchema,
        amount: DecimalAmountSchema,
        assetAddress: AddressSchema,
        chainId: ChainNumberSchema,
        recipient: AddressSchema
      })
      .strict()
  ]),
  'send:resolveRecipient': z.tuple([z.string().trim().min(1).max(255)]),
  'tokens:save': z.tuple([TokenSchema, AssetSuggestionReferenceSchema.optional()]),
  'yearn:getCatalog': z.tuple([z.object({ force: z.boolean() }).strict()]),
  'yearn:getPositions': z.tuple([]),
  'yearn:getWorkflows': z.tuple([]),
  'yearn:startWorkflow': z.tuple([YearnWorkflowRequestSchema]),
  'yearn:resumeWorkflow': z.tuple([YearnWorkflowIdRequestSchema]),
  'yearn:cancelWorkflow': z.tuple([YearnWorkflowIdRequestSchema]),
  'yearn:revokeWorkflow': z.tuple([YearnWorkflowIdRequestSchema]),
  'tray:addChain': z.tuple([AddChainSchema, AddChainRequestReferenceSchema.nullish()]),
  'tray:getTokenDetails': z.tuple([AddressSchema, ChainNumberSchema]),
  'tray:adjustWalletCalls': z.tuple([WalletCallsAdjustmentSchema]),
  'tray:refreshWalletCallsStatus': z.tuple([WalletCallsStatusRefreshSchema])
} satisfies Record<string, z.ZodType>

const invokeResultSchemas = {
  'addressBook:export': z.union([
    z.object({ success: z.literal(true), exported: z.number().int().nonnegative() }).strict(),
    z.object({ success: z.literal(false), canceled: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'addressBook:import': z.union([
    z
      .object({
        success: z.literal(true),
        imported: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative()
      })
      .strict(),
    z.object({ success: z.literal(false), canceled: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'addressBook:remove': z.union([
    z.object({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'addressBook:save': z.union([
    z.object({ success: z.literal(true), entry: AddressBookEntrySchema }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'profile:export': z.union([
    z.object({ success: z.literal(true), bytes: z.number().int().positive() }).strict(),
    z.object({ success: z.literal(false), canceled: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'profile:inspectBackup': z.union([
    z
      .object({
        success: z.literal(true),
        restoreToken: z.uuid(),
        tokenExpiresAt: z.string().datetime(),
        backup: z
          .object({
            formatVersion: z.literal(1),
            createdAt: z.string().datetime(),
            signerCount: z.number().int().nonnegative().max(512)
          })
          .strict()
      })
      .strict(),
    z.object({ success: z.literal(false), canceled: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'profile:stageRestore': z.union([
    z
      .object({
        success: z.literal(true),
        restore: z
          .object({
            restoreId: z.uuid(),
            stagedAt: z.string().datetime(),
            expiresAt: z.string().datetime(),
            signerCount: z.number().int().nonnegative().max(512),
            relaunchRequired: z.literal(true)
          })
          .strict()
      })
      .strict(),
    z.object({ success: z.literal(false), canceled: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:maxAmount': z.union([
    z.object({ success: z.literal(true), amount: z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:queue': z.union([
    z.object({ success: z.literal(true), handlerId: IdSchema }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:resolveRecipient': z.union([
    z
      .object({ success: z.literal(true), address: AddressSchema, name: z.string().max(255).optional() })
      .strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'tokens:save': z.union([
    z.object({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'yearn:getCatalog': YearnCatalogResultSchema,
  'yearn:getPositions': YearnPositionsResultSchema,
  'yearn:getWorkflows': YearnWorkflowListResultSchema,
  'yearn:startWorkflow': YearnWorkflowMutationResultSchema,
  'yearn:resumeWorkflow': YearnWorkflowMutationResultSchema,
  'yearn:cancelWorkflow': YearnWorkflowMutationResultSchema,
  'yearn:revokeWorkflow': YearnWorkflowMutationResultSchema,
  'tray:addChain': z.union([
    z.object({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(1024).optional() }).strict()
  ]),
  'tray:getTokenDetails': z
    .object({
      decimals: z.number().int().min(0).max(255).optional(),
      name: z.string().max(128).optional(),
      symbol: z.string().max(32).optional(),
      totalSupply: z
        .string()
        .regex(/^(?:0|[1-9][0-9]{0,77})$/)
        .optional()
    })
    .strict(),
  'tray:adjustWalletCalls': z.union([
    z.object({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'tray:refreshWalletCallsStatus': z.union([
    z.object({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ])
} satisfies Record<keyof typeof invokeSchemas, z.ZodType>

export const assertRendererIpcSchema = (method: Exclude<BridgeMethod, 'rpc'>, channel: string) => {
  const schema =
    method === 'event' ? eventSchemas[channel] : invokeSchemas[channel as keyof typeof invokeSchemas]
  if (!schema) throw new Error(`Renderer IPC channel has no ${method} schema: ${channel}`)
  return schema
}

export const parseRendererIpcArgs = (
  method: Exclude<BridgeMethod, 'rpc'>,
  channel: string,
  args: unknown[]
) => assertRendererIpcSchema(method, channel).safeParse(args)

export const assertRendererInvokeResultSchema = (channel: string) => {
  const schema = invokeResultSchemas[channel as keyof typeof invokeResultSchemas]
  if (!schema) throw new Error(`Renderer IPC channel has no invoke result schema: ${channel}`)
  return schema
}

export const parseRendererInvokeResult = (channel: string, result: unknown) =>
  assertRendererInvokeResultSchema(channel).safeParse(result)

export const rendererIpcChannels = Object.freeze({
  event: Object.freeze(Object.keys(eventSchemas)),
  invoke: Object.freeze(Object.keys(invokeSchemas))
})
