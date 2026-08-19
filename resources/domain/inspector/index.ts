import { z } from 'zod'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import { normalizeAccessList, type RpcAccessList } from '../transaction/accessList'
import { parseRpcQuantity, toRpcQuantity } from '../transaction/quantity'
import { parseTypedMessage } from '../typedData'

export const MAX_INSPECTOR_INPUT_BYTES = 256 * 1024
export const MAX_INSPECTOR_CALLDATA_BYTES = 128 * 1024
export const MAX_INSPECTOR_JSON_DEPTH = 24
export const MAX_INSPECTOR_JSON_NODES = 4096

const ADDRESS = /^0x[0-9a-f]{40}$/i
const DATA = /^0x(?:[0-9a-f]{2})*$/i
const TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/
const FIELD_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/
const ARRAY_SUFFIX = /\[(?:|[1-9][0-9]{0,5})\]$/
const INTEGER_TYPE =
  /^(?:u?int)(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)$/
const BYTES_TYPE = /^bytes(?:[1-9]|[12][0-9]|3[0-2])$/
const DECIMAL_CHAIN_ID = /^[1-9][0-9]*$/
const HEX_CHAIN_ID = /^0x[1-9a-fA-F][0-9a-fA-F]*$/
const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER)

function parseCanonicalChainContext(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || (!DECIMAL_CHAIN_ID.test(value) && !HEX_CHAIN_ID.test(value))) {
    return
  }
  return BigInt(value)
}

const inputText = z.string().min(1).max(MAX_INSPECTOR_INPUT_BYTES)
const address = z.string().regex(ADDRESS)
const quantity = z.string().refine((value) => parseRpcQuantity(value) !== undefined, 'Invalid RPC quantity')
const chainContext = z.string().min(1).max(80)
const CalldataInputSchema = z
  .object({
    kind: z.literal('calldata'),
    data: z
      .string()
      .min(2)
      .max(MAX_INSPECTOR_CALLDATA_BYTES * 2 + 2)
      .regex(DATA),
    chainId: chainContext.optional(),
    from: address.optional(),
    to: address.optional(),
    value: quantity.optional()
  })
  .strict()

export const InspectorInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transaction'), input: inputText }).strict(),
  CalldataInputSchema,
  z
    .object({
      kind: z.literal('typed-data'),
      input: inputText,
      chainId: chainContext.optional(),
      version: z.enum(['V3', 'V4']).optional()
    })
    .strict(),
  z.object({ kind: z.literal('json-rpc'), input: inputText, chainId: chainContext.optional() }).strict()
])

export type InspectorInput = z.infer<typeof InspectorInputSchema>

export interface InspectorTransaction {
  from?: string
  to?: string
  data?: string
  value?: string
  nonce?: string
  gas?: string
  gasPrice?: string
  maxPriorityFeePerGas?: string
  maxFeePerGas?: string
  chainId?: string
  type: '0x0' | '0x1' | '0x2'
  accessList?: RpcAccessList
}

export interface InspectorCalldataContext {
  data: string
  chainId?: string
  from?: string
  to?: string
  value?: string
}

export interface InspectorTypedDataField {
  name: string
  type: string
}

export interface InspectorTypedData {
  types: Record<string, InspectorTypedDataField[]>
  primaryType: string
  domain: Record<string, JsonValue>
  message: Record<string, JsonValue>
}

export type InspectorSource =
  | { kind: 'direct' }
  | {
      kind: 'json-rpc'
      method:
        | 'eth_sendTransaction'
        | 'eth_call'
        | 'eth_estimateGas'
        | 'eth_signTypedData_v3'
        | 'eth_signTypedData_v4'
      id: string | number
      block?: string
    }

export type ParsedInspectorSubject =
  | { kind: 'transaction'; transaction: InspectorTransaction; source: InspectorSource }
  | { kind: 'calldata'; context: InspectorCalldataContext; source: { kind: 'direct' } }
  | {
      kind: 'typed-data'
      typedData: InspectorTypedData
      version: 'V3' | 'V4'
      chainId?: string
      signer?: string
      source: InspectorSource
    }

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

interface InspectorRecord extends Record<string, unknown> {
  accessList?: unknown
  chainId?: unknown
  data?: unknown
  domain?: unknown
  from?: unknown
  gas?: unknown
  gasLimit?: unknown
  gasPrice?: unknown
  id?: unknown
  jsonrpc?: unknown
  maxFeePerGas?: unknown
  maxPriorityFeePerGas?: unknown
  message?: unknown
  method?: unknown
  name?: unknown
  nonce?: unknown
  params?: unknown
  primaryType?: unknown
  to?: unknown
  type?: unknown
  types?: unknown
  value?: unknown
}

function isRecord(value: unknown): value is InspectorRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key))
  if (unsupported) throw new Error(`${label} field '${unsupported}' is not supported`)
}

function parseJson(input: string, label: string): unknown {
  if (new TextEncoder().encode(input).byteLength > MAX_INSPECTOR_INPUT_BYTES) {
    throw new Error(`${label} exceeds ${MAX_INSPECTOR_INPUT_BYTES} bytes`)
  }

  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
  assertBoundedJson(value, label)
  return value
}

function assertBoundedJson(value: unknown, label: string) {
  let nodes = 0
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1
    if (nodes > MAX_INSPECTOR_JSON_NODES) throw new Error(`${label} is too complex`)
    if (depth > MAX_INSPECTOR_JSON_DEPTH) throw new Error(`${label} is too deeply nested`)
    if (candidate === null || typeof candidate === 'boolean') return
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_INSPECTOR_INPUT_BYTES)
        throw new Error(`${label} contains an oversized string`)
      return
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new Error(`${label} contains a non-finite number`)
      if (!Number.isSafeInteger(candidate)) {
        throw new Error(`${label} contains an unsafe JSON number; use a quoted integer`)
      }
      return
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (!isRecord(candidate)) throw new Error(`${label} must contain JSON values only`)
    Object.entries(candidate).forEach(([key, entry]) => {
      if (key.length > 128) throw new Error(`${label} contains an oversized field name`)
      visit(entry, depth + 1)
    })
  }
  visit(value, 0)
}

function normalizeAddress(value: unknown, label: string): string | undefined {
  if (value === undefined) return
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error(`${label} must be an exact address`)
  return value.toLowerCase()
}

function normalizeQuantity(value: unknown, label: string): string | undefined {
  if (value === undefined) return
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined) throw new Error(`${label} must be a canonical uint256 RPC quantity`)
  return toRpcQuantity(parsed)
}

function normalizeData(value: unknown, label: string, required = false): string | undefined {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || value.length > MAX_INSPECTOR_CALLDATA_BYTES * 2 + 2 || !DATA.test(value)) {
    throw new Error(`${label} must be bounded even-length hexadecimal data`)
  }
  return value.toLowerCase()
}

function normalizeChainContext(value: unknown, label: string): string | undefined {
  if (value === undefined) return
  const parsed = parseCanonicalChainContext(value)
  if (parsed === undefined) {
    throw new Error(`${label} must be a canonical positive decimal or hexadecimal integer`)
  }
  if (parsed > MAX_SAFE_CHAIN_ID) {
    throw new Error(`${label} exceeds the supported safe-integer range`)
  }
  return toRpcQuantity(parsed)
}

function normalizeEmbeddedChainId(value: unknown, label: string): string | undefined {
  const chainId = normalizeQuantity(value, label)
  if (chainId === '0x0') throw new Error(`${label} must be positive`)
  if (chainId && BigInt(chainId) > MAX_SAFE_CHAIN_ID) {
    throw new Error(`${label} exceeds the supported safe-integer range`)
  }
  return chainId
}

function mergeChainContext(embedded: string | undefined, supplied: string | undefined): string | undefined {
  if (embedded && supplied && embedded !== supplied)
    throw new Error('Embedded chainId does not match inspector chainId')
  return embedded || supplied
}

export function parseUnsignedTransaction(value: unknown, suppliedChainId?: string): InspectorTransaction {
  if (!isRecord(value)) throw new Error('Unsigned transaction must be an object')
  exactKeys(
    value,
    [
      'nonce',
      'gasPrice',
      'gas',
      'gasLimit',
      'maxPriorityFeePerGas',
      'maxFeePerGas',
      'from',
      'to',
      'data',
      'value',
      'chainId',
      'type',
      'accessList'
    ],
    'Transaction'
  )
  if (value.gas !== undefined && value.gasLimit !== undefined) {
    throw new Error('Transaction cannot contain both gas and gasLimit')
  }

  const gasPrice = normalizeQuantity(value.gasPrice, 'gasPrice')
  const maxPriorityFeePerGas = normalizeQuantity(value.maxPriorityFeePerGas, 'maxPriorityFeePerGas')
  const maxFeePerGas = normalizeQuantity(value.maxFeePerGas, 'maxFeePerGas')
  if (gasPrice && (maxPriorityFeePerGas || maxFeePerGas)) {
    throw new Error('Transaction cannot mix legacy and EIP-1559 fees')
  }
  if (maxPriorityFeePerGas && maxFeePerGas && BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) {
    throw new Error('Transaction priority fee cannot exceed max fee per gas')
  }

  const accessList = normalizeAccessList(value.accessList)
  const explicitType = normalizeQuantity(value.type, 'type')
  if (explicitType && !['0x0', '0x1', '0x2'].includes(explicitType)) {
    throw new Error('Only transaction types 0, 1, and 2 are supported')
  }
  const inferredType = maxPriorityFeePerGas || maxFeePerGas ? '0x2' : accessList ? '0x1' : '0x0'
  const type = (explicitType || inferredType) as InspectorTransaction['type']
  if (type === '0x0' && accessList) throw new Error('Legacy transactions cannot contain an access list')
  if (type === '0x1' && (maxPriorityFeePerGas || maxFeePerGas)) {
    throw new Error('Type-1 transactions cannot contain EIP-1559 fees')
  }
  if (type === '0x2' && gasPrice) throw new Error('Type-2 transactions cannot contain gasPrice')

  const embeddedChainId = normalizeEmbeddedChainId(value.chainId, 'chainId')
  const requestedChainId = suppliedChainId
    ? normalizeChainContext(suppliedChainId, 'inspector chainId')
    : undefined
  const chainId = mergeChainContext(embeddedChainId, requestedChainId)
  const gas = normalizeQuantity(value.gas ?? value.gasLimit, 'gas')
  const transaction: InspectorTransaction = { type }
  const normalized = {
    from: normalizeAddress(value.from, 'from'),
    to: value.to === null ? undefined : normalizeAddress(value.to, 'to'),
    data: normalizeData(value.data, 'data'),
    value: normalizeQuantity(value.value, 'value'),
    nonce: normalizeQuantity(value.nonce, 'nonce'),
    gas,
    gasPrice,
    maxPriorityFeePerGas,
    maxFeePerGas,
    chainId,
    accessList
  }
  Object.entries(normalized).forEach(([key, entry]) => {
    if (entry !== undefined) Object.assign(transaction, { [key]: entry })
  })
  return transaction
}

export function parseCalldataContext(value: unknown): InspectorCalldataContext {
  const parsed = CalldataInputSchema.parse(value)
  const chainId = parsed.chainId ? normalizeChainContext(parsed.chainId, 'chainId') : undefined
  const valueQuantity = parsed.value ? normalizeQuantity(parsed.value, 'value') : undefined
  return {
    data: normalizeData(parsed.data, 'data', true) as string,
    ...(chainId ? { chainId } : {}),
    ...(parsed.from ? { from: parsed.from.toLowerCase() } : {}),
    ...(parsed.to ? { to: parsed.to.toLowerCase() } : {}),
    ...(valueQuantity ? { value: valueQuantity } : {})
  }
}

function baseType(type: string): string {
  let result = type
  while (ARRAY_SUFFIX.test(result)) result = result.replace(ARRAY_SUFFIX, '')
  return result
}

function validFieldType(type: string, customTypes: Set<string>): boolean {
  const base = baseType(type)
  const suffix = type.slice(base.length)
  const suffixes = suffix.match(/\[(?:|[1-9][0-9]{0,5})\]/g) || []
  if (suffixes.join('') !== suffix || suffixes.length > 4) return false
  return (
    base === 'address' ||
    base === 'bool' ||
    base === 'string' ||
    base === 'bytes' ||
    BYTES_TYPE.test(base) ||
    INTEGER_TYPE.test(base) ||
    customTypes.has(base)
  )
}

export function parseEip712TypedData(value: unknown, version: 'V3' | 'V4' = 'V4'): InspectorTypedData {
  if (!isRecord(value)) throw new Error('EIP-712 typed data must be an object')
  exactKeys(value, ['types', 'primaryType', 'domain', 'message'], 'EIP-712 typed data')
  if (
    !isRecord(value.types) ||
    Object.keys(value.types).length === 0 ||
    Object.keys(value.types).length > 64
  ) {
    throw new Error('EIP-712 types must contain 1 to 64 definitions')
  }
  if (typeof value.primaryType !== 'string' || !TYPE_NAME.test(value.primaryType)) {
    throw new Error('EIP-712 primaryType is invalid')
  }
  if (!isRecord(value.domain) || !isRecord(value.message)) {
    throw new Error('EIP-712 domain and message must be objects')
  }

  const customTypes = new Set(Object.keys(value.types))
  if (!customTypes.has(value.primaryType)) throw new Error('EIP-712 primaryType is not defined')
  if (!customTypes.has('EIP712Domain')) throw new Error('EIP-712 domain type is not defined')
  const types: Record<string, InspectorTypedDataField[]> = {}
  Object.entries(value.types).forEach(([name, fields]) => {
    if (!TYPE_NAME.test(name) || !Array.isArray(fields) || fields.length > 64) {
      throw new Error(`EIP-712 type '${name}' is invalid`)
    }
    const names = new Set<string>()
    types[name] = fields.map((field, index) => {
      if (!isRecord(field)) throw new Error(`EIP-712 type '${name}' field ${index} is invalid`)
      exactKeys(field, ['name', 'type'], `EIP-712 type '${name}' field ${index}`)
      if (typeof field.name !== 'string' || !FIELD_NAME.test(field.name) || names.has(field.name)) {
        throw new Error(`EIP-712 type '${name}' has an invalid or duplicate field name`)
      }
      if (typeof field.type !== 'string' || !validFieldType(field.type, customTypes)) {
        throw new Error(`EIP-712 type '${name}' field '${field.name}' has an invalid type`)
      }
      names.add(field.name)
      return { name: field.name, type: field.type }
    })
  })

  assertBoundedJson(value.domain, 'EIP-712 domain')
  assertBoundedJson(value.message, 'EIP-712 message')
  parseTypedMessage(value, version === 'V3' ? SignTypedDataVersion.V3 : SignTypedDataVersion.V4)
  return {
    types,
    primaryType: value.primaryType,
    domain: structuredClone(value.domain) as Record<string, JsonValue>,
    message: structuredClone(value.message) as Record<string, JsonValue>
  }
}

function normalizeBlock(value: unknown): string {
  if (['latest', 'pending', 'safe', 'finalized', 'earliest'].includes(value as string)) return value as string
  const quantity = normalizeQuantity(value, 'block reference')
  if (!quantity) throw new Error('Block reference is invalid')
  return quantity
}

function parseRpcId(value: unknown): string | number {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error('JSON-RPC id must be a bounded string or safe integer')
}

export function parseInspectorJsonRpcRequest(
  value: unknown,
  suppliedChainId?: string
): ParsedInspectorSubject {
  if (!isRecord(value)) throw new Error('JSON-RPC request must be an object')
  exactKeys(value, ['jsonrpc', 'id', 'method', 'params'], 'JSON-RPC request')
  if (value.jsonrpc !== '2.0') throw new Error('JSON-RPC version must be 2.0')
  const id = parseRpcId(value.id)
  if (!Array.isArray(value.params)) throw new Error('JSON-RPC params must be an array')
  const method = value.method
  if (
    method !== 'eth_sendTransaction' &&
    method !== 'eth_call' &&
    method !== 'eth_estimateGas' &&
    method !== 'eth_signTypedData_v3' &&
    method !== 'eth_signTypedData_v4'
  ) {
    throw new Error('JSON-RPC method is not supported by the inspector')
  }

  if (method === 'eth_sendTransaction') {
    if (value.params.length !== 1) throw new Error('eth_sendTransaction requires exactly one parameter')
    return {
      kind: 'transaction',
      transaction: parseUnsignedTransaction(value.params[0], suppliedChainId),
      source: { kind: 'json-rpc', method, id }
    }
  }
  if (method === 'eth_call' || method === 'eth_estimateGas') {
    if (value.params.length < 1 || value.params.length > 2) {
      throw new Error(`${method} requires one transaction and an optional block reference`)
    }
    const block = value.params[1] === undefined ? undefined : normalizeBlock(value.params[1])
    return {
      kind: 'transaction',
      transaction: parseUnsignedTransaction(value.params[0], suppliedChainId),
      source: { kind: 'json-rpc', method, id, ...(block ? { block } : {}) }
    }
  }

  if (value.params.length !== 2) throw new Error(`${method} requires exactly two parameters`)
  const firstIsAddress = typeof value.params[0] === 'string' && ADDRESS.test(value.params[0])
  const secondIsAddress = typeof value.params[1] === 'string' && ADDRESS.test(value.params[1])
  if (!firstIsAddress && !secondIsAddress) throw new Error('Typed-data signer is required')
  const signerValue = firstIsAddress ? value.params[0] : value.params[1]
  const typedDataValue = firstIsAddress ? value.params[1] : value.params[0]
  const signer = normalizeAddress(signerValue, 'typed-data signer')
  if (!signer) throw new Error('Typed-data signer is required')
  const rawTypedData =
    typeof typedDataValue === 'string' ? parseJson(typedDataValue, 'JSON-RPC typed data') : typedDataValue
  const version = method === 'eth_signTypedData_v3' ? 'V3' : 'V4'
  const typedData = parseEip712TypedData(rawTypedData, version)
  const chainId = suppliedChainId ? normalizeChainContext(suppliedChainId, 'inspector chainId') : undefined
  return {
    kind: 'typed-data',
    typedData,
    version,
    ...(chainId ? { chainId } : {}),
    signer,
    source: { kind: 'json-rpc', method, id }
  }
}

export function parseInspectorInput(value: unknown): ParsedInspectorSubject {
  const input = InspectorInputSchema.parse(value)
  if (input.kind === 'calldata') {
    return { kind: 'calldata', context: parseCalldataContext(input), source: { kind: 'direct' } }
  }
  if (input.kind === 'transaction') {
    return {
      kind: 'transaction',
      transaction: parseUnsignedTransaction(parseJson(input.input, 'Unsigned transaction')),
      source: { kind: 'direct' }
    }
  }
  if (input.kind === 'json-rpc') {
    return parseInspectorJsonRpcRequest(parseJson(input.input, 'JSON-RPC request'), input.chainId)
  }

  const version = input.version || 'V4'
  const typedData = parseEip712TypedData(parseJson(input.input, 'EIP-712 typed data'), version)
  const chainId = input.chainId ? normalizeChainContext(input.chainId, 'inspector chainId') : undefined
  return {
    kind: 'typed-data',
    typedData,
    version,
    ...(chainId ? { chainId } : {}),
    source: { kind: 'direct' }
  }
}
