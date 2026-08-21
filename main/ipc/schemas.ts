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
import {
  RemoveDappGuardrailRequestSchema,
  SaveDappGuardrailRequestSchema
} from '../provider/dappGuardrailActions'
import { InspectorInputSchema } from '../../resources/domain/inspector'
import { InspectorInvokeResultSchema } from '../inspector/schema'
import {
  MAX_DEPLOYMENT_INITCODE_HEX_LENGTH,
  MAX_DEPLOYMENT_INITCODE_BYTES
} from '../../resources/domain/deployment'
import { DEPLOYMENT_SERVICE_ERROR_CODES } from '../deployment'
import {
  CONTRACT_VERIFICATION_ARTIFACT_INTAKE_ERROR_CODES,
  type ContractVerificationArtifactIntakeSummary
} from '../contractVerification/artifactIntake'
import { CONTRACT_VERIFICATION_SERVICE_ERROR_CODES } from '../contractVerification/service'
import {
  CONTRACT_VERIFICATION_DESTINATIONS,
  MAX_CONTRACT_VERIFICATION_CANDIDATES,
  MAX_CONTRACT_VERIFICATION_JOBS,
  MAX_CONTRACT_VERIFICATION_REMOTE_ID_CHARS,
  MAX_CONTRACT_VERIFICATION_URL_CHARS,
  validateContractVerificationJobLedger
} from '../../resources/domain/contractVerification'

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
const SignerProtectionStatusSchema = z
  .object({
    available: z.boolean(),
    backend: z.enum([
      'basic_text',
      'gnome_libsecret',
      'kwallet',
      'kwallet5',
      'kwallet6',
      'unknown',
      'windows_dpapi',
      'unsupported'
    ]),
    enabled: z.boolean(),
    protectedFiles: z.number().int().nonnegative().max(512),
    signerFiles: z.number().int().nonnegative().max(512),
    state: z.enum(['disabled', 'enabled', 'unavailable', 'recovery-required', 'unsupported'])
  })
  .strict()
  .superRefine((status, context) => {
    const secureBackend = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6', 'windows_dpapi'].includes(
      status.backend
    )
    if (status.available && !secureBackend) {
      context.addIssue({ code: 'custom', message: 'available protection requires a secure backend' })
    }
    if (
      status.state === 'enabled' &&
      (!status.enabled || !status.available || status.protectedFiles !== status.signerFiles)
    ) {
      context.addIssue({ code: 'custom', message: 'enabled protection status is inconsistent' })
    }
    if (status.state === 'disabled' && (status.enabled || status.protectedFiles !== 0)) {
      context.addIssue({ code: 'custom', message: 'disabled protection status is inconsistent' })
    }
  })
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
const BaseUnitAmountSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/)
const QuoteIdSchema = z.string().min(1).max(128)
const ExpirySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const CalldataSchema = z
  .string()
  .max(131_074)
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
const DeploymentInitcodeSchema = z
  .string()
  .max(MAX_DEPLOYMENT_INITCODE_HEX_LENGTH)
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
const DeploymentDraftSchema = z
  .object({
    account: AddressSchema,
    chainId: ChainNumberSchema,
    initcode: DeploymentInitcodeSchema,
    value: z.union([z.literal(''), DecimalAmountSchema])
  })
  .strict()
const DeploymentInspectionIdSchema = z.string().regex(/^[0-9a-f]{32}$/)
const DeploymentEvidenceReasonSchema = z.enum(['timeout', 'rpc-unavailable', 'rpc-error', 'invalid-response'])
const DeploymentEvidenceFailureSchema = z
  .object({
    status: z.enum(['unavailable', 'failed']),
    source: z.literal('configured-rpc'),
    reasonCode: DeploymentEvidenceReasonSchema,
    reason: z.string().min(1).max(240)
  })
  .strict()
const DeploymentGasEstimateSchema = z.union([
  z
    .object({
      status: z.literal('succeeded'),
      source: z.literal('configured-rpc'),
      method: z.literal('eth_estimateGas'),
      value: RpcQuantitySchema,
      padded: z.literal(true)
    })
    .strict(),
  DeploymentEvidenceFailureSchema.extend({ method: z.literal('eth_estimateGas') }).strict()
])
const DeploymentSimulationSchema = z
  .object({
    status: z.enum(['succeeded', 'reverted', 'unavailable', 'failed']),
    source: z.literal('configured-rpc'),
    method: z.enum(['eth_simulateV1', 'eth_call']).optional(),
    gasUsed: RpcQuantitySchema.optional(),
    reasonCode: z.union([DeploymentEvidenceReasonSchema, z.literal('execution-reverted')]).optional(),
    reason: z.string().min(1).max(240).optional(),
    advancedChecks: z.enum(['complete', 'partly-unavailable', 'pending', 'not-run'])
  })
  .strict()
  .superRefine((simulation, context) => {
    const expectedReason =
      simulation.status === 'succeeded'
        ? undefined
        : simulation.status === 'reverted'
          ? 'execution-reverted'
          : simulation.status === 'unavailable'
            ? simulation.reasonCode
            : simulation.reasonCode
    if (simulation.status === 'succeeded' && (simulation.reasonCode || simulation.reason)) {
      context.addIssue({ code: 'custom', message: 'successful deployment simulation cannot have an error' })
    } else if (
      (simulation.status === 'succeeded' || simulation.status === 'reverted') &&
      !simulation.method
    ) {
      context.addIssue({
        code: 'custom',
        message: 'completed deployment simulation requires its configured-RPC method'
      })
    } else if (simulation.status !== 'succeeded' && (!expectedReason || !simulation.reason)) {
      context.addIssue({ code: 'custom', message: 'failed deployment simulation requires bounded evidence' })
    } else if (simulation.status === 'reverted' && simulation.reasonCode !== 'execution-reverted') {
      context.addIssue({ code: 'custom', message: 'reverted deployment simulation has invalid evidence' })
    }
  })
const DeploymentPendingNonceSchema = z.union([
  z
    .object({
      status: z.literal('succeeded'),
      source: z.literal('configured-rpc'),
      method: z.literal('eth_getTransactionCount'),
      nonce: RpcQuantitySchema,
      provisionalAddress: AddressSchema,
      provisional: z.literal(true)
    })
    .strict(),
  DeploymentEvidenceFailureSchema.extend({ method: z.literal('eth_getTransactionCount') }).strict()
])
const DeploymentInspectionSchema = z
  .object({
    id: DeploymentInspectionIdSchema,
    preparedAt: ExpirySchema,
    expiresAt: ExpirySchema,
    account: AddressSchema,
    chainId: RpcQuantitySchema,
    initcode: z
      .object({
        bytes: z.number().int().positive().max(MAX_DEPLOYMENT_INITCODE_BYTES),
        hash: HashSchema
      })
      .strict(),
    value: RpcQuantitySchema,
    gasEstimate: DeploymentGasEstimateSchema,
    simulation: DeploymentSimulationSchema,
    pendingNonce: DeploymentPendingNonceSchema
  })
  .strict()
  .refine((inspection) => inspection.expiresAt > inspection.preparedAt, {
    message: 'deployment inspection expiry must follow preparation'
  })
const NativeMaxRequestSchema = z
  .object({
    account: AddressSchema,
    assetAddress: AddressSchema,
    chainId: ChainNumberSchema,
    recipient: AddressSchema.optional()
  })
  .strict()
const NativeMaxReserveSchema = z
  .object({
    feeModel: z.enum(['legacy', 'eip1559']),
    gasLimit: RpcQuantitySchema,
    gasPrice: RpcQuantitySchema.optional(),
    maxFeePerGas: RpcQuantitySchema.optional(),
    maxPriorityFeePerGas: RpcQuantitySchema.optional(),
    executionFee: BaseUnitAmountSchema,
    l1Fee: BaseUnitAmountSchema,
    total: BaseUnitAmountSchema
  })
  .strict()
  .superRefine((reserve, context) => {
    const legacy = reserve.feeModel === 'legacy'
    if (
      (legacy && (!reserve.gasPrice || reserve.maxFeePerGas || reserve.maxPriorityFeePerGas)) ||
      (!legacy && (reserve.gasPrice || !reserve.maxFeePerGas || !reserve.maxPriorityFeePerGas))
    ) {
      context.addIssue({ code: 'custom', message: 'native Max fee fields do not match the fee model' })
      return
    }
    const gasLimit = BigInt(reserve.gasLimit)
    const feePerGas = BigInt(legacy ? (reserve.gasPrice as string) : (reserve.maxFeePerGas as string))
    if (!legacy && BigInt(reserve.maxPriorityFeePerGas as string) > feePerGas) {
      context.addIssue({ code: 'custom', message: 'native Max priority fee exceeds its maximum fee' })
    }
    const executionFee = gasLimit * feePerGas
    if (
      executionFee !== BigInt(reserve.executionFee) ||
      executionFee + BigInt(reserve.l1Fee) !== BigInt(reserve.total)
    ) {
      context.addIssue({ code: 'custom', message: 'native Max reserve arithmetic is inconsistent' })
    }
  })
const SweepQuoteRequestSchema = z
  .object({
    account: AddressSchema,
    chainId: ChainNumberSchema,
    recipient: AddressSchema,
    tokens: z.array(AddressSchema).max(16),
    includeNative: z.boolean()
  })
  .strict()
  .superRefine((request, context) => {
    const total = request.tokens.length + (request.includeNative ? 1 : 0)
    if (total < 1 || total > 16) {
      context.addIssue({ code: 'custom', message: 'Sweep must contain between 1 and 16 assets' })
    }
    if (new Set(request.tokens.map((token) => token.toLowerCase())).size !== request.tokens.length) {
      context.addIssue({ code: 'custom', message: 'Sweep token addresses must be distinct' })
    }
  })
const SweepQueueRequestSchema = z
  .object({
    quoteId: QuoteIdSchema,
    account: AddressSchema,
    chainId: ChainNumberSchema,
    recipient: AddressSchema
  })
  .strict()
const SweepCallSchema = z
  .object({ to: AddressSchema, data: CalldataSchema, value: RpcQuantitySchema })
  .strict()
const SweepQuoteSchema = z
  .object({
    quoteId: QuoteIdSchema,
    expiresAt: ExpirySchema,
    account: AddressSchema,
    chainId: ChainNumberSchema,
    recipient: AddressSchema,
    assets: z.array(z.object({ address: AddressSchema, balance: RpcQuantitySchema }).strict()).max(16),
    native: z
      .object({ selected: z.boolean(), balance: RpcQuantitySchema, value: RpcQuantitySchema })
      .strict(),
    maximumFee: RpcQuantitySchema,
    calls: z.array(SweepCallSchema).min(1).max(16),
    execution: z.literal('sequential-non-atomic')
  })
  .strict()
  .superRefine((quote, context) => {
    const expectedCount = quote.assets.length + (quote.native.selected ? 1 : 0)
    const distinctAssets = new Set(quote.assets.map(({ address }) => address.toLowerCase()))
    const tokenCallsMatch = quote.assets.every(
      ({ address, balance }, index) =>
        BigInt(balance) > 0n &&
        quote.calls[index]?.to.toLowerCase() === address.toLowerCase() &&
        quote.calls[index]?.value === '0x0'
    )
    const nativeCall = quote.calls[quote.calls.length - 1]
    const nativeMatches = quote.native.selected
      ? BigInt(quote.native.value) > 0n &&
        nativeCall?.to.toLowerCase() === quote.recipient.toLowerCase() &&
        nativeCall.data === '0x' &&
        nativeCall.value === quote.native.value
      : quote.native.value === '0x0'
    if (
      quote.calls.length !== expectedCount ||
      distinctAssets.size !== quote.assets.length ||
      !tokenCallsMatch ||
      !nativeMatches
    ) {
      context.addIssue({ code: 'custom', message: 'Sweep quote calls do not match its selected assets' })
    }
  })
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
const ContractVerificationRequestReferenceSchema = z
  .object({ account: AddressSchema, handlerId: HandlerIdSchema })
  .strict()
const ContractVerificationAddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/)
const ContractVerificationHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/)
const ContractVerificationSha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const ContractVerificationCompilerVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^(?:v)?[0-9]+\.[0-9]+\.[0-9]+(?:[+-][0-9A-Za-z.-]+)*$/)
const ContractVerificationIdentifierSchema = z.string().min(1).max(1024)
const ContractVerificationQuantitySchema = z
  .string()
  .max(66)
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/)
const ContractVerificationUrlSchema = z
  .string()
  .min(1)
  .max(MAX_CONTRACT_VERIFICATION_URL_CHARS)
  .url()
  .refine((value) => {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  })
const ContractVerificationRemoteIdSchema = z
  .string()
  .min(1)
  .max(MAX_CONTRACT_VERIFICATION_REMOTE_ID_CHARS)
  .regex(/^[A-Za-z0-9._:-]+$/)
const ContractVerificationCreationEvidenceSchema = z
  .object({
    transactionHash: ContractVerificationHashSchema,
    blockNumber: ContractVerificationQuantitySchema,
    blockHash: ContractVerificationHashSchema,
    operationId: z.uuid().optional()
  })
  .strict()
const ContractVerificationTargetSchema = z
  .object({
    address: ContractVerificationAddressSchema,
    chainId: ChainNumberSchema,
    runtimeCodeHash: ContractVerificationHashSchema,
    creationEvidence: ContractVerificationCreationEvidenceSchema.optional()
  })
  .strict()
const ContractVerificationDestinationSchema = z
  .object({
    destination: z.enum(CONTRACT_VERIFICATION_DESTINATIONS),
    status: z.enum([
      'not-submitted',
      'checking',
      'published',
      'verified',
      'already-published',
      'already-verified',
      'rejected',
      'unavailable',
      'needs-api-key',
      'unknown'
    ]),
    remoteId: ContractVerificationRemoteIdSchema.optional(),
    statusUrl: ContractVerificationUrlSchema.optional(),
    explorerUrl: ContractVerificationUrlSchema.optional(),
    reasonCode: z
      .enum([
        'already-verified',
        'api-key-required',
        'destination-rejected',
        'destination-unavailable',
        'publication-rejected',
        'request-timeout',
        'status-unavailable',
        'transport-failure'
      ])
      .optional()
  })
  .strict()
const ContractVerificationJobSchema = z
  .object({
    id: z.uuid(),
    target: ContractVerificationTargetSchema,
    language: z.enum(['Solidity', 'Vyper']),
    compilerVersion: ContractVerificationCompilerVersionSchema,
    contractIdentifier: ContractVerificationIdentifierSchema,
    sourceHash: ContractVerificationSha256Schema,
    submissionHash: ContractVerificationSha256Schema,
    status: z.enum(['preparing', 'publishing', 'published', 'partial', 'rejected', 'unknown']),
    destinations: z.array(ContractVerificationDestinationSchema).min(1).max(5),
    createdAt: ExpirySchema,
    updatedAt: ExpirySchema
  })
  .strict()
  .superRefine((job, context) => {
    try {
      validateContractVerificationJobLedger([job])
    } catch {
      context.addIssue({ code: 'custom', message: 'invalid contract verification job' })
    }
  })
const ContractVerificationArtifactFormatSchema = z.enum([
  'solidity-standard-json',
  'vyper-standard-json',
  'hardhat-2-build-info',
  'foundry-build-info',
  'hardhat-3-build-info'
])
const ContractVerificationArtifactSummarySchema: z.ZodType<ContractVerificationArtifactIntakeSummary> = z
  .object({
    format: ContractVerificationArtifactFormatSchema,
    language: z.enum(['Solidity', 'Vyper']),
    compilerStatus: z.enum(['required', 'included']),
    compilerVersion: ContractVerificationCompilerVersionSchema.nullable(),
    sourceCount: z.number().int().positive().max(1024),
    contractCandidates: z
      .array(ContractVerificationIdentifierSchema)
      .max(MAX_CONTRACT_VERIFICATION_CANDIDATES),
    localRuntimeMatch: z.boolean(),
    selectionRequired: z.boolean(),
    selectedContractIdentifier: ContractVerificationIdentifierSchema.nullable()
  })
  .strict()
  .superRefine((summary, context) => {
    const selectedByDefault = summary.contractCandidates.length === 1 ? summary.contractCandidates[0] : null
    if (
      (summary.compilerStatus === 'included') !== (summary.compilerVersion !== null) ||
      new Set(summary.contractCandidates).size !== summary.contractCandidates.length ||
      summary.selectionRequired !==
        (summary.contractCandidates.length > 1 && summary.selectedContractIdentifier === null) ||
      (summary.contractCandidates.length <= 1 && summary.selectedContractIdentifier !== selectedByDefault) ||
      (summary.selectedContractIdentifier !== null &&
        !summary.contractCandidates.includes(summary.selectedContractIdentifier))
    ) {
      context.addIssue({ code: 'custom', message: 'inconsistent contract verification artifact summary' })
    }
  })
const ContractVerificationArtifactHandleSchema = z
  .object({ token: z.uuid(), summary: ContractVerificationArtifactSummarySchema })
  .strict()
const PreparedContractVerificationSchema = z
  .object({
    acknowledgementToken: z.uuid(),
    target: ContractVerificationTargetSchema,
    language: z.enum(['Solidity', 'Vyper']),
    compilerVersion: ContractVerificationCompilerVersionSchema,
    contractIdentifier: ContractVerificationIdentifierSchema,
    sourceCount: z.number().int().positive().max(1024),
    localRuntimeMatch: z.enum(['matched', 'server-required']),
    deploymentSettlement: z.enum(['complete', 'not-applicable', 'pending'])
  })
  .strict()
  .superRefine((prepared, context) => {
    if (
      (prepared.target.creationEvidence === undefined) !==
      (prepared.deploymentSettlement === 'not-applicable')
    ) {
      context.addIssue({ code: 'custom', message: 'inconsistent verification deployment settlement' })
    }
  })
const ContractVerificationCredentialSchema = z
  .object({
    available: z.boolean(),
    backend: z.enum(['kwallet', 'kwallet5', 'kwallet6', 'secret_service', 'unsupported', 'windows_dpapi']),
    configured: z.boolean()
  })
  .strict()
  .superRefine((credential, context) => {
    if (credential.available === (credential.backend === 'unsupported')) {
      context.addIssue({ code: 'custom', message: 'inconsistent explorer credential status' })
    }
  })
const ContractVerificationApiKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
const ContractVerificationServiceFailureSchema = z
  .object({ success: z.literal(false), error: z.enum(CONTRACT_VERIFICATION_SERVICE_ERROR_CODES) })
  .strict()
const ContractVerificationServiceFailureWithJobSchema = z
  .object({
    success: z.literal(false),
    error: z.enum(CONTRACT_VERIFICATION_SERVICE_ERROR_CODES),
    job: ContractVerificationJobSchema.optional()
  })
  .strict()
const ContractVerificationArtifactFailureSchema = z
  .object({ success: z.literal(false), error: z.enum(CONTRACT_VERIFICATION_ARTIFACT_INTAKE_ERROR_CODES) })
  .strict()
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
  clearRecentRecipients: noArgs,
  closeDash: noArgs,
  muteBetaDisclosure: noArgs,
  muteWelcomeWarning: noArgs,
  navDash: z.tuple([BreadcrumbSchema]),
  navReplace: z.tuple([z.literal('dash'), z.array(BreadcrumbSchema).max(32).optional()]),
  removeNetwork: z.tuple([NetworkReferenceSchema]),
  removeEndpoint: z.tuple([NetworkTypeSchema, ChainKeySchema, EndpointIdSchema]),
  retryDapp: z.tuple([IdSchema]),
  removeDappGuardrail: z.tuple([RemoveDappGuardrailRequestSchema]),
  saveDappGuardrail: z.tuple([SaveDappGuardrailRequestSchema]),
  setAccountCloseLock: z.tuple([z.boolean()]),
  setAccountFilter: z.tuple([z.string().max(256)]),
  setAutohide: z.tuple([z.boolean()]),
  setTransactionNotifications: z.tuple([z.boolean()]),
  setRememberRecentRecipients: z.tuple([z.boolean()]),
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
  'dash:dismissHardwarePrompt': z.tuple([IdSchema]),
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
  'tray:resetAllSettings': noArgs,
  'tray:resetNonce': z.tuple([AccountRequestReferenceSchema]),
  'tray:updateRestart': noArgs
}

const invokeSchemas = {
  'addressBook:export': z.tuple([]),
  'addressBook:import': z.tuple([]),
  'addressBook:remove': z.tuple([AddressBookAddressInputSchema]),
  'addressBook:save': z.tuple([AddressBookSaveRequestSchema]),
  'contractVerification:credentialStatus': z.tuple([]),
  'contractVerification:get': z.tuple([z.uuid()]),
  'contractVerification:inspectArtifact': z.tuple([]),
  'contractVerification:list': z.tuple([]),
  'contractVerification:openResult': z.tuple([
    z.object({ jobId: z.uuid(), destination: z.enum(CONTRACT_VERIFICATION_DESTINATIONS) }).strict()
  ]),
  'contractVerification:prepare': z.tuple([
    z
      .object({
        artifactToken: z.uuid(),
        chainId: ChainNumberSchema,
        address: ContractVerificationAddressSchema,
        operationId: z.uuid().optional(),
        compilerVersion: ContractVerificationCompilerVersionSchema.optional(),
        contractIdentifier: ContractVerificationIdentifierSchema.optional()
      })
      .strict()
  ]),
  'contractVerification:publish': z.tuple([
    z
      .object({
        acknowledgementToken: z.uuid(),
        confirmation: z.literal('PUBLISH_CONTRACT_SOURCE')
      })
      .strict()
  ]),
  'contractVerification:publishEtherscan': z.tuple([
    z
      .object({
        jobId: z.uuid(),
        confirmation: z.literal('PUBLISH_TO_ETHERSCAN'),
        constructorArguments: z
          .string()
          .min(2)
          .max(2 * 1024 * 1024)
          .regex(/^(?:[0-9a-fA-F]{2})+$/u)
          .optional(),
        noConstructorArguments: z.literal(true).optional()
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.constructorArguments === undefined) === (value.noConstructorArguments === undefined)) {
          context.addIssue({ code: 'custom', message: 'constructor arguments must be explicit' })
        }
      })
  ]),
  'contractVerification:refresh': z.tuple([z.uuid()]),
  'contractVerification:removeCredential': z.tuple([]),
  'contractVerification:reselect': z.tuple([
    z
      .object({
        artifactToken: z.uuid(),
        jobId: z.uuid(),
        compilerVersion: ContractVerificationCompilerVersionSchema.optional(),
        contractIdentifier: ContractVerificationIdentifierSchema.optional()
      })
      .strict()
  ]),
  'contractVerification:saveCredential': z.tuple([ContractVerificationApiKeySchema]),
  'contractVerification:selectArtifact': z.tuple([z.uuid(), ContractVerificationIdentifierSchema]),
  'deployment:prepare': z.tuple([DeploymentDraftSchema]),
  'deployment:queue': z.tuple([
    z.object({ inspectionId: DeploymentInspectionIdSchema, draft: DeploymentDraftSchema }).strict()
  ]),
  'inspector:inspect': z.tuple([InspectorInputSchema]),
  'profile:export': z.tuple([BackupPasswordSchema]),
  'profile:inspectBackup': z.tuple([BackupPasswordSchema]),
  'profile:stageRestore': z.tuple([z.uuid(), BackupPasswordSchema, z.literal('REPLACE_PROFILE_ON_RESTART')]),
  'signers:protectionStatus': z.tuple([]),
  'signers:enableProtection': z.tuple([z.literal('ENABLE_OS_SIGNER_PROTECTION')]),
  'signers:disableProtection': z.tuple([z.literal('DISABLE_OS_SIGNER_PROTECTION')]),
  'send:maxAmount': z.tuple([NativeMaxRequestSchema]),
  'send:queue': z.tuple([
    z
      .object({
        account: AddressSchema,
        amount: DecimalAmountSchema,
        assetAddress: AddressSchema,
        chainId: ChainNumberSchema,
        recipient: AddressSchema,
        maxQuoteId: z
          .string()
          .regex(/^[0-9a-f]{32}$/)
          .optional()
      })
      .strict()
  ]),
  'send:quoteSweep': z.tuple([SweepQuoteRequestSchema]),
  'send:queueSweep': z.tuple([SweepQueueRequestSchema]),
  'send:resolveRecipient': z.tuple([z.string().trim().min(1).max(255)]),
  'tokens:save': z.tuple([TokenSchema, AssetSuggestionReferenceSchema.optional()]),
  'yearn:getCatalog': z.tuple([z.object({ force: z.boolean(), cacheOnly: z.boolean().optional() }).strict()]),
  'yearn:getPositions': z.tuple([]),
  'yearn:getWorkflows': z.tuple([]),
  'yearn:startWorkflow': z.tuple([YearnWorkflowRequestSchema]),
  'yearn:resumeWorkflow': z.tuple([YearnWorkflowIdRequestSchema]),
  'yearn:cancelWorkflow': z.tuple([YearnWorkflowIdRequestSchema]),
  'yearn:revokeWorkflow': z.tuple([YearnWorkflowIdRequestSchema]),
  'tray:addChain': z.tuple([AddChainSchema, AddChainRequestReferenceSchema.nullish()]),
  'tray:continueContractVerification': z.tuple([ContractVerificationRequestReferenceSchema]),
  'tray:getTokenDetails': z.tuple([AddressSchema, ChainNumberSchema]),
  'tray:adjustWalletCalls': z.tuple([WalletCallsAdjustmentSchema]),
  'tray:refreshWalletCallsStatus': z.tuple([WalletCallsStatusRefreshSchema]),
  'tray:writeClipboard': z.tuple([z.object({ secret: z.boolean(), value: BoundedStringSchema }).strict()])
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
  'contractVerification:credentialStatus': z.union([
    z.object({ success: z.literal(true), credential: ContractVerificationCredentialSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:get': z.union([
    z.object({ success: z.literal(true), job: ContractVerificationJobSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:inspectArtifact': z.union([
    z.object({ success: z.literal(true), artifact: ContractVerificationArtifactHandleSchema }).strict(),
    z.object({ success: z.literal(false), canceled: z.literal(true) }).strict(),
    ContractVerificationArtifactFailureSchema
  ]),
  'contractVerification:list': z.union([
    z
      .object({
        success: z.literal(true),
        jobs: z
          .array(ContractVerificationJobSchema)
          .max(MAX_CONTRACT_VERIFICATION_JOBS)
          .superRefine((jobs, context) => {
            try {
              validateContractVerificationJobLedger(jobs)
            } catch {
              context.addIssue({ code: 'custom', message: 'invalid contract verification job list' })
            }
          })
      })
      .strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:openResult': z.union([
    z.object({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.literal('job-unavailable') }).strict()
  ]),
  'contractVerification:prepare': z.union([
    z.object({ success: z.literal(true), prepared: PreparedContractVerificationSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:publish': z.union([
    z.object({ success: z.literal(true), job: ContractVerificationJobSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:publishEtherscan': z.union([
    z.object({ success: z.literal(true), job: ContractVerificationJobSchema }).strict(),
    ContractVerificationServiceFailureWithJobSchema
  ]),
  'contractVerification:refresh': z.union([
    z.object({ success: z.literal(true), job: ContractVerificationJobSchema }).strict(),
    ContractVerificationServiceFailureWithJobSchema
  ]),
  'contractVerification:removeCredential': z.union([
    z.object({ success: z.literal(true), credential: ContractVerificationCredentialSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:reselect': z.union([
    z.object({ success: z.literal(true), job: ContractVerificationJobSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:saveCredential': z.union([
    z.object({ success: z.literal(true), credential: ContractVerificationCredentialSchema }).strict(),
    ContractVerificationServiceFailureSchema
  ]),
  'contractVerification:selectArtifact': z.union([
    z.object({ success: z.literal(true), artifact: ContractVerificationArtifactHandleSchema }).strict(),
    ContractVerificationArtifactFailureSchema
  ]),
  'deployment:prepare': z.union([
    z.object({ success: z.literal(true), inspection: DeploymentInspectionSchema }).strict(),
    z.object({ success: z.literal(false), error: z.enum(DEPLOYMENT_SERVICE_ERROR_CODES) }).strict()
  ]),
  'deployment:queue': z.union([
    z.object({ success: z.literal(true), handlerId: IdSchema }).strict(),
    z.object({ success: z.literal(false), error: z.enum(DEPLOYMENT_SERVICE_ERROR_CODES) }).strict()
  ]),
  'inspector:inspect': InspectorInvokeResultSchema,
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
  'signers:protectionStatus': z.union([
    z.object({ success: z.literal(true), status: SignerProtectionStatusSchema }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'signers:enableProtection': z.union([
    z.object({ success: z.literal(true), status: SignerProtectionStatusSchema }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'signers:disableProtection': z.union([
    z.object({ success: z.literal(true), status: SignerProtectionStatusSchema }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:maxAmount': z.union([
    z.object({ success: z.literal(true), amount: BaseUnitAmountSchema }).strict(),
    z
      .object({
        success: z.literal(true),
        quoteId: z.string().regex(/^[0-9a-f]{32}$/),
        amount: BaseUnitAmountSchema,
        expiresAt: ExpirySchema,
        reserve: NativeMaxReserveSchema
      })
      .strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:queue': z.union([
    z.object({ success: z.literal(true), handlerId: IdSchema }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:quoteSweep': z.union([
    SweepQuoteSchema.extend({ success: z.literal(true) }).strict(),
    z.object({ success: z.literal(false), error: z.string().min(1).max(240) }).strict()
  ]),
  'send:queueSweep': z.union([
    z.object({ success: z.literal(true), handlerId: HandlerIdSchema }).strict(),
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
  'tray:continueContractVerification': z.union([
    z
      .object({
        success: z.literal(true),
        operationId: z.uuid(),
        chainId: ChainNumberSchema,
        address: ContractVerificationAddressSchema
      })
      .strict(),
    z
      .object({
        success: z.literal(false),
        error: z.enum(['invalid-request', 'invalid-operation', 'operation-not-confirmed', 'job-unavailable'])
      })
      .strict()
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
  ]),
  'tray:writeClipboard': z.object({ success: z.literal(true) }).strict()
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
