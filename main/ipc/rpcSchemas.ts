import { z } from 'zod'

const MAX_WIRE_VALUE = 16 * 1024 * 1024
const MAX_SECRET = 4096
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const HandlerIdSchema = z.string().uuid()
const IdSchema = z.string().min(1).max(256)
const ErrorSchema = z.string().min(1).max(1024)
const OptionalErrorSchema = z.union([ErrorSchema, z.null(), z.undefined()])
const NullishSchema = z.union([z.null(), z.undefined()])
const PasswordSchema = z.string().max(MAX_SECRET)
const QuantitySchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/)
  .max(66)
const AmountSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/)
const ChainIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const RequestReferenceSchema = z
  .object({ handlerId: HandlerIdSchema, account: AddressSchema })
  .transform(({ handlerId, account }) => ({ handlerId, account }))
const ActionRequestReferenceSchema = z
  .object({ handlerId: HandlerIdSchema, account: AddressSchema, type: z.string().min(1).max(32) })
  .transform(({ handlerId, account, type }) => ({ handlerId, account, type }))
const TransactionRequestReferenceSchema = z
  .object({ handlerId: HandlerIdSchema, account: AddressSchema, type: z.literal('transaction') })
  .transform(({ handlerId, account, type }) => ({ handlerId, account, type }))
const WalletCallsApprovalOptionsSchema = z
  .object({ walletCallsSimulationAcknowledged: z.literal(true) })
  .strict()
const Eip7702EligibilityBase = {
  account: AddressSchema,
  chainId: ChainIdSchema
}
const Eip7702EligibilitySchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('eligible'),
      ...Eip7702EligibilityBase,
      source: z.literal('eth_getCode'),
      delegate: AddressSchema,
      codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
    })
    .strict(),
  ...(['not-delegated', 'unavailable', 'unsupported-signer', 'disconnected'] as const).map((status) =>
    z.object({ status: z.literal(status), ...Eip7702EligibilityBase }).strict()
  )
])
const AccountExecutionBase = {
  account: AddressSchema,
  chainId: ChainIdSchema
}
const AccountExecutionStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('no-code'),
      ...AccountExecutionBase,
      source: z.literal('eth_getCode'),
      codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
    })
    .strict(),
  z
    .object({
      status: z.literal('delegated'),
      ...AccountExecutionBase,
      source: z.literal('eth_getCode'),
      delegate: AddressSchema,
      codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
    })
    .strict(),
  z
    .object({
      status: z.literal('contract'),
      ...AccountExecutionBase,
      source: z.literal('eth_getCode'),
      codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
    })
    .strict(),
  ...(['unavailable', 'disconnected'] as const).map((status) =>
    z.object({ status: z.literal(status), ...AccountExecutionBase }).strict()
  )
])
const Eip7702RequestReferenceSchema = z
  .object({
    handlerId: HandlerIdSchema,
    account: AddressSchema,
    type: z.literal('eip7702Revoke')
  })
  .strict()

const JsonRecordSchema = z.record(z.string().max(256), z.unknown()).superRefine((value, ctx) => {
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'value must be JSON serializable' })
    return
  }
  if (typeof serialized !== 'string' || serialized.length > MAX_WIRE_VALUE) {
    ctx.addIssue({ code: 'custom', message: 'serialized value is too large' })
  }
})

const noArgs = z.tuple([])
const actionResult = z
  .union([z.tuple([]), z.tuple([OptionalErrorSchema]), z.tuple([OptionalErrorSchema, z.unknown()])])
  .transform((args) => (typeof args[0] === 'string' ? [args[0]] : args.length === 0 ? [] : [args[0]]))
const result = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.tuple([ErrorSchema, z.unknown().optional()]), z.tuple([NullishSchema, schema])])
    .transform((args) => (typeof args[0] === 'string' ? [args[0]] : args))

const SignerIdSchema = z.object({ id: IdSchema }).transform(({ id }) => ({ id }))
const CompatibilitySchema = z
  .object({ signer: z.string().max(32), tx: z.string().max(32), compatible: z.boolean() })
  .strict()
const ApprovalTypeSchema = z.enum([
  'approveOtherChain',
  'approveGasLimit',
  'approveSimulationOverride',
  'approveBroadTokenAuthority',
  'approveExistingTokenAllowanceChange',
  'approveDelegatedAccountExecution',
  'approveProxyImplementationChange',
  'approveUnlimitedTokenPermit',
  'approveDangerousSignature'
])
const ActionIdSchema = z
  .enum([
    'erc20:approve',
    'erc20:revoke',
    'erc20:transfer',
    'ens:commit',
    'ens:register',
    'ens:renew',
    'ens:transfer',
    'ens:approve'
  ])
  .nullable()

const rpcSchemas = {
  approveRequest: {
    request: z.union([
      z.tuple([ActionRequestReferenceSchema]),
      z.tuple([ActionRequestReferenceSchema, WalletCallsApprovalOptionsSchema])
    ]),
    response: actionResult
  },
  retryTransactionRequest: {
    request: z.tuple([TransactionRequestReferenceSchema]),
    response: actionResult
  },
  replaceTransactionRequest: {
    request: z.tuple([TransactionRequestReferenceSchema, z.enum(['cancel', 'speed'])]),
    response: actionResult
  },
  closeFailedTransactionRequest: {
    request: z.tuple([TransactionRequestReferenceSchema]),
    response: actionResult
  },
  confirmRequestApproval: {
    request: z.tuple([RequestReferenceSchema, ApprovalTypeSchema, z.object({}).strict()]),
    response: actionResult
  },
  createAccount: {
    request: z.tuple([
      AddressSchema,
      z.string().trim().min(1).max(128),
      z.object({ type: z.enum(['ring', 'seed', 'trezor', 'ledger', 'lattice']) }).strict()
    ]),
    response: actionResult
  },
  createFromAddress: {
    request: z.tuple([AddressSchema, z.string().trim().min(1).max(128)]),
    response: actionResult
  },
  createFromKeystore: {
    request: z.tuple([JsonRecordSchema, PasswordSchema, PasswordSchema]),
    response: result(SignerIdSchema)
  },
  createFromPhrase: {
    request: z.tuple([
      z
        .string()
        .min(1)
        .max(MAX_SECRET)
        .refine((value) => value.trim().length > 0),
      PasswordSchema
    ]),
    response: result(SignerIdSchema)
  },
  createFromPrivateKey: {
    request: z.tuple([z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/), PasswordSchema]),
    response: result(SignerIdSchema)
  },
  createLattice: {
    request: z.tuple([z.string().min(1).max(64), z.string().max(14)]),
    response: result(SignerIdSchema)
  },
  declineRequest: { request: z.tuple([ActionRequestReferenceSchema]), response: actionResult },
  getFrameId: { request: noArgs, response: result(IdSchema) },
  getAccountExecutionState: {
    request: z.tuple([AddressSchema, ChainIdSchema]),
    response: result(AccountExecutionStateSchema)
  },
  getEip7702RevocationEligibility: {
    request: z.tuple([AddressSchema, ChainIdSchema]),
    response: result(Eip7702EligibilitySchema)
  },
  getState: { request: noArgs, response: result(JsonRecordSchema) },
  latticePair: {
    request: z.tuple([IdSchema, z.string().min(1).max(128)]),
    response: result(z.boolean())
  },
  locateKeystore: { request: noArgs, response: result(JsonRecordSchema) },
  removeAccount: {
    request: z.tuple([AddressSchema, z.object({}).strict()]),
    response: actionResult
  },
  requestEip7702Revocation: {
    request: z.tuple([AddressSchema, ChainIdSchema]),
    response: result(Eip7702RequestReferenceSchema)
  },
  stopEip7702RevocationMonitoring: {
    request: z.tuple([ActionRequestReferenceSchema]),
    response: actionResult
  },
  resolveEnsName: {
    request: z.tuple([z.string().min(1).max(255)]),
    response: result(AddressSchema)
  },
  respondToExtensionRequest: {
    request: z.tuple([z.string().min(1).max(512), z.boolean()]),
    response: actionResult
  },
  respondToNativePeerRequest: {
    request: z.tuple([z.string().uuid(), z.boolean()]),
    response: actionResult
  },
  revokeExtensionCredential: {
    request: z.tuple([z.string().regex(/^[A-Za-z0-9_-]{43}$/)]),
    response: actionResult
  },
  revokeNativePeerCredential: {
    request: z.tuple([z.string().regex(/^[A-Za-z0-9_-]{43}$/)]),
    response: actionResult
  },
  setBaseFee: {
    request: z.tuple([AddressSchema, QuantitySchema, HandlerIdSchema]),
    response: actionResult
  },
  setGasLimit: {
    request: z.tuple([AddressSchema, QuantitySchema, HandlerIdSchema]),
    response: actionResult
  },
  setGasPrice: {
    request: z.tuple([AddressSchema, QuantitySchema, HandlerIdSchema]),
    response: actionResult
  },
  setPriorityFee: {
    request: z.tuple([AddressSchema, QuantitySchema, HandlerIdSchema]),
    response: actionResult
  },
  setSigner: { request: z.tuple([AddressSchema]), response: actionResult },
  signerCompatibility: {
    request: z.tuple([AddressSchema, HandlerIdSchema]),
    response: result(CompatibilitySchema)
  },
  trezorEnterPhrase: { request: z.tuple([IdSchema]), response: actionResult },
  trezorPairing: {
    request: z.tuple([IdSchema, z.object({ tag: z.string().max(256) }).strict()]),
    response: actionResult
  },
  trezorPhrase: { request: z.tuple([IdSchema, z.string().max(256)]), response: actionResult },
  trezorPin: { request: z.tuple([IdSchema, z.string().max(64)]), response: actionResult },
  unlockSigner: { request: z.tuple([IdSchema, PasswordSchema]), response: actionResult },
  updateRequest: {
    request: z.tuple([
      AddressSchema,
      HandlerIdSchema,
      z.object({ amount: AmountSchema }).strict(),
      ActionIdSchema
    ]),
    response: actionResult
  },
  verifyAddress: { request: noArgs, response: actionResult }
} satisfies Record<string, { request: z.ZodType; response: z.ZodType }>

export type RendererRpcMethod = keyof typeof rpcSchemas
export const rendererRpcMethods = Object.freeze(Object.keys(rpcSchemas) as RendererRpcMethod[])

const parseWireValue = (value: unknown) => {
  if (value === undefined || value === null) return { success: true as const, data: value }
  if (typeof value !== 'string' || value.length > MAX_WIRE_VALUE) return { success: false as const }
  try {
    return { success: true as const, data: JSON.parse(value) }
  } catch {
    return { success: false as const }
  }
}

export const parseRendererRpcId = (value: unknown) => {
  const parsed = parseWireValue(value)
  if (!parsed.success || !Number.isSafeInteger(parsed.data) || parsed.data < 1) return undefined
  return parsed.data as number
}

export const parseRendererRpcRequest = (wireArgs: unknown[]) => {
  if (wireArgs.length < 2 || wireArgs.length > 8) return { success: false as const }
  const wireSize = wireArgs.reduce<number>(
    (total, value) =>
      total +
      (typeof value === 'string' ? value.length : value === null || value === undefined ? 0 : Infinity),
    0
  )
  if (wireSize > MAX_WIRE_VALUE) return { success: false as const }
  const id = parseRendererRpcId(wireArgs[0])
  const methodValue = parseWireValue(wireArgs[1])
  if (!id || !methodValue.success || typeof methodValue.data !== 'string') return { success: false as const }
  const method = methodValue.data as RendererRpcMethod
  const definition = rpcSchemas[method]
  if (!definition) return { success: false as const, id }

  const decoded = wireArgs.slice(2).map(parseWireValue)
  if (decoded.some((entry) => !entry.success)) return { success: false as const, id, method }
  const parsed = definition.request.safeParse(decoded.map((entry) => entry.data))
  if (!parsed.success) return { success: false as const, id, method }
  return { success: true as const, data: { id, method, args: parsed.data as unknown[] } }
}

const normalizeResponse = (value: unknown) => (value instanceof Error ? value.message : value)

export const parseRendererRpcResponse = (method: RendererRpcMethod, args: unknown[]) =>
  rpcSchemas[method].response.safeParse(args.map(normalizeResponse))

export const encodeRendererRpcValues = (values: unknown[]) => {
  let wireSize = 0
  return values.map((value) => {
    if (value === undefined || value === null) return value
    const encoded = JSON.stringify(value)
    wireSize += encoded.length
    if (wireSize > MAX_WIRE_VALUE) throw new Error('Renderer RPC response is too large')
    return encoded
  })
}
