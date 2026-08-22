import crypto from 'crypto'
import { getAddress, getCreateAddress, keccak256 } from 'ethers'

import {
  ContractVerificationDomainError,
  matchContractVerificationRuntimeCode,
  prepareContractVerificationSubmission,
  type ContractVerificationDestination,
  type ContractVerificationDestinationReasonCode,
  type ContractVerificationDestinationRecord,
  type ContractVerificationJobRecord,
  type ContractVerificationJsonObject,
  type ContractVerificationSubmission,
  type ContractVerificationTarget
} from '../../resources/domain/contractVerification'
import { WREN_DEPLOY_ORIGIN, originIdForName } from '../../resources/domain/origin'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import type {
  ContractVerificationArtifactIntake,
  ConsumedContractVerificationArtifact
} from './artifactIntake'
import type { EtherscanApiKeyStore, ExplorerCredentialStatus } from './credentialStorage'
import type {
  EtherscanSubmitResult,
  EtherscanVerificationInput,
  EtherscanVerificationStatus
} from './etherscan'
import type { ContractVerificationJobLedger } from './jobLedger'
import type {
  SourcifyExternalResult,
  SourcifyStatusResult,
  SourcifySubmitResult,
  SourcifySubmission
} from './sourcify'

export const CONTRACT_VERIFICATION_PUBLICATION_SESSION_TTL_MS = 10 * 60 * 1000
export const MAX_CONTRACT_VERIFICATION_PUBLICATION_SESSIONS = 2

export const CONTRACT_VERIFICATION_SERVICE_ERROR_CODES = Object.freeze([
  'invalid-request',
  'invalid-artifact',
  'invalid-artifact-session',
  'artifact-mismatch',
  'session-capacity',
  'session-expired',
  'confirmation-required',
  'network-missing',
  'network-disabled',
  'network-disconnected',
  'network-changed',
  'rpc-unavailable',
  'invalid-rpc-response',
  'unstable-chain',
  'address-has-no-code',
  'target-changed',
  'invalid-operation',
  'operation-not-confirmed',
  'operation-unsettled',
  'job-unavailable',
  'source-reselection-required',
  'refresh-unavailable',
  'etherscan-unsupported',
  'api-key-required',
  'already-submitted',
  'credential-unavailable'
] as const)

export type ContractVerificationServiceErrorCode = (typeof CONTRACT_VERIFICATION_SERVICE_ERROR_CODES)[number]

export type ContractVerificationServiceResult<T extends object> =
  | ({ readonly success: true } & T)
  | {
      readonly success: false
      readonly error: ContractVerificationServiceErrorCode
      readonly job?: ContractVerificationJobRecord
    }

export interface ContractVerificationNetworkContext {
  readonly type: 'ethereum'
  readonly chainId: number
  readonly configured: boolean
  readonly enabled: boolean
  readonly connected: boolean
}

export interface ContractVerificationRpc {
  (chainId: number, method: string, params?: readonly unknown[]): Promise<unknown>
}

export interface ContractVerificationSourcifyClient {
  submit(input: SourcifySubmission): Promise<SourcifySubmitResult>
  status(
    verificationId: string,
    target: Readonly<{ chainId: number; address: string }>
  ): Promise<SourcifyStatusResult>
}

export interface ContractVerificationEtherscanClient {
  submit(input: EtherscanVerificationInput, apiKey: string): Promise<EtherscanSubmitResult>
  status(chainId: number, guid: string, apiKey: string): Promise<EtherscanVerificationStatus>
}

export interface ContractVerificationOperationLedger {
  get(id: string, now?: number): OperationLifecycle | undefined
}

export interface ContractVerificationServiceDependencies {
  readonly artifactIntake: ContractVerificationArtifactIntake
  readonly commitState: () => void
  readonly credentialStore: EtherscanApiKeyStore
  readonly etherscan: ContractVerificationEtherscanClient
  readonly getNetwork: (chainId: number) => ContractVerificationNetworkContext | undefined
  readonly jobs: ContractVerificationJobLedger
  readonly operations: ContractVerificationOperationLedger
  readonly rpc: ContractVerificationRpc
  readonly sourcify: ContractVerificationSourcifyClient
}

export interface ContractVerificationServiceOptions {
  readonly now?: () => number
  readonly randomUUID?: () => string
  readonly publicationSessionTtlMs?: number
  readonly publicationSessionCapacity?: number
}

export interface PrepareContractVerificationInput {
  readonly artifactToken: unknown
  readonly chainId: unknown
  readonly address: unknown
  readonly operationId?: unknown
  readonly compilerVersion?: unknown
  readonly contractIdentifier?: unknown
}

export interface ReselectContractVerificationInput {
  readonly artifactToken: unknown
  readonly jobId: unknown
  readonly compilerVersion?: unknown
  readonly contractIdentifier?: unknown
}

export interface PreparedContractVerification {
  readonly acknowledgementToken: string
  readonly target: ContractVerificationTarget
  readonly language: ContractVerificationSubmission['language']
  readonly compilerVersion: string
  readonly contractIdentifier: string
  readonly sourceCount: number
  readonly localRuntimeMatch: 'matched' | 'server-required'
  readonly deploymentSettlement: 'complete' | 'not-applicable' | 'pending'
}

interface PreparedPublicationSession {
  state: 'available' | 'publishing'
  submission: ContractVerificationSubmission | undefined
  readonly target: ContractVerificationTarget
  readonly sourceCount: number
  readonly expiresAt: number
}

interface CachedSubmission {
  submission: ContractVerificationSubmission | undefined
  readonly target: ContractVerificationTarget
  readonly expiresAt: number
}

interface StableCodeSnapshot {
  readonly code: string
  readonly codeHash: string
}

class ServiceFailure extends Error {
  constructor(readonly code: ContractVerificationServiceErrorCode) {
    super(code)
    this.name = 'ContractVerificationServiceFailure'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const HASH = /^0x[0-9a-f]{64}$/u
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u
const CODE = /^0x(?:[0-9a-fA-F]{2})+$/u
const CONSTRUCTOR_ARGUMENTS = /^(?:[0-9a-fA-F]{2})+$/u
const MAX_CONSTRUCTOR_ARGUMENTS_LENGTH = 2 * 1024 * 1024
const deployOrigin = originIdForName(WREN_DEPLOY_ORIGIN)
const supportedEtherscanChains = new Set([1, 10, 100, 137, 8453, 42161, 84532, 747474, 11155111, 11155420])

const hasVerificationSettlement = (operation: OperationLifecycle) =>
  operation.settlement?.status === 'complete' &&
  (operation.settlement.basis === 'finalized' || operation.settlement.basis === 'confirmations')

const strictRequest = (value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Object.getOwnPropertySymbols(value).length !== 0) return false
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(
    ([key, descriptor]) => allowedKeys.includes(key) && 'value' in descriptor
  )
}

const boundedPositiveInteger = (value: unknown, fallback: number, maximum: number) =>
  Number.isSafeInteger(value) && (value as number) > 0 ? Math.min(value as number, maximum) : fallback

const currentTimeFactory = (now: () => number) => () => {
  try {
    const value = now()
    if (Number.isSafeInteger(value) && value >= 0) return value
  } catch {
    // Project a fixed service error below.
  }
  throw new ServiceFailure('invalid-request')
}

const fail = (code: ContractVerificationServiceErrorCode): never => {
  throw new ServiceFailure(code)
}

const failure = <T extends object>(
  error: ContractVerificationServiceErrorCode,
  job?: ContractVerificationJobRecord
): ContractVerificationServiceResult<T> =>
  Object.freeze({ success: false, error, ...(job ? { job: cloneAndFreeze(job) } : {}) })

const cloneAndFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value
  const cloned = Array.isArray(value)
    ? value.map((entry) => cloneAndFreeze(entry))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry)]))
  return Object.freeze(cloned) as T
}

const success = <T extends object>(value: T): ContractVerificationServiceResult<T> =>
  Object.freeze({ success: true, ...cloneAndFreeze(value) })

const canonicalAddress = (value: unknown) => {
  if (typeof value !== 'string') return fail('invalid-request')
  try {
    return getAddress(value).toLowerCase()
  } catch {
    return fail('invalid-request')
  }
}

const chainIdOf = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return fail('invalid-request')
  return value as number
}

const uuid = (value: unknown, error: ContractVerificationServiceErrorCode) => {
  if (typeof value !== 'string' || !UUID.test(value)) return fail(error)
  return value
}

const parseBlock = (value: unknown): { readonly number: string; readonly hash: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid-rpc-response')
  const record = value as Record<string, unknown>
  const number = record['number']
  const hash = record['hash']
  if (typeof number !== 'string' || !QUANTITY.test(number) || typeof hash !== 'string') {
    return fail('invalid-rpc-response')
  }
  const canonicalHash = hash.toLowerCase()
  if (!HASH.test(canonicalHash)) return fail('invalid-rpc-response')
  return Object.freeze({ number: number.toLowerCase(), hash: canonicalHash })
}

const parseReceipt = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid-rpc-response')
  const record = value as Record<string, unknown>
  const transactionHash =
    typeof record['transactionHash'] === 'string' ? record['transactionHash'].toLowerCase() : ''
  const blockHash = typeof record['blockHash'] === 'string' ? record['blockHash'].toLowerCase() : ''
  const blockNumber = typeof record['blockNumber'] === 'string' ? record['blockNumber'].toLowerCase() : ''
  const status = typeof record['status'] === 'string' ? record['status'].toLowerCase() : ''
  let contractAddress = ''
  try {
    contractAddress =
      typeof record['contractAddress'] === 'string' ? getAddress(record['contractAddress']).toLowerCase() : ''
  } catch {
    contractAddress = ''
  }
  if (
    !contractAddress ||
    !HASH.test(transactionHash) ||
    !HASH.test(blockHash) ||
    !QUANTITY.test(blockNumber) ||
    status !== '0x1'
  ) {
    return fail('invalid-rpc-response')
  }
  return Object.freeze({ transactionHash, blockHash, blockNumber, status, contractAddress })
}

const mapRpcFailure = (error: unknown): never => {
  if (error instanceof ServiceFailure) throw error
  return fail('rpc-unavailable')
}

const operationEvidence = (operation: OperationLifecycle | undefined, chainId: number, address: string) => {
  let expectedAddress = ''
  let canonicalAccount = ''
  try {
    canonicalAccount = operation ? getAddress(operation.account).toLowerCase() : ''
    expectedAddress = operation?.transaction
      ? getCreateAddress({ from: canonicalAccount, nonce: BigInt(operation.transaction.nonce) }).toLowerCase()
      : ''
  } catch {
    expectedAddress = ''
  }
  if (
    !operation ||
    operation.kind !== 'transaction' ||
    operation.origin !== deployOrigin ||
    operation.chainId !== chainId ||
    !operation.transaction?.deployment ||
    !HASH.test(operation.transaction.hash) ||
    canonicalAccount !== operation.account ||
    expectedAddress !== address ||
    !operation.receipt ||
    !HASH.test(operation.receipt.blockHash) ||
    !QUANTITY.test(operation.receipt.blockNumber) ||
    operation.receipt.status !== '0x1' ||
    operation.receipt.contractAddress !== address ||
    operation.receipt.transactionHash !== operation.transaction.hash
  ) {
    return fail('invalid-operation')
  }
  if (operation.state !== 'confirmed') return fail('operation-not-confirmed')
  return operation
}

const destination = (
  name: ContractVerificationDestination,
  status: ContractVerificationDestinationRecord['status'],
  options: Omit<ContractVerificationDestinationRecord, 'destination' | 'status'> = {}
): ContractVerificationDestinationRecord => Object.freeze({ destination: name, status, ...options })

const initialDestinations = (): readonly ContractVerificationDestinationRecord[] =>
  Object.freeze([
    destination('sourcify', 'not-submitted'),
    destination('etherscan-forwarded', 'not-submitted'),
    destination('blockscout-forwarded', 'not-submitted'),
    destination('routescan-forwarded', 'not-submitted'),
    destination('etherscan-direct', 'not-submitted')
  ])

const replaceDestination = (
  records: readonly ContractVerificationDestinationRecord[],
  replacement: ContractVerificationDestinationRecord
) =>
  Object.freeze(
    records.map((record) => (record.destination === replacement.destination ? replacement : record))
  )

const completeDestinations = (records: readonly ContractVerificationDestinationRecord[]) =>
  Object.freeze(
    initialDestinations().map(
      (fallback) => records.find(({ destination: name }) => name === fallback.destination) || fallback
    )
  )

const replaceCompleteDestination = (
  records: readonly ContractVerificationDestinationRecord[],
  replacement: ContractVerificationDestinationRecord
) => replaceDestination(completeDestinations(records), replacement)

const reasonForSourcifyError = (
  reason: Extract<SourcifySubmitResult, { status: 'error' }>['reason']
): ContractVerificationDestinationReasonCode => {
  if (reason === 'timeout') return 'request-timeout'
  if (reason === 'service_unavailable' || reason === 'rate_limited') return 'destination-unavailable'
  if (reason === 'invalid_response') return 'transport-failure'
  return 'publication-rejected'
}

const reasonForExternalError = (
  error: NonNullable<SourcifyExternalResult['error']>
): ContractVerificationDestinationReasonCode =>
  error === 'rejected'
    ? 'destination-rejected'
    : error === 'unknown'
      ? 'status-unavailable'
      : 'destination-unavailable'

const forwardedDestination = (
  name: 'etherscan-forwarded' | 'blockscout-forwarded' | 'routescan-forwarded',
  result: SourcifyExternalResult | undefined
): ContractVerificationDestinationRecord => {
  if (!result) return destination(name, 'unavailable', { reasonCode: 'destination-unavailable' })
  if (result.error) {
    const status =
      result.error === 'rejected' ? 'rejected' : result.error === 'unknown' ? 'unknown' : 'unavailable'
    return destination(name, status, {
      ...(result.statusUrl ? { statusUrl: result.statusUrl } : {}),
      ...(result.explorerUrl ? { explorerUrl: result.explorerUrl } : {}),
      reasonCode: reasonForExternalError(result.error)
    })
  }
  return destination(name, 'unknown', {
    ...(result.statusUrl ? { statusUrl: result.statusUrl } : {}),
    ...(result.explorerUrl ? { explorerUrl: result.explorerUrl } : {}),
    reasonCode: 'status-unavailable'
  })
}

const jobStatusAfterDirect = (job: ContractVerificationJobRecord) => job.status

const sourcifyPublicationHash = (target: ContractVerificationTarget, submissionHash: string) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        'sourcify-v2',
        target.chainId,
        target.address,
        target.runtimeCodeHash,
        target.creationEvidence?.transactionHash || '',
        submissionHash
      ])
    )
    .digest('hex')

const hasSourcifyPublicationFence = (job: ContractVerificationJobRecord, publicationHash: string) => {
  const sourcify = job.destinations.find(({ destination: name }) => name === 'sourcify')
  return Boolean(
    sourcify && sourcify.status !== 'not-submitted' && sourcify.publicationHash === publicationHash
  )
}

const legacyEtherscanPublicationFenceKey = (job: ContractVerificationJobRecord) =>
  `etherscan-direct:${job.target.chainId}:${job.target.address}:${job.submissionHash}`

const etherscanPublicationHash = (job: ContractVerificationJobRecord, constructorArguments: string) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        'etherscan-direct-v2',
        job.target.chainId,
        job.target.address,
        job.target.runtimeCodeHash,
        job.submissionHash,
        constructorArguments.toLowerCase()
      ])
    )
    .digest('hex')

const etherscanPublicationHashV1 = (job: ContractVerificationJobRecord, constructorArguments: string) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        'etherscan-direct-v1',
        job.target.chainId,
        job.target.address,
        job.target.runtimeCodeHash,
        job.target.creationEvidence?.transactionHash || '',
        job.target.creationEvidence?.blockHash || '',
        job.target.creationEvidence?.blockNumber || '',
        job.submissionHash,
        constructorArguments.toLowerCase()
      ])
    )
    .digest('hex')

const hasEtherscanPublicationFence = (
  job: ContractVerificationJobRecord,
  publicationHash: string,
  legacyFenceKey: string,
  constructorArguments: string
) => {
  const direct = job.destinations.find(({ destination: name }) => name === 'etherscan-direct')
  if (
    !direct ||
    direct.status === 'not-submitted' ||
    direct.status === 'unavailable' ||
    (direct.status === 'needs-api-key' && !direct.remoteId)
  ) {
    return false
  }
  return direct.publicationHash
    ? direct.publicationHash === publicationHash ||
        direct.publicationHash === etherscanPublicationHashV1(job, constructorArguments)
    : legacyEtherscanPublicationFenceKey(job) === legacyFenceKey
}

function etherscanInput(
  job: ContractVerificationJobRecord,
  submission: ContractVerificationSubmission,
  constructorArguments: string
): EtherscanVerificationInput {
  if (!/^[A-Za-z0-9_@./$+~ -]+:[A-Za-z_$][A-Za-z0-9_$]*$/u.test(submission.contractIdentifier)) {
    return fail('etherscan-unsupported')
  }
  const settings = submission.stdJsonInput['settings']
  const settingsRecord =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : undefined
  const optimizer = settingsRecord && (settingsRecord as ContractVerificationJsonObject)['optimizer']
  if (optimizer !== undefined && (!optimizer || typeof optimizer !== 'object' || Array.isArray(optimizer))) {
    return fail('etherscan-unsupported')
  }
  const optimizerRecord =
    optimizer && typeof optimizer === 'object' && !Array.isArray(optimizer) ? optimizer : undefined
  const enabled = optimizerRecord && (optimizerRecord as ContractVerificationJsonObject)['enabled']
  const runs = optimizerRecord && (optimizerRecord as ContractVerificationJsonObject)['runs']
  if (enabled !== undefined && typeof enabled !== 'boolean') return fail('etherscan-unsupported')
  if (
    runs !== undefined &&
    (!Number.isSafeInteger(runs) || (runs as number) < 0 || (runs as number) > 0xffffffff)
  ) {
    return fail('etherscan-unsupported')
  }
  if (enabled === true && runs === undefined) return fail('etherscan-unsupported')

  const evmVersion = settingsRecord && (settingsRecord as ContractVerificationJsonObject)['evmVersion']
  if (evmVersion !== undefined && typeof evmVersion !== 'string') return fail('etherscan-unsupported')
  const compilerVersion =
    submission.language === 'Solidity'
      ? submission.compilerVersion.startsWith('v')
        ? submission.compilerVersion
        : `v${submission.compilerVersion}`
      : submission.compilerVersion.startsWith('vyper:')
        ? submission.compilerVersion
        : `vyper:${submission.compilerVersion}`

  if (
    (submission.language === 'Solidity' &&
      !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\+commit\.[0-9a-fA-F]{8}(?:\.[0-9A-Za-z.-]+)?$/u.test(
        compilerVersion
      )) ||
    (submission.language === 'Vyper' &&
      !/^vyper:\d+\.\d+\.\d+(?:[+.-][0-9A-Za-z.-]+)?$/u.test(compilerVersion))
  ) {
    return fail('etherscan-unsupported')
  }

  return Object.freeze({
    chainId: job.target.chainId,
    compilerVersion,
    contractAddress: job.target.address,
    contractIdentifier: submission.contractIdentifier,
    constructorArguments,
    language: submission.language,
    optimization: Object.freeze({ used: enabled === true, runs: typeof runs === 'number' ? runs : 0 }),
    standardJsonInput: submission.stdJsonInput,
    ...(typeof evmVersion === 'string' ? { evmVersion } : {})
  })
}

export function createContractVerificationService(
  dependencies: ContractVerificationServiceDependencies,
  options: ContractVerificationServiceOptions = {}
) {
  const now = currentTimeFactory(options.now || Date.now)
  const randomUUID = options.randomUUID || crypto.randomUUID
  const ttlMs = boundedPositiveInteger(
    options.publicationSessionTtlMs,
    CONTRACT_VERIFICATION_PUBLICATION_SESSION_TTL_MS,
    CONTRACT_VERIFICATION_PUBLICATION_SESSION_TTL_MS
  )
  const capacity = boundedPositiveInteger(
    options.publicationSessionCapacity,
    MAX_CONTRACT_VERIFICATION_PUBLICATION_SESSIONS,
    MAX_CONTRACT_VERIFICATION_PUBLICATION_SESSIONS
  )
  const prepared = new Map<string, PreparedPublicationSession>()
  const cached = new Map<string, CachedSubmission>()
  const busyJobs = new Set<string>()
  const busySourcifyPublications = new Set<string>()
  const busyEtherscanPublications = new Set<string>()

  const clearPrepared = (session: PreparedPublicationSession) => {
    session.submission = undefined
    session.state = 'publishing'
  }
  const clearCached = (session: CachedSubmission) => {
    session.submission = undefined
  }
  const prune = (timestamp = now()) => {
    for (const [token, session] of prepared) {
      if (timestamp >= session.expiresAt) {
        clearPrepared(session)
        prepared.delete(token)
      }
    }
    for (const [jobId, session] of cached) {
      if (timestamp >= session.expiresAt) {
        clearCached(session)
        cached.delete(jobId)
      }
    }
  }

  const evictOldestCached = (exceptJobId?: string) => {
    const oldest = [...cached.entries()].find(([jobId]) => jobId !== exceptJobId)
    if (!oldest) return false
    clearCached(oldest[1])
    cached.delete(oldest[0])
    return true
  }

  const ensureCapacity = (exceptJobId?: string) => {
    prune()
    while (prepared.size + cached.size >= capacity && evictOldestCached(exceptJobId)) {
      // Cached submissions are optional convenience state and can be reselected.
    }
    if (prepared.size + cached.size >= capacity) return fail('session-capacity')
  }

  const nextId = (occupied: (candidate: string) => boolean) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const candidate: unknown = randomUUID()
        if (typeof candidate === 'string' && UUID.test(candidate) && !occupied(candidate)) return candidate
      } catch {
        return fail('invalid-request')
      }
    }
    return fail('invalid-request')
  }

  const assertNetwork = (chainId: number) => {
    const network = dependencies.getNetwork(chainId)
    if (!network || network.type !== 'ethereum' || network.chainId !== chainId || !network.configured) {
      return fail('network-missing')
    }
    if (!network.enabled) return fail('network-disabled')
    if (!network.connected) return fail('network-disconnected')
    return network
  }

  const rpc = async (chainId: number, method: string, params: readonly unknown[]) => {
    try {
      return await dependencies.rpc(chainId, method, params)
    } catch (error) {
      return mapRpcFailure(error)
    }
  }

  const stableCode = async (chainId: number, address: string): Promise<StableCodeSnapshot> => {
    assertNetwork(chainId)
    const first = parseBlock(await rpc(chainId, 'eth_getBlockByNumber', ['latest', false]))
    const rawCode = await rpc(chainId, 'eth_getCode', [address, first.number])
    const second = parseBlock(await rpc(chainId, 'eth_getBlockByNumber', [first.number, false]))
    assertNetwork(chainId)
    if (second.number !== first.number || second.hash !== first.hash) return fail('unstable-chain')
    if (typeof rawCode !== 'string' || !CODE.test(rawCode)) return fail('address-has-no-code')
    const code = rawCode.toLowerCase()
    return Object.freeze({ code, codeHash: keccak256(code) })
  }

  const canonicalOperationEvidence = async (
    operationId: string,
    chainId: number,
    address: string,
    requireSettlement: boolean
  ) => {
    const operation = operationEvidence(dependencies.operations.get(operationId, -1), chainId, address)
    if (requireSettlement && !hasVerificationSettlement(operation)) return fail('operation-unsettled')
    const receipt = parseReceipt(
      await rpc(chainId, 'eth_getTransactionReceipt', [operation.transaction!.hash])
    )
    if (
      receipt.transactionHash !== operation.transaction!.hash ||
      receipt.blockHash !== operation.receipt!.blockHash ||
      receipt.blockNumber !== operation.receipt!.blockNumber ||
      receipt.contractAddress !== address
    ) {
      return fail('target-changed')
    }
    const block = parseBlock(await rpc(chainId, 'eth_getBlockByNumber', [receipt.blockNumber, false]))
    if (block.hash !== receipt.blockHash || block.number !== receipt.blockNumber)
      return fail('target-changed')
    const current = operationEvidence(dependencies.operations.get(operationId, -1), chainId, address)
    if (requireSettlement && !hasVerificationSettlement(current)) return fail('operation-unsettled')
    if (
      current.transaction!.hash !== operation.transaction!.hash ||
      current.receipt!.blockHash !== operation.receipt!.blockHash ||
      current.receipt!.blockNumber !== operation.receipt!.blockNumber
    ) {
      return fail('target-changed')
    }
    return current
  }

  const targetSnapshot = async (
    chainId: number,
    address: string,
    operationId?: string,
    requireSettlement = false
  ): Promise<{
    readonly target: ContractVerificationTarget
    readonly code: string
    readonly settled: boolean
  }> => {
    let operation = operationId
      ? await canonicalOperationEvidence(operationId, chainId, address, requireSettlement)
      : undefined
    const snapshot = await stableCode(chainId, address)
    if (operationId) {
      operation = await canonicalOperationEvidence(operationId, chainId, address, requireSettlement)
    }
    const target: ContractVerificationTarget = Object.freeze({
      address,
      chainId,
      runtimeCodeHash: snapshot.codeHash,
      ...(operation
        ? {
            creationEvidence: Object.freeze({
              transactionHash: operation.transaction!.hash,
              blockNumber: operation.receipt!.blockNumber,
              blockHash: operation.receipt!.blockHash,
              operationId: operation.id
            })
          }
        : {})
    })
    return Object.freeze({
      target,
      code: snapshot.code,
      settled: operation ? hasVerificationSettlement(operation) : true
    })
  }

  const revalidateTarget = async (target: ContractVerificationTarget, requireSettlement: boolean) => {
    const operationId = target.creationEvidence?.operationId
    let current: Awaited<ReturnType<typeof targetSnapshot>>
    try {
      current = await targetSnapshot(target.chainId, target.address, operationId, requireSettlement)
    } catch (error) {
      if (
        error instanceof ServiceFailure &&
        ['network-missing', 'network-disabled', 'network-disconnected'].includes(error.code)
      ) {
        return fail('network-changed')
      }
      if (error instanceof ServiceFailure && error.code === 'address-has-no-code') {
        return fail('target-changed')
      }
      throw error
    }
    if (
      current.target.runtimeCodeHash !== target.runtimeCodeHash ||
      JSON.stringify(current.target.creationEvidence) !== JSON.stringify(target.creationEvidence)
    ) {
      return fail('target-changed')
    }
    return current
  }

  const consumeArtifact = (input: {
    artifactToken: unknown
    compilerVersion?: unknown
    contractIdentifier?: unknown
  }): {
    readonly consumed: ConsumedContractVerificationArtifact
    readonly submission: ContractVerificationSubmission
  } => {
    let consumed: ConsumedContractVerificationArtifact
    try {
      consumed = dependencies.artifactIntake.consume(input.artifactToken)
    } catch {
      return fail('invalid-artifact-session')
    }
    const contractIdentifier = input.contractIdentifier ?? consumed.contractIdentifier
    try {
      const submission = prepareContractVerificationSubmission(consumed.artifact, {
        contractIdentifier: contractIdentifier as string,
        ...(input.compilerVersion !== undefined ? { compilerVersion: input.compilerVersion as string } : {})
      })
      return Object.freeze({ consumed, submission })
    } catch (error) {
      if (error instanceof ContractVerificationDomainError) return fail('invalid-artifact')
      return fail('invalid-artifact')
    }
  }

  const prepare = async (
    input: PrepareContractVerificationInput
  ): Promise<ContractVerificationServiceResult<{ readonly prepared: PreparedContractVerification }>> => {
    try {
      if (
        !strictRequest(input, [
          'artifactToken',
          'chainId',
          'address',
          'operationId',
          'compilerVersion',
          'contractIdentifier'
        ])
      ) {
        return fail('invalid-request')
      }
      const timestamp = now()
      prune(timestamp)
      ensureCapacity()
      const chainId = chainIdOf(input.chainId)
      const address = canonicalAddress(input.address)
      const operationId =
        input.operationId === undefined ? undefined : uuid(input.operationId, 'invalid-operation')
      assertNetwork(chainId)
      const { consumed, submission } = consumeArtifact(input)
      const snapshot = await targetSnapshot(chainId, address, operationId)
      if (submission.localRuntimeMatch) {
        try {
          matchContractVerificationRuntimeCode(
            consumed.artifact,
            submission.contractIdentifier,
            snapshot.code
          )
        } catch {
          return fail('artifact-mismatch')
        }
      }
      prune()
      ensureCapacity()
      const token = nextId((candidate) => prepared.has(candidate))
      prepared.set(token, {
        state: 'available',
        submission,
        target: snapshot.target,
        sourceCount: consumed.artifact.sourceCount,
        expiresAt: now() + ttlMs
      })
      return success({
        prepared: {
          acknowledgementToken: token,
          target: snapshot.target,
          language: submission.language,
          compilerVersion: submission.compilerVersion,
          contractIdentifier: submission.contractIdentifier,
          sourceCount: consumed.artifact.sourceCount,
          localRuntimeMatch: submission.localRuntimeMatch ? 'matched' : 'server-required',
          deploymentSettlement: operationId ? (snapshot.settled ? 'complete' : 'pending') : 'not-applicable'
        }
      })
    } catch (error) {
      return failure(error instanceof ServiceFailure ? error.code : 'invalid-request')
    }
  }

  const cacheSubmission = (
    jobId: string,
    target: ContractVerificationTarget,
    submission: ContractVerificationSubmission
  ) => {
    const existing = cached.get(jobId)
    if (existing) {
      clearCached(existing)
      cached.delete(jobId)
    }
    if (!existing) {
      while (prepared.size + cached.size >= capacity && evictOldestCached(jobId)) {
        // Preserve the latest submission and evict the oldest optional cache.
      }
    }
    cached.set(jobId, { submission, target, expiresAt: now() + ttlMs })
  }

  const updateJob = (
    job: ContractVerificationJobRecord,
    replacement: Partial<Pick<ContractVerificationJobRecord, 'status' | 'destinations'>>
  ) => dependencies.jobs.update(job.id, { ...job, ...replacement, updatedAt: Math.max(now(), job.updatedAt) })

  const publish = async (input: {
    readonly acknowledgementToken: unknown
    readonly confirmation: unknown
  }): Promise<ContractVerificationServiceResult<{ readonly job: ContractVerificationJobRecord }>> => {
    let session: PreparedPublicationSession | undefined
    let job: ContractVerificationJobRecord | undefined
    let publicationFenceKey: string | undefined
    let acquiredPublicationFence = false
    try {
      if (!strictRequest(input, ['acknowledgementToken', 'confirmation'])) return fail('invalid-request')
      const timestamp = now()
      prune(timestamp)
      if (input?.confirmation !== 'PUBLISH_CONTRACT_SOURCE') return fail('confirmation-required')
      const token = uuid(input?.acknowledgementToken, 'session-expired')
      session = prepared.get(token)
      if (!session || session.state !== 'available' || !session.submission) return fail('session-expired')
      session.state = 'publishing'
      prepared.delete(token)
      const submission = session.submission
      session.submission = undefined
      await revalidateTarget(session.target, Boolean(session.target.creationEvidence))

      const publicationHash = sourcifyPublicationHash(session.target, submission.submissionHash)
      publicationFenceKey = publicationHash
      if (
        busySourcifyPublications.has(publicationHash) ||
        dependencies.jobs.list().some((candidate) => hasSourcifyPublicationFence(candidate, publicationHash))
      ) {
        return fail('already-submitted')
      }
      busySourcifyPublications.add(publicationHash)
      acquiredPublicationFence = true

      const id = nextId((candidate) => Boolean(dependencies.jobs.get(candidate)))
      const intent: ContractVerificationJobRecord = {
        id,
        target: session.target,
        language: submission.language,
        compilerVersion: submission.compilerVersion,
        contractIdentifier: submission.contractIdentifier,
        sourceHash: submission.sourceHash,
        submissionHash: submission.submissionHash,
        status: 'publishing',
        destinations: initialDestinations(),
        createdAt: timestamp,
        updatedAt: timestamp
      }
      job = dependencies.jobs.put(intent)
      job = updateJob(job, {
        status: 'publishing',
        destinations: replaceDestination(
          job.destinations,
          destination('sourcify', 'unknown', {
            publicationHash,
            reasonCode: 'status-unavailable'
          })
        )
      })
      dependencies.commitState()
      let result: SourcifySubmitResult
      try {
        result = await dependencies.sourcify.submit({
          chainId: session.target.chainId,
          address: session.target.address,
          stdJsonInput: submission.stdJsonInput as Record<string, unknown>,
          compilerVersion: submission.compilerVersion,
          contractIdentifier: submission.contractIdentifier,
          ...(session.target.creationEvidence
            ? { creationTransactionHash: session.target.creationEvidence.transactionHash }
            : {})
        })
      } catch {
        result = { status: 'error', reason: 'service_unavailable' }
      }
      cacheSubmission(id, session.target, submission)
      if (result.status === 'accepted') {
        job = updateJob(job, {
          status: 'publishing',
          destinations: replaceDestination(
            job.destinations,
            destination('sourcify', 'checking', {
              publicationHash,
              remoteId: result.verificationId
            })
          )
        })
      } else if (result.status === 'already_verified') {
        job = updateJob(job, {
          status: 'published',
          destinations: replaceDestination(
            job.destinations,
            destination('sourcify', 'already-published', { publicationHash })
          )
        })
      } else {
        const status = ['service_unavailable', 'timeout', 'rate_limited', 'invalid_response'].includes(
          result.reason
        )
          ? 'unavailable'
          : 'rejected'
        job = updateJob(job, {
          status: status === 'rejected' ? 'rejected' : 'unknown',
          destinations: replaceDestination(
            job.destinations,
            destination('sourcify', status, {
              publicationHash,
              reasonCode: reasonForSourcifyError(result.reason)
            })
          )
        })
      }
      dependencies.commitState()
      return success({ job })
    } catch (error) {
      if (session) clearPrepared(session)
      return failure(error instanceof ServiceFailure ? error.code : 'job-unavailable', job)
    } finally {
      if (acquiredPublicationFence && publicationFenceKey) {
        busySourcifyPublications.delete(publicationFenceKey)
      }
    }
  }

  const projectSourcifyStatus = (job: ContractVerificationJobRecord, result: SourcifyStatusResult) => {
    if (result.status === 'pending') return job
    if (result.status === 'succeeded') {
      const external = result.externalVerifications
      const sourcify = job.destinations.find(({ destination: name }) => name === 'sourcify')
      return updateJob(job, {
        status: 'published',
        destinations: Object.freeze([
          destination('sourcify', 'published', {
            ...(sourcify?.publicationHash ? { publicationHash: sourcify.publicationHash } : {}),
            ...(sourcify?.remoteId ? { remoteId: sourcify.remoteId } : {})
          }),
          forwardedDestination('etherscan-forwarded', external.etherscan),
          forwardedDestination('blockscout-forwarded', external.blockscout),
          forwardedDestination('routescan-forwarded', external.routescan),
          job.destinations.find(({ destination: name }) => name === 'etherscan-direct') ||
            destination('etherscan-direct', 'not-submitted')
        ])
      })
    }
    if (result.status === 'failed') {
      const sourcify = job.destinations.find(({ destination: name }) => name === 'sourcify')
      return updateJob(job, {
        status: 'rejected',
        destinations: replaceDestination(
          job.destinations,
          destination('sourcify', 'rejected', {
            ...(sourcify?.publicationHash ? { publicationHash: sourcify.publicationHash } : {}),
            ...(sourcify?.remoteId ? { remoteId: sourcify.remoteId } : {}),
            reasonCode: 'publication-rejected'
          })
        )
      })
    }
    if (result.status === 'unknown') {
      const sourcify = job.destinations.find(({ destination: name }) => name === 'sourcify')
      return updateJob(job, {
        status: 'unknown',
        destinations: replaceDestination(
          job.destinations,
          destination('sourcify', 'unknown', {
            ...(sourcify?.publicationHash ? { publicationHash: sourcify.publicationHash } : {}),
            ...(sourcify?.remoteId ? { remoteId: sourcify.remoteId } : {}),
            reasonCode: 'status-unavailable'
          })
        )
      })
    }
    return undefined
  }

  const refresh = async (
    input: unknown
  ): Promise<ContractVerificationServiceResult<{ readonly job: ContractVerificationJobRecord }>> => {
    let job: ContractVerificationJobRecord | undefined
    let acquired = false
    try {
      const jobId = uuid(input, 'job-unavailable')
      if (busyJobs.has(jobId)) return fail('already-submitted')
      busyJobs.add(jobId)
      acquired = true
      job = dependencies.jobs.get(jobId)
      if (!job) return fail('job-unavailable')
      const sourcify =
        job.destinations.find(({ destination: name }) => name === 'sourcify') ||
        destination('sourcify', 'not-submitted')
      if (job.status === 'publishing' && sourcify.status === 'not-submitted') {
        job = updateJob(job, {
          status: 'unknown',
          destinations: replaceDestination(
            job.destinations,
            destination('sourcify', 'unknown', { reasonCode: 'status-unavailable' })
          )
        })
      } else if (['checking', 'unknown'].includes(sourcify.status) && sourcify.remoteId) {
        const polled = await dependencies.sourcify.status(sourcify.remoteId, {
          chainId: job.target.chainId,
          address: job.target.address
        })
        const projected = projectSourcifyStatus(job, polled)
        if (!projected && polled.status !== 'pending') return failure('refresh-unavailable', job)
        if (projected) job = projected
      }

      const direct =
        job.destinations.find(({ destination: name }) => name === 'etherscan-direct') ||
        destination('etherscan-direct', 'not-submitted')
      if (['checking', 'needs-api-key'].includes(direct.status) && direct.remoteId) {
        let apiKey: string | undefined
        try {
          apiKey = dependencies.credentialStore.load()
        } catch {
          return failure('credential-unavailable', job)
        }
        if (!apiKey) return failure('api-key-required', job)
        const polled = await dependencies.etherscan.status(job.target.chainId, direct.remoteId, apiKey)
        apiKey = undefined
        if (polled.status === 'pending' && direct.status === 'needs-api-key') {
          job = updateJob(job, {
            status: jobStatusAfterDirect(job),
            destinations: replaceDestination(
              job.destinations,
              destination('etherscan-direct', 'checking', {
                ...(direct.publicationHash ? { publicationHash: direct.publicationHash } : {}),
                remoteId: direct.remoteId
              })
            )
          })
        } else if (polled.status === 'verified' || polled.status === 'rejected') {
          job = updateJob(job, {
            status: jobStatusAfterDirect(job),
            destinations: replaceDestination(
              job.destinations,
              destination('etherscan-direct', polled.status, {
                ...(direct.publicationHash ? { publicationHash: direct.publicationHash } : {}),
                remoteId: direct.remoteId,
                ...(polled.status === 'rejected' ? { reasonCode: 'destination-rejected' as const } : {})
              })
            )
          })
        } else if (polled.status === 'unavailable') {
          return failure('refresh-unavailable', job)
        } else if (polled.status === 'invalid_api_key') {
          job = updateJob(job, {
            status: jobStatusAfterDirect(job),
            destinations: replaceDestination(
              job.destinations,
              destination('etherscan-direct', 'needs-api-key', {
                ...(direct.publicationHash ? { publicationHash: direct.publicationHash } : {}),
                remoteId: direct.remoteId,
                reasonCode: 'api-key-required'
              })
            )
          })
          return failure('api-key-required', job)
        }
      }
      return success({ job })
    } catch (error) {
      return failure(error instanceof ServiceFailure ? error.code : 'refresh-unavailable', job)
    } finally {
      if (acquired) busyJobs.delete(job?.id || (input as string))
    }
  }

  const reselect = async (
    input: ReselectContractVerificationInput
  ): Promise<ContractVerificationServiceResult<{ readonly job: ContractVerificationJobRecord }>> => {
    try {
      if (!strictRequest(input, ['artifactToken', 'jobId', 'compilerVersion', 'contractIdentifier'])) {
        return fail('invalid-request')
      }
      prune()
      const jobId = uuid(input?.jobId, 'job-unavailable')
      const job = dependencies.jobs.get(jobId)
      if (!job) return fail('job-unavailable')
      const { submission } = consumeArtifact(input)
      if (
        submission.submissionHash !== job.submissionHash ||
        submission.sourceHash !== job.sourceHash ||
        submission.compilerVersion !== job.compilerVersion ||
        submission.contractIdentifier !== job.contractIdentifier ||
        submission.language !== job.language
      ) {
        return fail('artifact-mismatch')
      }
      await revalidateTarget(job.target, false)
      if (!cached.has(jobId)) ensureCapacity(jobId)
      cacheSubmission(jobId, job.target, submission)
      return success({ job })
    } catch (error) {
      return failure(error instanceof ServiceFailure ? error.code : 'invalid-artifact')
    }
  }

  const publishEtherscan = async (input: {
    readonly jobId: unknown
    readonly confirmation: unknown
    readonly constructorArguments?: unknown
    readonly noConstructorArguments?: unknown
  }): Promise<ContractVerificationServiceResult<{ readonly job: ContractVerificationJobRecord }>> => {
    let job: ContractVerificationJobRecord | undefined
    let acquired = false
    let publicationFenceKey: string | undefined
    let acquiredPublicationFence = false
    try {
      if (
        !strictRequest(input, ['jobId', 'confirmation', 'constructorArguments', 'noConstructorArguments'])
      ) {
        return fail('invalid-request')
      }
      if (input?.confirmation !== 'PUBLISH_TO_ETHERSCAN') return fail('confirmation-required')
      const noConstructorArguments = input.noConstructorArguments === true
      const constructorArguments =
        !noConstructorArguments &&
        typeof input.constructorArguments === 'string' &&
        input.constructorArguments.length <= MAX_CONSTRUCTOR_ARGUMENTS_LENGTH &&
        CONSTRUCTOR_ARGUMENTS.test(input.constructorArguments)
          ? input.constructorArguments
          : noConstructorArguments && input.constructorArguments === undefined
            ? ''
            : fail('invalid-request')
      const jobId = uuid(input?.jobId, 'job-unavailable')
      if (busyJobs.has(jobId)) return fail('already-submitted')
      busyJobs.add(jobId)
      acquired = true
      job = dependencies.jobs.get(jobId)
      if (!job) return fail('job-unavailable')
      if (!supportedEtherscanChains.has(job.target.chainId)) return fail('etherscan-unsupported')
      const sourcify =
        job.destinations.find(({ destination: name }) => name === 'sourcify') ||
        destination('sourcify', 'not-submitted')
      const forwarded =
        job.destinations.find(({ destination: name }) => name === 'etherscan-forwarded') ||
        destination('etherscan-forwarded', 'not-submitted')
      const direct =
        job.destinations.find(({ destination: name }) => name === 'etherscan-direct') ||
        destination('etherscan-direct', 'not-submitted')
      if (!['published', 'already-published'].includes(sourcify.status)) return fail('already-submitted')
      if (!['not-submitted', 'unavailable', 'rejected', 'unknown'].includes(forwarded.status)) {
        return fail('already-submitted')
      }
      if (
        ['checking', 'verified', 'already-verified'].includes(direct.status) ||
        (direct.status === 'needs-api-key' && Boolean(direct.remoteId)) ||
        Boolean(direct.remoteId)
      ) {
        return fail('already-submitted')
      }
      if (!['not-submitted', 'unavailable', 'needs-api-key'].includes(direct.status)) {
        return fail('already-submitted')
      }
      const fenceJob = job
      const publicationHash = etherscanPublicationHash(fenceJob, constructorArguments)
      publicationFenceKey = publicationHash
      const legacyFenceKey = legacyEtherscanPublicationFenceKey(fenceJob)
      if (
        busyEtherscanPublications.has(publicationHash) ||
        dependencies.jobs
          .list()
          .some(
            (candidate) =>
              candidate.id !== fenceJob.id &&
              hasEtherscanPublicationFence(candidate, publicationHash, legacyFenceKey, constructorArguments)
          )
      ) {
        return fail('already-submitted')
      }
      busyEtherscanPublications.add(publicationHash)
      acquiredPublicationFence = true
      prune()
      const source = cached.get(jobId)
      if (
        !source?.submission ||
        source.submission.submissionHash !== job.submissionHash ||
        source.submission.sourceHash !== job.sourceHash ||
        JSON.stringify(source.target) !== JSON.stringify(job.target)
      ) {
        return fail('source-reselection-required')
      }
      await revalidateTarget(job.target, Boolean(job.target.creationEvidence))
      let apiKey: string | undefined
      try {
        apiKey = dependencies.credentialStore.load()
      } catch {
        return fail('credential-unavailable')
      }
      if (!apiKey) return fail('api-key-required')
      const request = etherscanInput(job, source.submission, constructorArguments)
      job = updateJob(job, {
        status: job.status,
        destinations: replaceCompleteDestination(
          job.destinations,
          destination('etherscan-direct', 'unknown', {
            publicationHash,
            reasonCode: 'status-unavailable'
          })
        )
      })
      dependencies.commitState()
      let result: EtherscanSubmitResult
      try {
        result = await dependencies.etherscan.submit(request, apiKey)
      } catch {
        result = { status: 'unknown' }
      } finally {
        apiKey = undefined
      }
      if (result.status === 'accepted') {
        job = updateJob(job, {
          status: job.status,
          destinations: replaceDestination(
            job.destinations,
            destination('etherscan-direct', 'checking', {
              publicationHash,
              remoteId: result.guid
            })
          )
        })
      } else if (result.status === 'already_verified') {
        job = updateJob(job, {
          status: job.status,
          destinations: replaceDestination(
            job.destinations,
            destination('etherscan-direct', 'already-verified', {
              publicationHash
            })
          )
        })
      } else {
        const status = result.status === 'invalid_api_key' ? 'needs-api-key' : result.status
        job = updateJob(job, {
          status: job.status,
          destinations: replaceDestination(
            job.destinations,
            destination('etherscan-direct', status, {
              ...(['rejected', 'unknown'].includes(status) ? { publicationHash } : {}),
              reasonCode:
                status === 'rejected'
                  ? 'destination-rejected'
                  : status === 'needs-api-key'
                    ? 'api-key-required'
                    : status === 'unknown'
                      ? 'transport-failure'
                      : 'destination-unavailable'
            })
          )
        })
      }
      dependencies.commitState()
      return success({ job })
    } catch (error) {
      return failure(error instanceof ServiceFailure ? error.code : 'job-unavailable', job)
    } finally {
      if (acquiredPublicationFence && publicationFenceKey) {
        busyEtherscanPublications.delete(publicationFenceKey)
      }
      if (acquired) busyJobs.delete(job?.id || (input.jobId as string))
    }
  }

  const list = (): ContractVerificationServiceResult<{
    readonly jobs: readonly ContractVerificationJobRecord[]
  }> => {
    try {
      return success({ jobs: dependencies.jobs.list() })
    } catch {
      return failure('job-unavailable')
    }
  }

  const get = (
    input: unknown
  ): ContractVerificationServiceResult<{ readonly job: ContractVerificationJobRecord }> => {
    try {
      const job = dependencies.jobs.get(uuid(input, 'job-unavailable'))
      return job ? success({ job }) : failure('job-unavailable')
    } catch {
      return failure('job-unavailable')
    }
  }

  const credentialStatus = (): ContractVerificationServiceResult<{
    readonly credential: ExplorerCredentialStatus
  }> => {
    try {
      return success({ credential: dependencies.credentialStore.status() })
    } catch {
      return failure('credential-unavailable')
    }
  }

  const saveCredential = (
    apiKey: unknown
  ): ContractVerificationServiceResult<{ readonly credential: ExplorerCredentialStatus }> => {
    try {
      if (typeof apiKey !== 'string') return fail('invalid-request')
      return success({ credential: dependencies.credentialStore.save(apiKey) })
    } catch {
      return failure('credential-unavailable')
    }
  }

  const removeCredential = (): ContractVerificationServiceResult<{
    readonly credential: ExplorerCredentialStatus
  }> => {
    try {
      return success({ credential: dependencies.credentialStore.remove() })
    } catch {
      return failure('credential-unavailable')
    }
  }

  const dispose = () => {
    for (const session of prepared.values()) clearPrepared(session)
    for (const session of cached.values()) clearCached(session)
    prepared.clear()
    cached.clear()
    busyJobs.clear()
    busySourcifyPublications.clear()
    busyEtherscanPublications.clear()
  }

  return Object.freeze({
    credentialStatus,
    dispose,
    get,
    list,
    prepare,
    publish,
    publishEtherscan,
    refresh,
    removeCredential,
    reselect,
    saveCredential
  })
}

export type ContractVerificationService = ReturnType<typeof createContractVerificationService>
