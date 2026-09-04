import { getAddress, sha256, toUtf8Bytes } from 'ethers'
import semver from 'semver'

export const MAX_CONTRACT_VERIFICATION_ARTIFACTS = 2
export const MAX_CONTRACT_VERIFICATION_JSON_DEPTH = 64
export const MAX_CONTRACT_VERIFICATION_SOURCE_COUNT = 1_024
export const MAX_CONTRACT_VERIFICATION_SOURCE_PATH_CHARS = 512
export const MAX_CONTRACT_VERIFICATION_SOURCE_CONTENT_BYTES = 2 * 1_024 * 1_024
export const MAX_CONTRACT_VERIFICATION_TOTAL_SOURCE_CONTENT_BYTES = 16 * 1_024 * 1_024
export const MAX_CONTRACT_VERIFICATION_SOURCE_URLS = 16
export const MAX_CONTRACT_VERIFICATION_SUBMISSION_JSON_BYTES = 16 * 1_024 * 1_024
export const MAX_CONTRACT_VERIFICATION_OUTPUT_JSON_BYTES = 32 * 1_024 * 1_024
export const MAX_CONTRACT_VERIFICATION_CANDIDATES = 1_024
export const MAX_CONTRACT_VERIFICATION_CONTRACT_NAME_CHARS = 256
export const MAX_CONTRACT_VERIFICATION_JOBS = 128
export const MAX_CONTRACT_VERIFICATION_URL_CHARS = 2_048
export const MAX_CONTRACT_VERIFICATION_REMOTE_ID_CHARS = 512
export const MAX_CONTRACT_VERIFICATION_COMPILER_VERSION_CHARS = 128

export const CONTRACT_VERIFICATION_DESTINATIONS = Object.freeze([
  'sourcify',
  'etherscan-forwarded',
  'blockscout-forwarded',
  'routescan-forwarded',
  'etherscan-direct'
] as const)

export const CONTRACT_VERIFICATION_DOMAIN_ERROR_CODES = Object.freeze([
  'invalid-artifact-bundle',
  'too-many-artifacts',
  'artifact-too-deep',
  'invalid-artifact',
  'unsupported-artifact-format',
  'unsupported-language',
  'invalid-standard-json',
  'invalid-vyper-solc-json',
  'invalid-vyper-integrity',
  'too-many-sources',
  'invalid-source-path',
  'source-path-too-long',
  'invalid-source-content',
  'source-checksum-mismatch',
  'source-content-too-large',
  'total-source-content-too-large',
  'submission-too-large',
  'output-too-large',
  'missing-compiler-version',
  'invalid-compiler-version',
  'invalid-contract-identifier',
  'missing-build-output',
  'mismatched-build-info-pair',
  'invalid-compiler-output',
  'too-many-contracts',
  'local-match-unavailable',
  'invalid-deployed-bytecode',
  'invalid-bytecode-reference',
  'overlapping-bytecode-reference',
  'bytecode-reference-out-of-range',
  'invalid-runtime-code',
  'runtime-bytecode-mismatch',
  'invalid-target',
  'invalid-job-ledger',
  'too-many-jobs'
] as const)

export type ContractVerificationDomainErrorCode = (typeof CONTRACT_VERIFICATION_DOMAIN_ERROR_CODES)[number]

export const CONTRACT_VERIFICATION_DOMAIN_ERROR_MESSAGES: Readonly<
  Record<ContractVerificationDomainErrorCode, string>
> = Object.freeze({
  'invalid-artifact-bundle': 'Verification artifact bundle is invalid',
  'too-many-artifacts': 'Verification artifact bundle contains too many files',
  'artifact-too-deep': 'Verification artifact is nested too deeply',
  'invalid-artifact': 'Verification artifact contains invalid JSON data',
  'unsupported-artifact-format': 'Verification artifact format is not supported',
  'unsupported-language': 'Verification artifact language is not supported',
  'invalid-standard-json': 'Compiler standard JSON input is invalid',
  'invalid-vyper-solc-json': 'Vyper solc_json artifact is invalid',
  'invalid-vyper-integrity': 'Vyper artifact integrity metadata is invalid',
  'too-many-sources': 'Verification artifact contains too many sources',
  'invalid-source-path': 'Verification source path is invalid',
  'source-path-too-long': 'Verification source path is too long',
  'invalid-source-content': 'Verification source content is invalid',
  'source-checksum-mismatch': 'A Vyper source checksum does not match its content',
  'source-content-too-large': 'A verification source is too large',
  'total-source-content-too-large': 'Verification sources are too large',
  'submission-too-large': 'Verification submission is too large',
  'output-too-large': 'Verification compiler output is too large',
  'missing-compiler-version': 'Exact compiler version is required',
  'invalid-compiler-version': 'Compiler version is invalid',
  'invalid-contract-identifier': 'Fully qualified contract identifier is invalid',
  'missing-build-output': 'Matching compiler output is required',
  'mismatched-build-info-pair': 'Hardhat build-info files do not match',
  'invalid-compiler-output': 'Compiler output is invalid',
  'too-many-contracts': 'Compiler output contains too many contracts',
  'local-match-unavailable': 'Local runtime bytecode matching is unavailable',
  'invalid-deployed-bytecode': 'Compiled deployed bytecode is invalid',
  'invalid-bytecode-reference': 'Compiled bytecode reference is invalid',
  'overlapping-bytecode-reference': 'Compiled bytecode references overlap',
  'bytecode-reference-out-of-range': 'Compiled bytecode reference is out of range',
  'invalid-runtime-code': 'Deployed runtime code is invalid',
  'runtime-bytecode-mismatch': 'Compiled and deployed runtime bytecode do not match',
  'invalid-target': 'Verification target is invalid',
  'invalid-job-ledger': 'Verification job ledger is invalid',
  'too-many-jobs': 'Verification job ledger contains too many records'
})

export class ContractVerificationDomainError extends Error {
  readonly code: ContractVerificationDomainErrorCode

  constructor(code: ContractVerificationDomainErrorCode) {
    super(CONTRACT_VERIFICATION_DOMAIN_ERROR_MESSAGES[code])
    this.name = 'ContractVerificationDomainError'
    this.code = code
  }
}

export type ContractVerificationLanguage = 'Solidity' | 'Vyper'
export type ContractVerificationArtifactFormat =
  | 'solidity-standard-json'
  | 'vyper-standard-json'
  | 'vyper-solc-json'
  | 'hardhat-2-build-info'
  | 'foundry-build-info'
  | 'hardhat-3-build-info'

export type ContractVerificationCompilerStatus = 'required' | 'included'

export interface ContractVerificationArtifactSummary {
  readonly format: ContractVerificationArtifactFormat
  readonly language: ContractVerificationLanguage
  readonly compilerStatus: ContractVerificationCompilerStatus
  readonly compilerVersion: string | null
  readonly sourceCount: number
  readonly contractCandidates: readonly string[]
  readonly localRuntimeMatch: boolean
}

export type ContractVerificationJson =
  null | boolean | number | string | readonly ContractVerificationJson[] | ContractVerificationJsonObject

export interface ContractVerificationJsonObject {
  readonly [key: string]: ContractVerificationJson
}

/** Main-process value. Do not project stdJsonInput or compilerOutput to a renderer. */
export interface ContractVerificationArtifact {
  readonly format: ContractVerificationArtifactFormat
  readonly language: ContractVerificationLanguage
  readonly compilerVersion: string | null
  readonly sourceCount: number
  readonly contractCandidates: readonly string[]
  readonly localRuntimeMatch: boolean
  readonly stdJsonInput: ContractVerificationJsonObject
  readonly compilerOutput: ContractVerificationJsonObject | null
}

export interface ContractVerificationSelection {
  readonly compilerVersion?: string
  readonly contractIdentifier: string
}

/** Main-process publication payload. It contains source and must never be persisted or projected. */
export interface ContractVerificationSubmission {
  readonly format: ContractVerificationArtifactFormat
  readonly language: ContractVerificationLanguage
  readonly compilerVersion: string
  readonly contractIdentifier: string
  readonly stdJsonInput: ContractVerificationJsonObject
  readonly sourceHash: string
  readonly submissionHash: string
  readonly localRuntimeMatch: boolean
}

export interface ContractVerificationRuntimeMatch {
  readonly matched: true
  readonly runtimeBytes: number
  readonly maskedRanges: readonly ContractVerificationByteRange[]
}

export interface ContractVerificationByteRange {
  readonly start: number
  readonly length: number
}

export interface ContractVerificationTarget {
  readonly address: string
  readonly chainId: number
  readonly runtimeCodeHash: string
  readonly creationEvidence?: ContractVerificationCreationEvidence
}

export interface ContractVerificationCreationEvidence {
  readonly transactionHash: string
  readonly blockNumber: string
  readonly blockHash: string
  readonly operationId?: string
}

export type ContractVerificationDestination = (typeof CONTRACT_VERIFICATION_DESTINATIONS)[number]
export type ContractVerificationDestinationStatus =
  | 'not-submitted'
  | 'checking'
  | 'published'
  | 'verified'
  | 'already-published'
  | 'already-verified'
  | 'rejected'
  | 'unavailable'
  | 'needs-api-key'
  | 'unknown'

export type ContractVerificationDestinationReasonCode =
  | 'already-verified'
  | 'api-key-required'
  | 'destination-rejected'
  | 'destination-unavailable'
  | 'publication-rejected'
  | 'request-timeout'
  | 'status-unavailable'
  | 'transport-failure'

export type ContractVerificationJobStatus =
  'preparing' | 'publishing' | 'published' | 'partial' | 'rejected' | 'unknown'

export interface ContractVerificationDestinationRecord {
  readonly destination: ContractVerificationDestination
  readonly status: ContractVerificationDestinationStatus
  readonly publicationHash?: string
  readonly remoteId?: string
  readonly statusUrl?: string
  readonly explorerUrl?: string
  readonly reasonCode?: ContractVerificationDestinationReasonCode
}

/** Privacy-minimal persistence record. Source JSON and credentials have no fields in this shape. */
export interface ContractVerificationJobRecord {
  readonly id: string
  readonly target: ContractVerificationTarget
  readonly language: ContractVerificationLanguage
  readonly compilerVersion: string
  readonly contractIdentifier: string
  readonly sourceHash: string
  readonly submissionHash: string
  readonly status: ContractVerificationJobStatus
  readonly destinations: readonly ContractVerificationDestinationRecord[]
  readonly createdAt: number
  readonly updatedAt: number
}

const BUILD_INFO_KEYS = ['_format', 'id', 'solcVersion', 'solcLongVersion', 'input', 'output'] as const
const FOUNDRY_BUILD_INFO_KEYS = [
  '_format',
  'id',
  'solcVersion',
  'solcLongVersion',
  'input',
  'output',
  'source_id_to_path',
  'language'
] as const
const HH3_INPUT_KEYS = ['_format', 'id', 'solcVersion', 'solcLongVersion', 'input'] as const
const HH3_OUTPUT_KEYS = ['_format', 'id', 'output'] as const
const STANDARD_JSON_REQUIRED_KEYS = ['language', 'sources'] as const
const STANDARD_JSON_OPTIONAL_KEYS = ['settings'] as const
const VYPER_STANDARD_JSON_OPTIONAL_KEYS = ['settings', 'storage_layout_overrides'] as const
const VYPER_SOLC_JSON_REQUIRED_KEYS = [
  'language',
  'sources',
  'settings',
  'compiler_version',
  'integrity'
] as const
const VYPER_SOLC_JSON_OPTIONAL_KEYS = ['storage_layout_overrides'] as const
const VYPER_SOLC_JSON_SOURCE_KEYS = ['content', 'sha256sum'] as const
const SOURCE_REQUIRED_KEYS = ['content'] as const
const SOURCE_OPTIONAL_KEYS = ['keccak256', 'urls'] as const
const TARGET_KEYS = ['address', 'chainId', 'runtimeCodeHash'] as const
const TARGET_OPTIONAL_KEYS = ['creationEvidence'] as const
const CREATION_EVIDENCE_KEYS = ['transactionHash', 'blockNumber', 'blockHash'] as const
const CREATION_EVIDENCE_OPTIONAL_KEYS = ['operationId'] as const
const JOB_KEYS = [
  'id',
  'target',
  'language',
  'compilerVersion',
  'contractIdentifier',
  'sourceHash',
  'submissionHash',
  'status',
  'destinations',
  'createdAt',
  'updatedAt'
] as const
const DESTINATION_REQUIRED_KEYS = ['destination', 'status'] as const
const DESTINATION_OPTIONAL_KEYS = [
  'publicationHash',
  'remoteId',
  'statusUrl',
  'explorerUrl',
  'reasonCode'
] as const
const CANONICAL_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u
const HASH_32 = /^0x[0-9a-f]{64}$/u
const HASH_32_ANY_CASE = /^0x[0-9a-fA-F]{64}$/u
const SHA_256 = /^[0-9a-f]{64}$/u
const REMOTE_ID = /^[A-Za-z0-9._:-]+$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const HEX_BYTE = /^[0-9a-fA-F]{2}$/u
const destinationStatuses = new Set<ContractVerificationDestinationStatus>([
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
])

export function isContractVerificationCompilerVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CONTRACT_VERIFICATION_COMPILER_VERSION_CHARS &&
    semver.valid(value) !== null
  )
}
const jobStatuses = new Set<ContractVerificationJobStatus>([
  'preparing',
  'publishing',
  'published',
  'partial',
  'rejected',
  'unknown'
])
const destinationReasonCodes = new Set<ContractVerificationDestinationReasonCode>([
  'already-verified',
  'api-key-required',
  'destination-rejected',
  'destination-unavailable',
  'publication-rejected',
  'request-timeout',
  'status-unavailable',
  'transport-failure'
])
const destinationStatusSet = (...values: ContractVerificationDestinationStatus[]) => new Set(values)
const statusesByDestination: Readonly<
  Record<ContractVerificationDestination, ReadonlySet<ContractVerificationDestinationStatus>>
> = Object.freeze({
  sourcify: destinationStatusSet(
    'not-submitted',
    'checking',
    'published',
    'already-published',
    'rejected',
    'unavailable',
    'unknown'
  ),
  'etherscan-forwarded': destinationStatusSet(
    'not-submitted',
    'checking',
    'verified',
    'already-verified',
    'rejected',
    'unavailable',
    'unknown'
  ),
  'blockscout-forwarded': destinationStatusSet(
    'not-submitted',
    'checking',
    'verified',
    'already-verified',
    'rejected',
    'unavailable',
    'unknown'
  ),
  'routescan-forwarded': destinationStatusSet(
    'not-submitted',
    'checking',
    'verified',
    'already-verified',
    'rejected',
    'unavailable',
    'unknown'
  ),
  'etherscan-direct': destinationStatusSet(
    'not-submitted',
    'checking',
    'verified',
    'already-verified',
    'rejected',
    'unavailable',
    'needs-api-key',
    'unknown'
  )
})

function fail(code: ContractVerificationDomainErrorCode): never {
  throw new ContractVerificationDomainError(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('invalid-artifact')
  return descriptor.value
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function ownArrayValues(value: unknown, code: ContractVerificationDomainErrorCode): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length ||
    Object.getOwnPropertyNames(value).length !== value.length + 1
  ) {
    fail(code)
  }
  const values: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code)
    values.push(descriptor.value)
  }
  return values
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function ownString(record: Record<string, unknown>, key: string): string {
  const value = ownValue(record, key)
  if (typeof value !== 'string') fail('invalid-artifact')
  return value
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(record).length !== 0) return false
  const keys = Object.keys(record)
  const ownNames = Object.getOwnPropertyNames(record)
  return (
    keys.length === ownNames.length &&
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  )
}

function hasAllowedKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
): boolean {
  if (Object.getOwnPropertySymbols(record).length !== 0) return false
  const keys = Object.keys(record)
  const ownNames = Object.getOwnPropertyNames(record)
  const allowed = new Set([...required, ...optional])
  return (
    keys.length === ownNames.length &&
    required.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    keys.every((key) => allowed.has(key))
  )
}

function cloneJson(
  value: unknown,
  tooLargeCode: 'submission-too-large' | 'output-too-large' = 'submission-too-large'
): ContractVerificationJson {
  const active = new WeakSet<object>()

  const visit = (candidate: unknown, depth: number): ContractVerificationJson => {
    if (depth > MAX_CONTRACT_VERIFICATION_JSON_DEPTH) fail('artifact-too-deep')
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) fail('invalid-artifact')
      return Object.is(candidate, -0) ? 0 : candidate
    }
    if (typeof candidate !== 'object') fail('invalid-artifact')
    if (active.has(candidate)) fail('invalid-artifact')
    active.add(candidate)

    if (Array.isArray(candidate)) {
      const copy: ContractVerificationJson[] = []
      for (const entry of ownArrayValues(candidate, 'invalid-artifact')) copy.push(visit(entry, depth + 1))
      active.delete(candidate)
      return Object.freeze(copy)
    }
    if (!isRecord(candidate) || Object.getOwnPropertySymbols(candidate).length !== 0) {
      fail('invalid-artifact')
    }
    const keys = Object.keys(candidate)
    if (Object.getOwnPropertyNames(candidate).length !== keys.length) fail('invalid-artifact')
    const copy: Record<string, ContractVerificationJson> = Object.create(null)
    for (const key of keys) {
      copy[key] = visit(ownValue(candidate, key), depth + 1)
    }
    active.delete(candidate)
    return Object.freeze(copy)
  }

  const cloned = visit(value, 0)
  const bytes = toUtf8Bytes(canonicalJsonAt(cloned)).length
  const maximum =
    tooLargeCode === 'submission-too-large'
      ? MAX_CONTRACT_VERIFICATION_SUBMISSION_JSON_BYTES
      : MAX_CONTRACT_VERIFICATION_OUTPUT_JSON_BYTES
  if (bytes > maximum) fail(tooLargeCode)
  return cloned
}

function canonicalJsonAt(value: ContractVerificationJson): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonAt).join(',')}]`
  const record = value as ContractVerificationJsonObject
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonAt(record[key]!)}`)
    .join(',')}}`
}

export function canonicalContractVerificationJson(value: unknown): string {
  return canonicalJsonAt(cloneJson(value))
}

export function sha256ContractVerificationJson(value: unknown): string {
  return sha256(toUtf8Bytes(canonicalContractVerificationJson(value))).slice(2)
}

function parseLanguage(value: unknown): ContractVerificationLanguage {
  if (value === 'Solidity' || value === 'Vyper') return value
  return fail('unsupported-language')
}

function validateSourcePath(value: string): void {
  if (!value || value.trim() !== value || hasControlCharacter(value)) fail('invalid-source-path')
  if (value.length > MAX_CONTRACT_VERIFICATION_SOURCE_PATH_CHARS) fail('source-path-too-long')
}

function parseStandardJson(value: unknown): {
  readonly input: ContractVerificationJsonObject
  readonly language: ContractVerificationLanguage
  readonly sourceCount: number
} {
  if (!isRecord(value)) fail('invalid-standard-json')
  const language = parseLanguage(ownValue(value, 'language'))
  const optionalKeys = language === 'Vyper' ? VYPER_STANDARD_JSON_OPTIONAL_KEYS : STANDARD_JSON_OPTIONAL_KEYS
  if (!hasAllowedKeys(value, STANDARD_JSON_REQUIRED_KEYS, optionalKeys)) fail('invalid-standard-json')
  if (
    (hasOwn(value, 'settings') && !isRecord(ownValue(value, 'settings'))) ||
    (hasOwn(value, 'storage_layout_overrides') && !isRecord(ownValue(value, 'storage_layout_overrides'))) ||
    !isRecord(ownValue(value, 'sources'))
  ) {
    fail('invalid-standard-json')
  }
  const sources = ownValue(value, 'sources') as Record<string, unknown>
  const sourcePaths = Object.keys(sources)
  if (sourcePaths.length === 0) fail('invalid-standard-json')
  if (sourcePaths.length > MAX_CONTRACT_VERIFICATION_SOURCE_COUNT) fail('too-many-sources')
  if (Object.getOwnPropertyNames(sources).length !== sourcePaths.length) fail('invalid-standard-json')

  let totalBytes = 0
  for (const sourcePath of sourcePaths) {
    validateSourcePath(sourcePath)
    const source = ownValue(sources, sourcePath)
    if (!isRecord(source) || !hasAllowedKeys(source, SOURCE_REQUIRED_KEYS, SOURCE_OPTIONAL_KEYS)) {
      fail('invalid-source-content')
    }
    const content = ownValue(source, 'content')
    if (typeof content !== 'string') fail('invalid-source-content')
    const bytes = toUtf8Bytes(content).length
    if (bytes > MAX_CONTRACT_VERIFICATION_SOURCE_CONTENT_BYTES) fail('source-content-too-large')
    totalBytes += bytes
    if (totalBytes > MAX_CONTRACT_VERIFICATION_TOTAL_SOURCE_CONTENT_BYTES) {
      fail('total-source-content-too-large')
    }
    if (hasOwn(source, 'keccak256')) {
      const sourceHash = ownValue(source, 'keccak256')
      if (typeof sourceHash !== 'string' || !HASH_32_ANY_CASE.test(sourceHash)) {
        fail('invalid-source-content')
      }
    }
    if (hasOwn(source, 'urls')) {
      const urls = ownValue(source, 'urls')
      if (!Array.isArray(urls) || urls.length > MAX_CONTRACT_VERIFICATION_SOURCE_URLS) {
        fail('invalid-source-content')
      }
      for (const url of ownArrayValues(urls, 'invalid-source-content')) {
        if (
          typeof url !== 'string' ||
          url.length === 0 ||
          url.length > MAX_CONTRACT_VERIFICATION_URL_CHARS ||
          hasControlCharacter(url)
        ) {
          fail('invalid-source-content')
        }
      }
    }
  }

  const input = cloneJson(value)
  if (!isRecord(input)) fail('invalid-standard-json')
  if (hasOwn(input, 'settings')) {
    return Object.freeze({ input, language, sourceCount: sourcePaths.length })
  }
  const normalized: Record<string, ContractVerificationJson> = Object.create(null)
  for (const key of Object.keys(input)) normalized[key] = input[key]!
  normalized['settings'] = Object.freeze(Object.create(null)) as ContractVerificationJsonObject
  return Object.freeze({
    input: Object.freeze(normalized),
    language,
    sourceCount: sourcePaths.length
  })
}

function parseVyperSolcJson(value: Record<string, unknown>): {
  readonly input: ContractVerificationJsonObject
  readonly language: 'Vyper'
  readonly sourceCount: number
  readonly compilerVersion: string
} {
  if (
    !hasAllowedKeys(value, VYPER_SOLC_JSON_REQUIRED_KEYS, VYPER_SOLC_JSON_OPTIONAL_KEYS) ||
    ownValue(value, 'language') !== 'Vyper'
  ) {
    fail('invalid-vyper-solc-json')
  }

  const compilerVersion = ownValue(value, 'compiler_version')
  if (
    typeof compilerVersion !== 'string' ||
    !compilerVersion.startsWith('v') ||
    !isContractVerificationCompilerVersion(compilerVersion)
  ) {
    fail('invalid-compiler-version')
  }
  const integrity = ownValue(value, 'integrity')
  if (typeof integrity !== 'string' || !SHA_256.test(integrity)) fail('invalid-vyper-integrity')

  const sourceValue = ownValue(value, 'sources')
  if (!isRecord(sourceValue)) fail('invalid-standard-json')
  const sourcePaths = Object.keys(sourceValue)
  if (
    Object.getOwnPropertySymbols(sourceValue).length !== 0 ||
    Object.getOwnPropertyNames(sourceValue).length !== sourcePaths.length
  ) {
    fail('invalid-standard-json')
  }
  const normalizedSources: Record<string, unknown> = Object.create(null)
  const checksums = new Map<string, string>()
  for (const sourcePath of sourcePaths) {
    const source = ownValue(sourceValue, sourcePath)
    if (!isRecord(source) || !hasExactKeys(source, VYPER_SOLC_JSON_SOURCE_KEYS)) {
      fail('invalid-source-content')
    }
    const content = ownValue(source, 'content')
    const checksum = ownValue(source, 'sha256sum')
    if (typeof content !== 'string' || typeof checksum !== 'string' || !SHA_256.test(checksum)) {
      fail('invalid-source-content')
    }
    normalizedSources[sourcePath] = { content }
    checksums.set(sourcePath, checksum)
  }

  const normalized: Record<string, unknown> = Object.create(null)
  normalized['language'] = 'Vyper'
  normalized['sources'] = normalizedSources
  normalized['settings'] = ownValue(value, 'settings')
  // Vyper defines integrity over its resolved import graph and any layout override.
  // Downstream verifiers recompute it and accept the strict compiler input, not this envelope field.
  if (hasOwn(value, 'storage_layout_overrides')) {
    normalized['storage_layout_overrides'] = ownValue(value, 'storage_layout_overrides')
  }
  const standard = parseStandardJson(normalized)

  const sources = standard.input['sources'] as ContractVerificationJsonObject
  for (const [sourcePath, checksum] of checksums) {
    const source = sources[sourcePath] as ContractVerificationJsonObject
    if (sha256(toUtf8Bytes(source['content'] as string)).slice(2) !== checksum) {
      fail('source-checksum-mismatch')
    }
  }

  return Object.freeze({
    ...standard,
    language: 'Vyper' as const,
    compilerVersion: compilerVersion.slice(1)
  })
}

function parseCompilerVersion(value: unknown): string {
  if (!isContractVerificationCompilerVersion(value)) {
    fail('invalid-compiler-version')
  }
  return value
}

function parseBuildCompilerVersion(record: Record<string, unknown>): string {
  const short = parseCompilerVersion(ownValue(record, 'solcVersion'))
  const exact = parseCompilerVersion(ownValue(record, 'solcLongVersion'))
  const comparable = exact.startsWith('v') ? exact.slice(1) : exact
  if (comparable !== short && !comparable.startsWith(`${short}+`) && !comparable.startsWith(`${short}-`)) {
    fail('invalid-compiler-version')
  }
  return exact
}

function validateBuildId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) fail('invalid-artifact')
  return value
}

function contractIdentifier(sourcePath: string, name: string): string {
  validateSourcePath(sourcePath)
  if (
    !name ||
    name.length > MAX_CONTRACT_VERIFICATION_CONTRACT_NAME_CHARS ||
    name.trim() !== name ||
    name.includes(':') ||
    hasControlCharacter(name)
  ) {
    fail('invalid-compiler-output')
  }
  return `${sourcePath}:${name}`
}

function deployedBytecodeRecord(candidate: unknown): Record<string, unknown> | undefined {
  if (!isRecord(candidate)) return undefined
  const evm = hasOwn(candidate, 'evm') ? ownValue(candidate, 'evm') : undefined
  if (!isRecord(evm)) return undefined
  const deployed = hasOwn(evm, 'deployedBytecode') ? ownValue(evm, 'deployedBytecode') : undefined
  return isRecord(deployed) ? deployed : undefined
}

function extractCandidates(output: ContractVerificationJsonObject): readonly string[] {
  const contracts = output['contracts']
  if (!isRecord(contracts)) fail('invalid-compiler-output')
  const candidates: string[] = []
  let seen = 0
  for (const sourcePath of Object.keys(contracts).sort()) {
    validateSourcePath(sourcePath)
    const sourceContracts = ownValue(contracts, sourcePath)
    if (!isRecord(sourceContracts)) fail('invalid-compiler-output')
    for (const name of Object.keys(sourceContracts).sort()) {
      seen += 1
      if (seen > MAX_CONTRACT_VERIFICATION_CANDIDATES) fail('too-many-contracts')
      const deployed = deployedBytecodeRecord(ownValue(sourceContracts, name))
      const object = deployed && hasOwn(deployed, 'object') ? ownValue(deployed, 'object') : undefined
      if (typeof object === 'string' && object.replace(/^0x/u, '').length > 0) {
        candidates.push(contractIdentifier(sourcePath, name))
      }
    }
  }
  if (candidates.length === 0) fail('invalid-compiler-output')
  return Object.freeze(candidates)
}

function freezeArtifact(value: ContractVerificationArtifact): ContractVerificationArtifact {
  return Object.freeze({ ...value, contractCandidates: Object.freeze([...value.contractCandidates]) })
}

function parseFullBuildInfo(
  value: Record<string, unknown>,
  format: 'hardhat-2-build-info' | 'foundry-build-info'
): ContractVerificationArtifact {
  const expectedKeys = format === 'foundry-build-info' ? FOUNDRY_BUILD_INFO_KEYS : BUILD_INFO_KEYS
  if (!hasExactKeys(value, expectedKeys)) fail('invalid-artifact')
  validateBuildId(ownValue(value, 'id'))
  const compilerVersion = parseBuildCompilerVersion(value)
  const standard = parseStandardJson(ownValue(value, 'input'))
  if (format === 'foundry-build-info') validateFoundryContext(value, standard)
  const compilerOutput = cloneJson(ownValue(value, 'output'), 'output-too-large')
  if (!isRecord(compilerOutput)) fail('invalid-compiler-output')
  const contractCandidates = extractCandidates(compilerOutput)
  return freezeArtifact({
    format,
    language: standard.language,
    compilerVersion,
    sourceCount: standard.sourceCount,
    contractCandidates,
    localRuntimeMatch: true,
    stdJsonInput: standard.input,
    compilerOutput
  })
}

function validateFoundryContext(
  value: Record<string, unknown>,
  standard: {
    readonly input: ContractVerificationJsonObject
    readonly language: ContractVerificationLanguage
  }
): void {
  if (ownValue(value, 'language') !== standard.language) fail('invalid-artifact')
  const sourceMap = ownValue(value, 'source_id_to_path')
  if (!isRecord(sourceMap)) fail('invalid-artifact')
  const entries = Object.keys(sourceMap)
  if (entries.length > MAX_CONTRACT_VERIFICATION_SOURCE_COUNT) fail('too-many-sources')
  const paths = new Set<string>()
  for (const id of entries) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(id) || !Number.isSafeInteger(Number(id))) fail('invalid-artifact')
    const sourcePath = ownValue(sourceMap, id)
    if (typeof sourcePath !== 'string') fail('invalid-artifact')
    validateSourcePath(sourcePath)
    if (!hasOwn(standard.input['sources'] as object, sourcePath) || paths.has(sourcePath)) {
      fail('invalid-artifact')
    }
    paths.add(sourcePath)
  }
}

function parseHardhat3Pair(
  first: Record<string, unknown>,
  second: Record<string, unknown>
): ContractVerificationArtifact {
  const inputRecord = ownValue(first, '_format') === 'hh3-sol-build-info-1' ? first : second
  const outputRecord = inputRecord === first ? second : first
  if (
    ownValue(outputRecord, '_format') !== 'hh3-sol-build-info-output-1' ||
    !hasExactKeys(inputRecord, HH3_INPUT_KEYS) ||
    !hasExactKeys(outputRecord, HH3_OUTPUT_KEYS)
  ) {
    fail('missing-build-output')
  }
  const id = validateBuildId(ownValue(inputRecord, 'id'))
  if (validateBuildId(ownValue(outputRecord, 'id')) !== id) fail('mismatched-build-info-pair')
  const compilerVersion = parseBuildCompilerVersion(inputRecord)
  const standard = parseStandardJson(ownValue(inputRecord, 'input'))
  const compilerOutput = cloneJson(ownValue(outputRecord, 'output'), 'output-too-large')
  if (!isRecord(compilerOutput)) fail('invalid-compiler-output')
  const contractCandidates = extractCandidates(compilerOutput)
  return freezeArtifact({
    format: 'hardhat-3-build-info',
    language: standard.language,
    compilerVersion,
    sourceCount: standard.sourceCount,
    contractCandidates,
    localRuntimeMatch: true,
    stdJsonInput: standard.input,
    compilerOutput
  })
}

export function parseContractVerificationArtifacts(
  artifacts: readonly unknown[]
): ContractVerificationArtifact {
  if (!Array.isArray(artifacts) || artifacts.length === 0) fail('invalid-artifact-bundle')
  if (artifacts.length > MAX_CONTRACT_VERIFICATION_ARTIFACTS) fail('too-many-artifacts')
  const artifactValues = ownArrayValues(artifacts, 'invalid-artifact-bundle')
  if (artifactValues.some((artifact) => !isRecord(artifact))) fail('invalid-artifact')

  const records = artifactValues as readonly Record<string, unknown>[]
  if (records.length === 2) return parseHardhat3Pair(records[0]!, records[1]!)

  const artifact = records[0]!
  if (!hasOwn(artifact, '_format')) {
    if (hasOwn(artifact, 'compiler_version')) {
      const standard = parseVyperSolcJson(artifact)
      return freezeArtifact({
        format: 'vyper-solc-json',
        language: standard.language,
        compilerVersion: standard.compilerVersion,
        sourceCount: standard.sourceCount,
        contractCandidates: Object.freeze([]),
        localRuntimeMatch: false,
        stdJsonInput: standard.input,
        compilerOutput: null
      })
    }
    const standard = parseStandardJson(artifact)
    return freezeArtifact({
      format: standard.language === 'Solidity' ? 'solidity-standard-json' : 'vyper-standard-json',
      language: standard.language,
      compilerVersion: null,
      sourceCount: standard.sourceCount,
      contractCandidates: Object.freeze([]),
      localRuntimeMatch: false,
      stdJsonInput: standard.input,
      compilerOutput: null
    })
  }

  const format = ownString(artifact, '_format')
  if (format === 'hh-sol-build-info-1') return parseFullBuildInfo(artifact, 'hardhat-2-build-info')
  if (format === 'ethers-rs-sol-build-info-1') return parseFullBuildInfo(artifact, 'foundry-build-info')
  if (format === 'hh3-sol-build-info-1') fail('missing-build-output')
  if (format === 'hh3-sol-build-info-output-1') fail('invalid-artifact-bundle')
  return fail('unsupported-artifact-format')
}

export function summarizeContractVerificationArtifact(
  artifact: ContractVerificationArtifact
): ContractVerificationArtifactSummary {
  return Object.freeze({
    format: artifact.format,
    language: artifact.language,
    compilerStatus: artifact.compilerVersion === null ? 'required' : 'included',
    compilerVersion: artifact.compilerVersion,
    sourceCount: artifact.sourceCount,
    contractCandidates: Object.freeze([...artifact.contractCandidates]),
    localRuntimeMatch: artifact.localRuntimeMatch
  })
}

function parseSelectedIdentifier(artifact: ContractVerificationArtifact, value: unknown): string {
  if (typeof value !== 'string' || value.length > 1_024 || value.trim() !== value) {
    fail('invalid-contract-identifier')
  }
  const separator = value.lastIndexOf(':')
  if (separator <= 0 || separator === value.length - 1) fail('invalid-contract-identifier')
  const sourcePath = value.slice(0, separator)
  const name = value.slice(separator + 1)
  validateSourcePath(sourcePath)
  if (
    name.length > MAX_CONTRACT_VERIFICATION_CONTRACT_NAME_CHARS ||
    name.includes(':') ||
    hasControlCharacter(name) ||
    !hasOwn(artifact.stdJsonInput['sources'] as object, sourcePath)
  ) {
    fail('invalid-contract-identifier')
  }
  if (artifact.contractCandidates.length > 0 && !artifact.contractCandidates.includes(value)) {
    fail('invalid-contract-identifier')
  }
  return value
}

export function hashContractVerificationSources(artifact: ContractVerificationArtifact): string {
  return sha256ContractVerificationJson(artifact.stdJsonInput['sources'])
}

function resolveContractVerificationSelection(
  artifact: ContractVerificationArtifact,
  selection: ContractVerificationSelection
): { readonly compilerVersion: string; readonly contractIdentifier: string } {
  const compilerVersion =
    artifact.compilerVersion ??
    (selection.compilerVersion === undefined
      ? fail('missing-compiler-version')
      : parseCompilerVersion(selection.compilerVersion))
  if (
    artifact.compilerVersion !== null &&
    selection.compilerVersion !== undefined &&
    parseCompilerVersion(selection.compilerVersion) !== artifact.compilerVersion
  ) {
    fail('invalid-compiler-version')
  }
  return Object.freeze({
    compilerVersion,
    contractIdentifier: parseSelectedIdentifier(artifact, selection.contractIdentifier)
  })
}

export function hashContractVerificationSubmission(
  artifact: ContractVerificationArtifact,
  selection: ContractVerificationSelection
): string {
  const selected = resolveContractVerificationSelection(artifact, selection)
  return sha256ContractVerificationJson({
    compilerVersion: selected.compilerVersion,
    contractIdentifier: selected.contractIdentifier,
    stdJsonInput: artifact.stdJsonInput,
    version: 1
  })
}

export function prepareContractVerificationSubmission(
  artifact: ContractVerificationArtifact,
  selection: ContractVerificationSelection
): ContractVerificationSubmission {
  const selected = resolveContractVerificationSelection(artifact, selection)
  const sourceHash = hashContractVerificationSources(artifact)
  const submissionHash = hashContractVerificationSubmission(artifact, selection)
  return Object.freeze({
    format: artifact.format,
    language: artifact.language,
    compilerVersion: selected.compilerVersion,
    contractIdentifier: selected.contractIdentifier,
    stdJsonInput: artifact.stdJsonInput,
    sourceHash,
    submissionHash,
    localRuntimeMatch: artifact.localRuntimeMatch
  })
}

function selectedCompilerContract(
  artifact: ContractVerificationArtifact,
  selected: string
): Record<string, unknown> {
  if (!artifact.compilerOutput) fail('local-match-unavailable')
  const identifier = parseSelectedIdentifier(artifact, selected)
  const separator = identifier.lastIndexOf(':')
  const contracts = artifact.compilerOutput['contracts']
  if (!isRecord(contracts)) fail('invalid-compiler-output')
  const sourceContracts = ownValue(contracts, identifier.slice(0, separator))
  if (!isRecord(sourceContracts)) fail('invalid-compiler-output')
  const contract = ownValue(sourceContracts, identifier.slice(separator + 1))
  if (!isRecord(contract)) fail('invalid-compiler-output')
  return contract
}

function parseByteRange(value: unknown): ContractVerificationByteRange {
  if (!isRecord(value) || !hasExactKeys(value, ['length', 'start'])) fail('invalid-bytecode-reference')
  const start = ownValue(value, 'start')
  const length = ownValue(value, 'length')
  if (
    !Number.isSafeInteger(start) ||
    (start as number) < 0 ||
    !Number.isSafeInteger(length) ||
    (length as number) <= 0
  ) {
    fail('invalid-bytecode-reference')
  }
  return Object.freeze({ start: start as number, length: length as number })
}

function collectReferenceArrays(value: unknown, depth: 1 | 2): ContractVerificationByteRange[] {
  if (value === undefined) return []
  if (!isRecord(value)) fail('invalid-bytecode-reference')
  const ranges: ContractVerificationByteRange[] = []
  for (const firstKey of Object.keys(value)) {
    const first = ownValue(value, firstKey)
    if (depth === 1) {
      ranges.push(...parseReferenceArray(first))
      continue
    }
    if (!isRecord(first)) fail('invalid-bytecode-reference')
    for (const secondKey of Object.keys(first)) {
      const second = ownValue(first, secondKey)
      ranges.push(...parseReferenceArray(second))
    }
  }
  return ranges
}

function parseReferenceArray(value: unknown): ContractVerificationByteRange[] {
  const result: ContractVerificationByteRange[] = []
  for (const entry of ownArrayValues(value, 'invalid-bytecode-reference')) result.push(parseByteRange(entry))
  return result
}

function validatedRanges(
  deployed: Record<string, unknown>,
  byteLength: number
): readonly ContractVerificationByteRange[] {
  const linkReferences = hasOwn(deployed, 'linkReferences') ? ownValue(deployed, 'linkReferences') : undefined
  const immutableReferences = hasOwn(deployed, 'immutableReferences')
    ? ownValue(deployed, 'immutableReferences')
    : undefined
  const ranges = [
    ...collectReferenceArrays(linkReferences, 2),
    ...collectReferenceArrays(immutableReferences, 1)
  ].sort((left, right) => left.start - right.start || left.length - right.length)
  let end = 0
  for (const range of ranges) {
    if (range.start < end) fail('overlapping-bytecode-reference')
    if (range.start + range.length > byteLength) fail('bytecode-reference-out-of-range')
    end = range.start + range.length
  }
  return Object.freeze(ranges)
}

export function matchContractVerificationRuntimeCode(
  artifact: ContractVerificationArtifact,
  selectedContractIdentifier: string,
  runtimeCode: unknown
): ContractVerificationRuntimeMatch {
  if (!artifact.localRuntimeMatch) fail('local-match-unavailable')
  const contract = selectedCompilerContract(artifact, selectedContractIdentifier)
  const deployed = deployedBytecodeRecord(contract)
  if (!deployed || !hasOwn(deployed, 'object')) fail('invalid-deployed-bytecode')
  const object = ownValue(deployed, 'object')
  if (typeof object !== 'string') fail('invalid-deployed-bytecode')
  const compiled = object.startsWith('0x') ? object.slice(2) : object
  if (compiled.length === 0 || compiled.length % 2 !== 0) fail('invalid-deployed-bytecode')
  if (typeof runtimeCode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(runtimeCode)) {
    fail('invalid-runtime-code')
  }
  const runtime = runtimeCode.slice(2)
  if (runtime.length !== compiled.length) fail('runtime-bytecode-mismatch')

  const byteLength = compiled.length / 2
  const ranges = validatedRanges(deployed, byteLength)
  let rangeIndex = 0
  for (let byte = 0; byte < byteLength; byte += 1) {
    let range = ranges[rangeIndex]
    while (range && byte >= range.start + range.length) {
      rangeIndex += 1
      range = ranges[rangeIndex]
    }
    const masked = !!range && byte >= range.start && byte < range.start + range.length
    const compiledByte = compiled.slice(byte * 2, byte * 2 + 2)
    if (!masked && !HEX_BYTE.test(compiledByte)) fail('invalid-deployed-bytecode')
    if (!masked && compiledByte.toLowerCase() !== runtime.slice(byte * 2, byte * 2 + 2).toLowerCase()) {
      fail('runtime-bytecode-mismatch')
    }
  }
  return Object.freeze({ matched: true, runtimeBytes: byteLength, maskedRanges: ranges })
}

function canonicalAddress(value: unknown): string {
  if (typeof value !== 'string') fail('invalid-target')
  try {
    const address = getAddress(value).toLowerCase()
    if (value !== address) fail('invalid-target')
    return address
  } catch {
    return fail('invalid-target')
  }
}

function canonicalQuantity(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_QUANTITY.test(value)) fail('invalid-target')
  return value
}

function canonicalHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_32.test(value)) fail('invalid-target')
  return value
}

export function validateContractVerificationTarget(value: unknown): ContractVerificationTarget {
  if (!isRecord(value) || !hasAllowedKeys(value, TARGET_KEYS, TARGET_OPTIONAL_KEYS)) fail('invalid-target')
  const chainId = ownValue(value, 'chainId')
  if (!Number.isSafeInteger(chainId) || (chainId as number) <= 0) fail('invalid-target')
  const result: {
    address: string
    chainId: number
    runtimeCodeHash: string
    creationEvidence?: ContractVerificationCreationEvidence
  } = {
    address: canonicalAddress(ownValue(value, 'address')),
    chainId: chainId as number,
    runtimeCodeHash: canonicalHash(ownValue(value, 'runtimeCodeHash'))
  }
  if (hasOwn(value, 'creationEvidence')) {
    const evidence = ownValue(value, 'creationEvidence')
    if (
      !isRecord(evidence) ||
      !hasAllowedKeys(evidence, CREATION_EVIDENCE_KEYS, CREATION_EVIDENCE_OPTIONAL_KEYS)
    ) {
      fail('invalid-target')
    }
    const parsed: {
      transactionHash: string
      blockNumber: string
      blockHash: string
      operationId?: string
    } = {
      transactionHash: canonicalHash(ownValue(evidence, 'transactionHash')),
      blockNumber: canonicalQuantity(ownValue(evidence, 'blockNumber')),
      blockHash: canonicalHash(ownValue(evidence, 'blockHash'))
    }
    if (hasOwn(evidence, 'operationId')) {
      const operationId = ownValue(evidence, 'operationId')
      if (typeof operationId !== 'string' || !UUID.test(operationId)) fail('invalid-target')
      parsed.operationId = operationId
    }
    result.creationEvidence = Object.freeze(parsed)
  }
  return Object.freeze(result)
}

function parseLedgerString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) fail('invalid-job-ledger')
  return value
}

function parseLedgerUrl(value: unknown): string {
  const raw = parseLedgerString(value, MAX_CONTRACT_VERIFICATION_URL_CHARS)
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) fail('invalid-job-ledger')
    return url.toString()
  } catch {
    return fail('invalid-job-ledger')
  }
}

function validateDestinationRecord(value: unknown): ContractVerificationDestinationRecord {
  if (!isRecord(value) || !hasAllowedKeys(value, DESTINATION_REQUIRED_KEYS, DESTINATION_OPTIONAL_KEYS)) {
    fail('invalid-job-ledger')
  }
  const destination = ownValue(value, 'destination')
  const status = ownValue(value, 'status')
  if (
    typeof destination !== 'string' ||
    !CONTRACT_VERIFICATION_DESTINATIONS.includes(destination as ContractVerificationDestination) ||
    typeof status !== 'string' ||
    !destinationStatuses.has(status as ContractVerificationDestinationStatus)
  ) {
    fail('invalid-job-ledger')
  }
  const result: {
    destination: ContractVerificationDestination
    status: ContractVerificationDestinationStatus
    publicationHash?: string
    remoteId?: string
    statusUrl?: string
    explorerUrl?: string
    reasonCode?: ContractVerificationDestinationReasonCode
  } = {
    destination: destination as ContractVerificationDestination,
    status: status as ContractVerificationDestinationStatus
  }
  if (!statusesByDestination[result.destination].has(result.status)) fail('invalid-job-ledger')
  if (hasOwn(value, 'publicationHash')) {
    const publicationHash = ownValue(value, 'publicationHash')
    const allowed =
      (result.destination === 'sourcify' && result.status !== 'not-submitted') ||
      (result.destination === 'etherscan-direct' &&
        result.status !== 'not-submitted' &&
        result.status !== 'unavailable')
    if (!allowed || typeof publicationHash !== 'string' || !SHA_256.test(publicationHash)) {
      fail('invalid-job-ledger')
    }
    result.publicationHash = publicationHash
  }
  if (hasOwn(value, 'remoteId')) {
    const remoteId = ownValue(value, 'remoteId')
    const allowed =
      (result.destination === 'sourcify' &&
        ['checking', 'published', 'already-published', 'rejected', 'unknown'].includes(result.status)) ||
      (result.destination === 'etherscan-direct' &&
        ['checking', 'verified', 'already-verified', 'rejected', 'needs-api-key', 'unknown'].includes(
          result.status
        ))
    if (
      !allowed ||
      typeof remoteId !== 'string' ||
      remoteId.length === 0 ||
      remoteId.length > MAX_CONTRACT_VERIFICATION_REMOTE_ID_CHARS ||
      !REMOTE_ID.test(remoteId)
    ) {
      fail('invalid-job-ledger')
    }
    result.remoteId = remoteId
  }
  if (
    result.status === 'checking' &&
    (result.destination === 'sourcify' || result.destination === 'etherscan-direct') &&
    !result.remoteId
  ) {
    fail('invalid-job-ledger')
  }
  if (result.status === 'needs-api-key' && !result.remoteId && result.publicationHash) {
    fail('invalid-job-ledger')
  }
  if (hasOwn(value, 'statusUrl')) result.statusUrl = parseLedgerUrl(ownValue(value, 'statusUrl'))
  if (hasOwn(value, 'explorerUrl')) result.explorerUrl = parseLedgerUrl(ownValue(value, 'explorerUrl'))
  if (hasOwn(value, 'reasonCode')) {
    const reasonCode = ownValue(value, 'reasonCode')
    if (
      typeof reasonCode !== 'string' ||
      !destinationReasonCodes.has(reasonCode as ContractVerificationDestinationReasonCode)
    ) {
      fail('invalid-job-ledger')
    }
    result.reasonCode = reasonCode as ContractVerificationDestinationReasonCode
  }
  return Object.freeze(result)
}

function validateJobRecord(value: unknown): ContractVerificationJobRecord {
  if (!isRecord(value) || !hasExactKeys(value, JOB_KEYS)) fail('invalid-job-ledger')
  const id = ownValue(value, 'id')
  const language = ownValue(value, 'language')
  const compilerVersion = ownValue(value, 'compilerVersion')
  const selectedContractIdentifier = ownValue(value, 'contractIdentifier')
  const sourceHash = ownValue(value, 'sourceHash')
  const submissionHash = ownValue(value, 'submissionHash')
  const status = ownValue(value, 'status')
  const destinations = ownValue(value, 'destinations')
  const createdAt = ownValue(value, 'createdAt')
  const updatedAt = ownValue(value, 'updatedAt')
  if (
    typeof id !== 'string' ||
    !UUID.test(id) ||
    (language !== 'Solidity' && language !== 'Vyper') ||
    !isContractVerificationCompilerVersion(compilerVersion) ||
    typeof selectedContractIdentifier !== 'string' ||
    selectedContractIdentifier.length === 0 ||
    selectedContractIdentifier.length > 1_024 ||
    typeof sourceHash !== 'string' ||
    !SHA_256.test(sourceHash) ||
    typeof submissionHash !== 'string' ||
    !SHA_256.test(submissionHash) ||
    typeof status !== 'string' ||
    !jobStatuses.has(status as ContractVerificationJobStatus) ||
    !Array.isArray(destinations) ||
    destinations.length === 0 ||
    destinations.length > 5 ||
    !Number.isSafeInteger(createdAt) ||
    (createdAt as number) < 0 ||
    !Number.isSafeInteger(updatedAt) ||
    (updatedAt as number) < (createdAt as number)
  ) {
    fail('invalid-job-ledger')
  }
  const parsedDestinations = ownArrayValues(destinations, 'invalid-job-ledger').map(validateDestinationRecord)
  if (
    parsedDestinations[0]?.destination !== 'sourcify' ||
    new Set(parsedDestinations.map(({ destination }) => destination)).size !== parsedDestinations.length ||
    parsedDestinations.some(
      ({ destination }, index, records) =>
        index > 0 &&
        CONTRACT_VERIFICATION_DESTINATIONS.indexOf(records[index - 1]!.destination) >=
          CONTRACT_VERIFICATION_DESTINATIONS.indexOf(destination)
    )
  ) {
    fail('invalid-job-ledger')
  }
  return Object.freeze({
    id,
    target: validateContractVerificationTarget(ownValue(value, 'target')),
    language,
    compilerVersion,
    contractIdentifier: selectedContractIdentifier,
    sourceHash,
    submissionHash,
    status: status as ContractVerificationJobStatus,
    destinations: Object.freeze(parsedDestinations),
    createdAt: createdAt as number,
    updatedAt: updatedAt as number
  })
}

export function validateContractVerificationJobLedger(
  value: unknown
): readonly ContractVerificationJobRecord[] {
  if (!Array.isArray(value)) fail('invalid-job-ledger')
  if (value.length > MAX_CONTRACT_VERIFICATION_JOBS) fail('too-many-jobs')
  const records = ownArrayValues(value, 'invalid-job-ledger').map(validateJobRecord)
  const ids = new Set<string>()
  for (const record of records) {
    if (ids.has(record.id)) fail('invalid-job-ledger')
    ids.add(record.id)
  }
  return Object.freeze(records)
}
