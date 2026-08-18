import type { MessageTypes, TypedDataV1, TypedMessage as BaseTypedMessage } from '@metamask/eth-sig-util'
import { SignTypedDataVersion, TypedDataUtils, typedSignatureHash } from '@metamask/eth-sig-util'
import { getPermit2Authority } from '../../main/signatures/permit2'
import { getEip3009Authorization } from '../../main/signatures/eip3009'

export type TypedData<T extends MessageTypes = MessageTypes> = BaseTypedMessage<T>
export type LegacyTypedData = TypedDataV1

export interface TypedMessage<V extends SignTypedDataVersion = SignTypedDataVersion> {
  data: V extends SignTypedDataVersion.V1 ? LegacyTypedData : TypedData
  version: V
}

export type TypedDataRisk =
  | 'legacy-v1'
  | 'domain-chain-missing'
  | 'domain-chain-invalid'
  | 'domain-chain-mismatch'
  | 'permit2-allowance'
  | 'permit2-transfer'
  | 'permit2-maximum-amount'
  | 'permit2-noncanonical-contract'
  | 'eip3009-transfer'
  | 'eip3009-maximum-amount'

export interface Permit2Permission {
  token: string
  amount: string
  expiration?: string
}

export interface Permit2Authority {
  kind: 'allowance' | 'transfer'
  primaryType:
    | 'PermitSingle'
    | 'PermitBatch'
    | 'PermitTransferFrom'
    | 'PermitBatchTransferFrom'
    | 'PermitWitnessTransferFrom'
    | 'PermitBatchWitnessTransferFrom'
  verifyingContract: string
  canonicalContract: boolean
  spender: string
  deadline: string
  permissions: Permit2Permission[]
  batch: boolean
  witness: boolean
  grantsAuthority: boolean
  maximumAmount: boolean
}

export interface Eip3009Authorization {
  kind: 'transfer' | 'receive' | 'cancel'
  primaryType: 'TransferWithAuthorization' | 'ReceiveWithAuthorization' | 'CancelAuthorization'
  verifyingContract: string
  authorizer: string
  from?: string
  to?: string
  value?: string
  validAfter?: string
  validBefore?: string
  nonce: string
  grantsAuthority: boolean
  maximumAmount: boolean
}

export interface TypedDataContext {
  requestChainId: number
  domainChainId?: string
  risks: TypedDataRisk[]
  permit2?: Permit2Authority
  eip3009?: Eip3009Authorization
}

interface UnknownRecord extends Record<string, unknown> {
  name?: unknown
  type?: unknown
  types?: unknown
  primaryType?: unknown
  domain?: unknown
  message?: unknown
}
type TypeDefinitions = Record<string, Array<{ name: string; type: string }>>

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const ARRAY_TYPE = /\[(?:[1-9][0-9]*)?\]$/
const ARRAY_SUFFIXES = /(\[(?:[1-9][0-9]*)?\])+$/
const INTEGER_TYPE = /^(u?int)([0-9]+)$/
const BYTES_TYPE = /^bytes([0-9]+)$/
const MAX_UINT256 = (1n << 256n) - 1n
const hasOwn = (value: object, property: PropertyKey) => Object.prototype.hasOwnProperty.call(value, property)
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function invalidParams(message: string): EVMError {
  return { code: -32602, message: `Invalid params: ${message}` }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'typed data cannot be encoded'
}

function containsArrays(types: TypeDefinitions) {
  return Object.values(types)
    .flat()
    .some(({ type }) => ARRAY_TYPE.test(type))
}

function referencedType(type: string) {
  return type.replace(ARRAY_SUFFIXES, '')
}

function isAtomicType(type: string) {
  if (['address', 'bool', 'bytes', 'string'].includes(type)) return true

  const bytesMatch = type.match(BYTES_TYPE)
  if (bytesMatch) {
    const size = Number(bytesMatch[1])
    return size >= 1 && size <= 32
  }

  const integerMatch = type.match(INTEGER_TYPE)
  if (integerMatch) {
    const size = Number(integerMatch[2])
    return size >= 8 && size <= 256 && size % 8 === 0
  }

  return false
}

function isValidFieldType(type: string, types: TypeDefinitions) {
  const baseType = referencedType(type)
  const suffix = type.slice(baseType.length)

  if (suffix && !ARRAY_SUFFIXES.test(suffix)) return false
  if (isAtomicType(baseType)) return true
  if (/^(?:u?int|bytes)[0-9]*$/.test(baseType)) return false
  return IDENTIFIER.test(baseType) && hasOwn(types, baseType)
}

function containsRecursiveTypes(types: TypeDefinitions, roots: string[]) {
  const visited = new Set<string>()
  const active = new Set<string>()

  const visit = (type: string): boolean => {
    if (active.has(type)) return true
    if (visited.has(type) || !hasOwn(types, type)) return false

    active.add(type)
    const fields = types[type]
    if (!fields) return false
    const recursive = fields.some(({ type: fieldType }) => visit(referencedType(fieldType)))
    active.delete(type)
    visited.add(type)
    return recursive
  }

  return roots.some(visit)
}

function validateTypeDefinitions(value: unknown): TypeDefinitions {
  if (!isRecord(value)) throw invalidParams('typed data types must be an object')

  const entries = Object.entries(value)
  if (entries.length === 0) throw invalidParams('typed data types must not be empty')

  for (const [typeName, fields] of entries) {
    if (!IDENTIFIER.test(typeName) || isAtomicType(typeName) || /^(?:u?int|bytes)[0-9]*$/.test(typeName)) {
      throw invalidParams(`typed data type name ${typeName || '<empty>'} is invalid`)
    }
    if (!Array.isArray(fields)) {
      throw invalidParams(`typed data type ${typeName} must be an array`)
    }

    const names = new Set<string>()
    for (const field of fields) {
      if (!isRecord(field) || typeof field.name !== 'string' || !IDENTIFIER.test(field.name)) {
        throw invalidParams(`typed data type ${typeName} contains an invalid field name`)
      }
      if (typeof field.type !== 'string' || !field.type.trim()) {
        throw invalidParams(`typed data field ${typeName}.${field.name} has an invalid type`)
      }
      if (names.has(field.name)) {
        throw invalidParams(`typed data type ${typeName} contains duplicate field ${field.name}`)
      }
      names.add(field.name)
    }
  }

  const types = value as TypeDefinitions
  for (const [typeName, fields] of entries) {
    for (const field of fields as TypeDefinitions[string]) {
      if (!isValidFieldType(field.type, types)) {
        throw invalidParams(`typed data field ${typeName}.${field.name} has invalid type ${field.type}`)
      }
    }
  }

  return types
}

function validateLegacyTypedData(value: unknown): LegacyTypedData {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidParams('V1 typed data must be a non-empty array')
  }

  for (const field of value) {
    if (!isRecord(field) || typeof field.name !== 'string' || !field.name.trim()) {
      throw invalidParams('V1 typed data contains an invalid field name')
    }
    if (typeof field.type !== 'string' || !field.type.trim()) {
      throw invalidParams(`V1 typed data field ${field.name} has an invalid type`)
    }
    if (!hasOwn(field, 'value')) {
      throw invalidParams(`V1 typed data field ${field.name} is missing a value`)
    }
  }

  try {
    typedSignatureHash(value as LegacyTypedData)
  } catch (error) {
    throw invalidParams(errorMessage(error))
  }

  return value as LegacyTypedData
}

function validateEip712TypedData(
  value: unknown,
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4
): TypedData {
  if (!isRecord(value)) throw invalidParams(`${version} typed data must be an object`)

  const types = validateTypeDefinitions(value.types)
  if (!hasOwn(types, 'EIP712Domain')) {
    throw invalidParams('typed data types must define EIP712Domain')
  }
  if (typeof value.primaryType !== 'string' || !value.primaryType.trim()) {
    throw invalidParams('typed data primaryType must be a non-empty string')
  }
  if (!hasOwn(types, value.primaryType)) {
    throw invalidParams(`typed data primaryType ${value.primaryType} is not defined`)
  }
  if (!isRecord(value.domain)) throw invalidParams('typed data domain must be an object')
  if (!isRecord(value.message)) throw invalidParams('typed data message must be an object')

  if (version === SignTypedDataVersion.V3) {
    if (containsArrays(types)) throw invalidParams('V3 typed data does not support arrays')
    if (containsRecursiveTypes(types, ['EIP712Domain', value.primaryType])) {
      throw invalidParams('V3 typed data does not support recursive types')
    }
  }

  try {
    TypedDataUtils.eip712Hash(value as unknown as TypedData, version)
  } catch (error) {
    throw invalidParams(errorMessage(error))
  }

  return value as unknown as TypedData
}

export function getVersionFromTypedData(typedData: unknown) {
  if (Array.isArray(typedData)) return SignTypedDataVersion.V1
  if (!isRecord(typedData) || !isRecord(typedData.types)) return SignTypedDataVersion.V4

  const types = Object.values(typedData.types).filter(Array.isArray) as TypeDefinitions[string][]
  if (types.flat().some((field) => isRecord(field) && ARRAY_TYPE.test(String(field.type)))) {
    return SignTypedDataVersion.V4
  }

  const { message, primaryType } = typedData
  if (
    typeof primaryType === 'string' &&
    hasOwn(typedData.types, primaryType) &&
    Array.isArray(typedData.types[primaryType]) &&
    isRecord(message)
  ) {
    const fields = typedData.types[primaryType] as unknown[]
    const definitions = Object.fromEntries(
      Object.entries(typedData.types).map(([name, value]) => [
        name,
        Array.isArray(value)
          ? value.filter(
              (field): field is { name: string; type: string } =>
                isRecord(field) && typeof field.name === 'string' && typeof field.type === 'string'
            )
          : []
      ])
    ) as TypeDefinitions
    if (containsRecursiveTypes(definitions, ['EIP712Domain', primaryType])) {
      return SignTypedDataVersion.V4
    }

    const hasUndefinedType = fields.some(
      (field) => isRecord(field) && typeof field.name === 'string' && message[field.name] === undefined
    )
    if (hasUndefinedType) return SignTypedDataVersion.V3
  }

  return SignTypedDataVersion.V4
}

export function parseTypedMessage(typedData: unknown, requestedVersion?: SignTypedDataVersion): TypedMessage {
  const version = requestedVersion || getVersionFromTypedData(typedData)

  if (version === SignTypedDataVersion.V1) {
    return { data: validateLegacyTypedData(typedData), version }
  }
  if (version === SignTypedDataVersion.V3 || version === SignTypedDataVersion.V4) {
    return { data: validateEip712TypedData(typedData, version), version }
  }

  throw invalidParams(`unsupported typed data version ${String(version)}`)
}

function normalizeDomainChainId(value: unknown) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return
  if (typeof value === 'bigint' && value < 0n) return
  if (
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value))
  ) {
    return
  }

  try {
    const chainId = BigInt(value)
    if (chainId > MAX_UINT256) return
    return chainId.toString(10)
  } catch {
    return
  }
}

export function getTypedDataContext(typedMessage: TypedMessage, requestChainId: number): TypedDataContext {
  if (typedMessage.version === SignTypedDataVersion.V1 || Array.isArray(typedMessage.data)) {
    return { requestChainId, risks: ['legacy-v1'] }
  }

  const permit2 = getPermit2Authority(typedMessage)
  const eip3009 = getEip3009Authorization(typedMessage)
  const authorityContext = { ...(permit2 ? { permit2 } : {}), ...(eip3009 ? { eip3009 } : {}) }
  const risks: TypedDataRisk[] = []
  const { domain } = typedMessage.data

  if (permit2) {
    if (permit2.grantsAuthority) {
      risks.push(permit2.kind === 'allowance' ? 'permit2-allowance' : 'permit2-transfer')
    }
    if (permit2.maximumAmount) risks.push('permit2-maximum-amount')
    if (!permit2.canonicalContract) risks.push('permit2-noncanonical-contract')
  }
  if (eip3009?.grantsAuthority) risks.push('eip3009-transfer')
  if (eip3009?.maximumAmount) risks.push('eip3009-maximum-amount')

  if (!hasOwn(domain, 'chainId')) {
    risks.push('domain-chain-missing')
    return { requestChainId, risks, ...authorityContext }
  }

  const domainChainId = normalizeDomainChainId(domain.chainId)
  if (domainChainId === undefined) {
    risks.push('domain-chain-invalid')
    return { requestChainId, risks, ...authorityContext }
  }

  if (domainChainId !== String(requestChainId)) risks.push('domain-chain-mismatch')
  return { requestChainId, domainChainId, risks, ...authorityContext }
}
