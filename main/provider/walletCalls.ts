import { z } from 'zod'

export const WALLET_CALLS_VERSION = '2.0.0'
export const MAX_WALLET_CALLS = 16
export const MAX_WALLET_CALL_DATA_BYTES = 128 * 1024
export const MAX_WALLET_CALL_ID_BYTES = 4096
export const MAX_CAPABILITY_CHAINS = 64

const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_UINT256 = (1n << 256n) - 1n
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const CHAIN_ID = QUANTITY

export interface WalletCall {
  to?: string
  data: string
  value: string
}

export interface SendCallsRequest {
  version: typeof WALLET_CALLS_VERSION
  id?: string
  from?: string
  chainId: string
  atomicRequired: false
  calls: WalletCall[]
}

export interface GetCapabilitiesRequest {
  address: string
  chainIds?: string[]
}

function walletCallsError(code: number, message: string): EVMError {
  return { code, message }
}

function invalidParams(message: string) {
  return walletCallsError(-32602, `Invalid params: ${message}`)
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw invalidParams(result.error.issues[0]?.message || 'invalid wallet call request')
  return result.data
}

function singleParamError(issue: { input?: unknown }) {
  if (issue.input === undefined) return 'Required'
  if (Array.isArray(issue.input) && issue.input.length < 1) {
    return 'Array must contain at least 1 element(s)'
  }
  if (Array.isArray(issue.input) && issue.input.length > 1) {
    return 'Array must contain at most 1 element(s)'
  }

  return undefined
}

const addressSchema = z
  .string()
  .regex(ADDRESS, 'address must be a 20-byte 0x-prefixed hex value')
  .transform((value) => value.toLowerCase())

const dataSchema = z
  .string()
  .regex(DATA, 'data must be an even-length 0x-prefixed byte string')
  .transform((value) => value.toLowerCase())

const quantitySchema = z
  .string()
  .regex(QUANTITY, 'value must be a canonical 0x-prefixed hex quantity')
  .refine((value) => !QUANTITY.test(value) || BigInt(value) <= MAX_UINT256, 'value exceeds uint256')
  .transform((value) => value.toLowerCase())

const chainIdSchema = z
  .string()
  .max(66, 'chainId exceeds 256 bits')
  .regex(CHAIN_ID, 'chainId must be a canonical 0x-prefixed hex quantity')
  .transform((value) => value.toLowerCase())

const batchIdSchema = z.string().min(1, 'batch id must not be empty')

const capabilitySchema = z.object({ optional: z.boolean().optional() }).catchall(z.unknown())

const capabilitiesSchema = z
  .record(z.string().min(1).max(128), capabilitySchema)
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 32) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'capabilities contains too many entries' })
    }
  })

const callSchema = z
  .object({
    to: addressSchema.optional(),
    data: dataSchema.optional().default('0x'),
    value: quantitySchema.optional().default('0x0'),
    capabilities: capabilitiesSchema.optional()
  })
  .strict()

const sendCallsSchema = z.tuple(
  [
    z
      .object({
        version: z.literal(WALLET_CALLS_VERSION, { error: 'Invalid literal value' }),
        id: batchIdSchema.optional(),
        from: addressSchema.optional(),
        chainId: chainIdSchema,
        atomicRequired: z.boolean({ error: 'Expected boolean' }),
        calls: z.array(callSchema).min(1, 'calls must contain at least one call'),
        capabilities: capabilitiesSchema.optional()
      })
      .strict()
  ],
  { error: singleParamError }
)

const batchIdParamsSchema = z.tuple([batchIdSchema], { error: singleParamError })
const capabilityChainIdsSchema = z.array(chainIdSchema)

function assertBoundedId(id: string | undefined) {
  if (id !== undefined && Buffer.byteLength(id, 'utf8') > MAX_WALLET_CALL_ID_BYTES) {
    throw invalidParams(`batch id exceeds ${MAX_WALLET_CALL_ID_BYTES} UTF-8 bytes`)
  }
}

function assertOptionalCapabilities(capabilities: z.infer<typeof capabilitiesSchema> | undefined) {
  const unsupported = Object.entries(capabilities || {}).find(([_name, capability]) => !capability.optional)
  if (unsupported) {
    throw walletCallsError(5700, `Unsupported non-optional capability: ${unsupported[0]}`)
  }
}

export function parseSendCalls(params: unknown): SendCallsRequest {
  const [request] = parseSchema(sendCallsSchema, params)
  assertBoundedId(request.id)

  if (request.calls.length > MAX_WALLET_CALLS) {
    throw walletCallsError(5740, `Bundle too large: Wren supports at most ${MAX_WALLET_CALLS} calls`)
  }
  if (BigInt(request.chainId) === 0n || BigInt(request.chainId) > MAX_SAFE_CHAIN_ID) {
    throw walletCallsError(5710, `Unsupported chain id: ${request.chainId}`)
  }
  if (request.atomicRequired) {
    throw walletCallsError(5760, 'Atomicity not supported')
  }

  assertOptionalCapabilities(request.capabilities)
  request.calls.forEach((call) => assertOptionalCapabilities(call.capabilities))

  const calls = request.calls.map(({ to, data = '0x', value = '0x0' }) => ({
    ...(to ? { to } : {}),
    data,
    value
  }))
  const totalDataBytes = calls.reduce((total, call) => total + (call.data.length - 2) / 2, 0)
  if (totalDataBytes > MAX_WALLET_CALL_DATA_BYTES) {
    throw walletCallsError(5740, `Bundle too large: calldata exceeds ${MAX_WALLET_CALL_DATA_BYTES} bytes`)
  }

  return {
    version: request.version,
    ...(request.id !== undefined ? { id: request.id } : {}),
    ...(request.from !== undefined ? { from: request.from } : {}),
    chainId: request.chainId,
    atomicRequired: false,
    calls
  }
}

export function parseCallsStatus(params: unknown) {
  const [id] = parseSchema(batchIdParamsSchema, params)
  assertBoundedId(id)
  return id
}

export const parseShowCallsStatus = parseCallsStatus

export function parseGetCapabilities(params: unknown): GetCapabilitiesRequest {
  if (!Array.isArray(params) || params.length < 1 || params.length > 2) {
    throw invalidParams('wallet_getCapabilities requires [address, chainIds?]')
  }

  const address = parseSchema(addressSchema, params[0])
  const chainIds = params.length === 2 ? parseSchema(capabilityChainIdsSchema, params[1]) : undefined
  if (chainIds && chainIds.length > MAX_CAPABILITY_CHAINS) {
    throw invalidParams(`chain list exceeds ${MAX_CAPABILITY_CHAINS} entries`)
  }

  return {
    address,
    ...(chainIds ? { chainIds: [...new Set(chainIds)] } : {})
  }
}
