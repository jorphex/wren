import crypto from 'crypto'

import {
  type DeploymentDraft,
  type DeploymentTransaction,
  DeploymentDomainError,
  deriveProvisionalDeploymentAddress,
  inspectDeploymentInitcode,
  parseDeploymentPendingNonce,
  snapshotDeploymentDraft
} from '../../resources/domain/deployment'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'

export const DEPLOYMENT_INSPECTION_TTL_MS = 60_000
export const MAX_DEPLOYMENT_INSPECTIONS = 64
export const DEPLOYMENT_EVIDENCE_TIMEOUT_MS = 15_000

export const DEPLOYMENT_SERVICE_ERROR_CODES = Object.freeze([
  'invalid-request',
  'invalid-draft',
  'invalid-account',
  'invalid-chain-id',
  'invalid-initcode',
  'initcode-too-large',
  'invalid-value',
  'value-precision',
  'value-overflow',
  'account-unavailable',
  'account-changed',
  'watch-only',
  'signer-unavailable',
  'network-missing',
  'network-disabled',
  'network-disconnected',
  'network-changed',
  'invalid-native-decimals',
  'inspection-capacity',
  'inspection-unavailable',
  'inspection-expired',
  'inspection-used',
  'inspection-changed',
  'origin-unavailable',
  'queue-unavailable'
] as const)

export type DeploymentServiceErrorCode = (typeof DEPLOYMENT_SERVICE_ERROR_CODES)[number]

export type DeploymentServiceResult<T extends object> =
  ({ readonly success: true } & T) | { readonly success: false; readonly error: DeploymentServiceErrorCode }

export interface DeploymentAccountContext {
  readonly id: string
  readonly status: string
  readonly watchOnly: boolean
  /** True when the account still has a signer association; the signer may be locked. */
  readonly signerCapable: boolean
}

export interface DeploymentNetworkContext {
  readonly type: 'ethereum'
  readonly chainId: number
  readonly configured: boolean
  readonly enabled: boolean
  readonly connected: boolean
  readonly nativeDecimals: unknown
}

export type DeploymentEvidenceFailureCode = 'timeout' | 'rpc-unavailable' | 'rpc-error' | 'invalid-response'

type EvidenceFailure = {
  readonly status: 'unavailable' | 'failed'
  readonly source: 'configured-rpc'
  readonly reasonCode: DeploymentEvidenceFailureCode
  readonly reason: string
}

export type DeploymentGasEstimateEvidence =
  | {
      readonly status: 'succeeded'
      readonly source: 'configured-rpc'
      readonly method: 'eth_estimateGas'
      readonly value: string
      /** provider.estimateGas applies Wren's 1.5x safety margin. */
      readonly padded: true
    }
  | (EvidenceFailure & { readonly method: 'eth_estimateGas' })

export type DeploymentSimulationEvidence = {
  readonly status: 'succeeded' | 'reverted' | 'unavailable' | 'failed'
  readonly source: 'configured-rpc'
  readonly method?: 'eth_simulateV1' | 'eth_call'
  readonly gasUsed?: string
  readonly reasonCode?: DeploymentEvidenceFailureCode | 'execution-reverted'
  readonly reason?: string
  readonly advancedChecks: 'complete' | 'partly-unavailable' | 'pending' | 'not-run'
}

export type DeploymentPendingNonceEvidence =
  | {
      readonly status: 'succeeded'
      readonly source: 'configured-rpc'
      readonly method: 'eth_getTransactionCount'
      readonly nonce: string
      readonly provisionalAddress: string
      readonly provisional: true
    }
  | (EvidenceFailure & { readonly method: 'eth_getTransactionCount' })

export interface DeploymentInspection {
  readonly id: string
  readonly preparedAt: number
  readonly expiresAt: number
  readonly account: string
  readonly chainId: string
  readonly initcode: Readonly<{ bytes: number; hash: string }>
  readonly value: string
  readonly gasEstimate: DeploymentGasEstimateEvidence
  readonly simulation: DeploymentSimulationEvidence
  readonly pendingNonce: DeploymentPendingNonceEvidence
}

export interface DeploymentTrustedMetadata {
  readonly version: 1
  readonly inspectionId: string
  readonly account: string
  readonly chainId: string
  readonly initcodeHash: string
  readonly initcodeBytes: number
  readonly value: string
  readonly preparedAt: number
  readonly expiresAt: number
  readonly provisionalAddress?: string
  readonly pendingNonce?: string
}

export interface DeploymentQueueInput {
  readonly inspectionId: string
  readonly draft: DeploymentDraft
}

export interface DeploymentAdmissionInput {
  readonly originId: string
  readonly transaction: DeploymentTransaction
  readonly metadata: DeploymentTrustedMetadata
}

export interface DeploymentServiceDependencies {
  readonly getCurrentAccount: () => DeploymentAccountContext | undefined
  readonly getNetwork: (chainId: number) => DeploymentNetworkContext | undefined
  /** Uses the configured RPC and returns provider.estimateGas's padded quantity. */
  readonly estimateGas: (transaction: DeploymentTransaction) => Promise<unknown>
  readonly simulateTransaction: (transaction: DeploymentTransaction) => Promise<unknown>
  readonly getPendingNonce: (transaction: DeploymentTransaction) => Promise<unknown>
  /** Must create or validate Wren's distinct managed deployment origin. */
  readonly ensureDeploymentOrigin: (chainId: number) => string | Promise<string>
  readonly admitTransaction: (
    input: DeploymentAdmissionInput
  ) => Promise<{ readonly handlerId: string }> | { readonly handlerId: string }
}

export interface DeploymentServiceOptions {
  readonly now?: () => number
  readonly inspectionId?: () => string
  readonly inspectionTtlMs?: number
  readonly evidenceTimeoutMs?: number
  readonly capacity?: number
}

export class DeploymentEvidenceError extends Error {
  constructor(readonly code: 'unavailable' | 'failed') {
    super(code === 'unavailable' ? 'Configured RPC unavailable' : 'Configured RPC request failed')
    this.name = 'DeploymentEvidenceError'
  }
}

interface PreparationContext {
  readonly account: string
  readonly accountStatus: string
  readonly signerCapable: boolean
  readonly chainId: number
  readonly nativeDecimals: number
}

interface InspectionRecord {
  readonly id: string
  readonly preparedAt: number
  readonly expiresAt: number
  readonly account: string
  readonly chainId: string
  readonly initcodeHash: string
  readonly initcodeBytes: number
  readonly value: string
  readonly fingerprint: string
  readonly provisionalAddress?: string
  readonly pendingNonce?: string
  state: 'available' | 'queueing'
}

class ServiceFailure extends Error {
  constructor(readonly code: DeploymentServiceErrorCode) {
    super(code)
    this.name = 'DeploymentServiceFailure'
  }
}

class EvidenceTimeout extends Error {}

const failure = <T extends object>(error: DeploymentServiceErrorCode): DeploymentServiceResult<T> =>
  Object.freeze({ success: false, error })

const fixedReason = Object.freeze({
  timeout: 'Configured RPC check timed out',
  'rpc-unavailable': 'Configured RPC check is unavailable',
  'rpc-error': 'Configured RPC check failed',
  'invalid-response': 'Configured RPC returned an invalid response',
  'execution-reverted': 'Configured RPC reports that deployment will revert'
})

function positiveInteger(value: unknown, fallback: number) {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function canonicalAccount(value: string): string | undefined {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return
  return value.toLowerCase()
}

function domainFailure(error: unknown): DeploymentServiceErrorCode {
  if (!(error instanceof DeploymentDomainError)) return 'invalid-draft'
  if (error.code === 'invalid-decimals') return 'invalid-native-decimals'
  return DEPLOYMENT_SERVICE_ERROR_CODES.includes(error.code as DeploymentServiceErrorCode)
    ? (error.code as DeploymentServiceErrorCode)
    : 'invalid-draft'
}

function evidenceFailure(error: unknown): EvidenceFailure {
  const reasonCode: DeploymentEvidenceFailureCode =
    error instanceof EvidenceTimeout
      ? 'timeout'
      : error instanceof DeploymentEvidenceError && error.code === 'unavailable'
        ? 'rpc-unavailable'
        : 'rpc-error'
  return Object.freeze({
    status: reasonCode === 'timeout' || reasonCode === 'rpc-unavailable' ? 'unavailable' : 'failed',
    source: 'configured-rpc',
    reasonCode,
    reason: fixedReason[reasonCode]
  })
}

async function withTimeout<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EvidenceTimeout()), timeoutMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function contextFor(
  dependencies: DeploymentServiceDependencies,
  accountInput: string,
  chainId: number
): PreparationContext {
  const account = dependencies.getCurrentAccount()
  if (!account) throw new ServiceFailure('account-unavailable')
  const accountId = canonicalAccount(account.id)
  if (!accountId) throw new ServiceFailure('account-unavailable')
  if (accountId !== accountInput) throw new ServiceFailure('account-changed')
  if (account.watchOnly) throw new ServiceFailure('watch-only')
  if (account.status !== 'ok') throw new ServiceFailure('account-unavailable')
  if (!account.signerCapable) throw new ServiceFailure('signer-unavailable')

  const network = dependencies.getNetwork(chainId)
  if (!network || network.type !== 'ethereum' || !network.configured || network.chainId !== chainId) {
    throw new ServiceFailure('network-missing')
  }
  if (!network.enabled) throw new ServiceFailure('network-disabled')
  if (!network.connected) throw new ServiceFailure('network-disconnected')
  if (
    !Number.isInteger(network.nativeDecimals) ||
    (network.nativeDecimals as number) < 0 ||
    (network.nativeDecimals as number) > 255
  ) {
    throw new ServiceFailure('invalid-native-decimals')
  }

  return Object.freeze({
    account: accountId,
    accountStatus: account.status,
    signerCapable: account.signerCapable,
    chainId,
    nativeDecimals: network.nativeDecimals as number
  })
}

function assertContextStable(
  dependencies: DeploymentServiceDependencies,
  expected: PreparationContext
): void {
  const account = dependencies.getCurrentAccount()
  const accountId = account && canonicalAccount(account.id)
  if (
    !account ||
    accountId !== expected.account ||
    account.status !== expected.accountStatus ||
    account.watchOnly ||
    account.signerCapable !== expected.signerCapable
  ) {
    throw new ServiceFailure('account-changed')
  }

  const network = dependencies.getNetwork(expected.chainId)
  if (
    !network ||
    network.type !== 'ethereum' ||
    network.chainId !== expected.chainId ||
    !network.configured ||
    !network.enabled ||
    !network.connected ||
    network.nativeDecimals !== expected.nativeDecimals
  ) {
    throw new ServiceFailure('network-changed')
  }
}

function fingerprint(record: {
  account: string
  chainId: string
  initcodeHash: string
  initcodeBytes: number
  value: string
}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        record.account,
        record.chainId,
        record.initcodeHash,
        record.initcodeBytes,
        record.value
      ])
    )
    .digest('hex')
}

function gasEvidence(value: unknown): DeploymentGasEstimateEvidence {
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined || parsed === 0n) {
    const unavailable = evidenceFailure(new Error('invalid-response'))
    return Object.freeze({
      ...unavailable,
      reasonCode: 'invalid-response',
      reason: fixedReason['invalid-response'],
      method: 'eth_estimateGas'
    })
  }
  return Object.freeze({
    status: 'succeeded',
    source: 'configured-rpc',
    method: 'eth_estimateGas',
    value: toRpcQuantity(parsed),
    padded: true
  })
}

function failedGasEvidence(error: unknown): DeploymentGasEstimateEvidence {
  return Object.freeze({ ...evidenceFailure(error), method: 'eth_estimateGas' })
}

function simulationEvidence(value: unknown): DeploymentSimulationEvidence {
  if (
    !isRecord(value) ||
    !['succeeded', 'reverted', 'unavailable', 'failed'].includes(String(value['status']))
  ) {
    return Object.freeze({
      status: 'failed',
      source: 'configured-rpc',
      reasonCode: 'invalid-response',
      reason: fixedReason['invalid-response'],
      advancedChecks: 'not-run'
    })
  }

  const status = value['status'] as DeploymentSimulationEvidence['status']
  const method =
    value['source'] === 'eth_simulateV1' || value['source'] === 'eth_call' ? value['source'] : undefined
  if (
    (value['source'] !== undefined && !method) ||
    ((status === 'succeeded' || status === 'reverted') && !method)
  ) {
    return Object.freeze({
      status: 'failed',
      source: 'configured-rpc',
      reasonCode: 'invalid-response',
      reason: fixedReason['invalid-response'],
      advancedChecks: 'not-run'
    })
  }
  const parsedGas = value['gasUsed'] === undefined ? undefined : parseRpcQuantity(value['gasUsed'])
  if (value['gasUsed'] !== undefined && parsedGas === undefined) {
    return Object.freeze({
      status: 'failed',
      source: 'configured-rpc',
      ...(method ? { method } : {}),
      reasonCode: 'invalid-response',
      reason: fixedReason['invalid-response'],
      advancedChecks: 'not-run'
    })
  }
  const advanced = isRecord(value['advancedChecks']) ? value['advancedChecks']['status'] : undefined
  const advancedChecks = ['complete', 'partly-unavailable', 'pending'].includes(String(advanced))
    ? (advanced as 'complete' | 'partly-unavailable' | 'pending')
    : 'not-run'
  const reasonCode =
    status === 'reverted'
      ? ('execution-reverted' as const)
      : status === 'unavailable'
        ? ('rpc-unavailable' as const)
        : status === 'failed'
          ? ('rpc-error' as const)
          : undefined

  return Object.freeze({
    status,
    source: 'configured-rpc',
    ...(method ? { method } : {}),
    ...(parsedGas !== undefined ? { gasUsed: toRpcQuantity(parsedGas) } : {}),
    ...(reasonCode ? { reasonCode, reason: fixedReason[reasonCode] } : {}),
    advancedChecks
  })
}

function failedSimulationEvidence(error: unknown): DeploymentSimulationEvidence {
  const unavailable = evidenceFailure(error)
  return Object.freeze({ ...unavailable, advancedChecks: 'not-run' })
}

function nonceEvidence(value: unknown, account: string): DeploymentPendingNonceEvidence {
  try {
    const nonce = parseDeploymentPendingNonce(value)
    const canonicalNonce = toRpcQuantity(nonce)
    return Object.freeze({
      status: 'succeeded',
      source: 'configured-rpc',
      method: 'eth_getTransactionCount',
      nonce: canonicalNonce,
      provisionalAddress: deriveProvisionalDeploymentAddress(account, canonicalNonce),
      provisional: true
    })
  } catch {
    return Object.freeze({
      status: 'failed',
      source: 'configured-rpc',
      method: 'eth_getTransactionCount',
      reasonCode: 'invalid-response',
      reason: fixedReason['invalid-response']
    })
  }
}

function failedNonceEvidence(error: unknown): DeploymentPendingNonceEvidence {
  return Object.freeze({ ...evidenceFailure(error), method: 'eth_getTransactionCount' })
}

export function createDeploymentService(
  dependencies: DeploymentServiceDependencies,
  options: DeploymentServiceOptions = {}
) {
  const now = options.now ?? Date.now
  const inspectionId = options.inspectionId ?? (() => crypto.randomBytes(16).toString('hex'))
  const inspectionTtlMs = positiveInteger(options.inspectionTtlMs, DEPLOYMENT_INSPECTION_TTL_MS)
  const evidenceTimeoutMs = positiveInteger(options.evidenceTimeoutMs, DEPLOYMENT_EVIDENCE_TIMEOUT_MS)
  const capacity = positiveInteger(options.capacity, MAX_DEPLOYMENT_INSPECTIONS)
  const inspections = new Map<string, InspectionRecord>()
  let preparationsInFlight = 0

  const prune = () => {
    const current = now()
    for (const [id, record] of inspections) {
      if (record.expiresAt <= current) inspections.delete(id)
    }
  }

  const createInspectionId = () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = inspectionId()
      if (/^[0-9a-f]{32}$/u.test(candidate) && !inspections.has(candidate)) return candidate
    }
    throw new ServiceFailure('inspection-unavailable')
  }

  const prepare = async (
    draft: DeploymentDraft
  ): Promise<DeploymentServiceResult<{ readonly inspection: DeploymentInspection }>> => {
    prune()
    if (inspections.size + preparationsInFlight >= capacity) return failure('inspection-capacity')
    preparationsInFlight += 1
    try {
      if (!draft || typeof draft !== 'object') return failure('invalid-draft')
      if (!Number.isSafeInteger(draft.chainId) || draft.chainId <= 0) return failure('invalid-chain-id')
      const draftAccount = canonicalAccount(draft.account)
      if (!draftAccount) return failure('invalid-account')
      const context = contextFor(dependencies, draftAccount, draft.chainId)
      let snapshot
      try {
        snapshot = snapshotDeploymentDraft(draft, context.nativeDecimals)
      } catch (error) {
        return failure(domainFailure(error))
      }
      const transaction: DeploymentTransaction = Object.freeze({
        from: snapshot.account,
        chainId: snapshot.chainId,
        data: snapshot.initcode,
        value: snapshot.value
      })

      const [gasResult, simulationResult, nonceResult] = await Promise.allSettled([
        withTimeout(() => dependencies.estimateGas(transaction), evidenceTimeoutMs),
        withTimeout(() => dependencies.simulateTransaction(transaction), evidenceTimeoutMs),
        withTimeout(() => dependencies.getPendingNonce(transaction), evidenceTimeoutMs)
      ])
      assertContextStable(dependencies, context)

      const gasEstimate =
        gasResult.status === 'fulfilled' ? gasEvidence(gasResult.value) : failedGasEvidence(gasResult.reason)
      const simulation =
        simulationResult.status === 'fulfilled'
          ? simulationEvidence(simulationResult.value)
          : failedSimulationEvidence(simulationResult.reason)
      const pendingNonce =
        nonceResult.status === 'fulfilled'
          ? nonceEvidence(nonceResult.value, snapshot.account)
          : failedNonceEvidence(nonceResult.reason)
      const initcode = Object.freeze(inspectDeploymentInitcode(snapshot.initcode))
      const preparedAt = now()
      const expiresAt = preparedAt + inspectionTtlMs
      const id = createInspectionId()
      const recordBase = {
        id,
        preparedAt,
        expiresAt,
        account: snapshot.account,
        chainId: snapshot.chainId,
        initcodeHash: initcode.hash,
        initcodeBytes: initcode.bytes,
        value: snapshot.value,
        ...(pendingNonce.status === 'succeeded'
          ? {
              provisionalAddress: pendingNonce.provisionalAddress,
              pendingNonce: pendingNonce.nonce
            }
          : {})
      }
      const record: InspectionRecord = {
        ...recordBase,
        fingerprint: fingerprint(recordBase),
        state: 'available'
      }
      inspections.set(id, record)
      const inspection: DeploymentInspection = Object.freeze({
        id,
        preparedAt,
        expiresAt,
        account: snapshot.account,
        chainId: snapshot.chainId,
        initcode,
        value: snapshot.value,
        gasEstimate,
        simulation,
        pendingNonce
      })
      return Object.freeze({ success: true, inspection })
    } catch (error) {
      return failure(error instanceof ServiceFailure ? error.code : 'inspection-unavailable')
    } finally {
      preparationsInFlight -= 1
    }
  }

  const queue = async (
    input: DeploymentQueueInput
  ): Promise<
    DeploymentServiceResult<{ readonly handlerId: string; readonly metadata: DeploymentTrustedMetadata }>
  > => {
    if (!input || typeof input !== 'object' || typeof input.inspectionId !== 'string' || !input.draft) {
      return failure('invalid-request')
    }
    const record = inspections.get(input.inspectionId)
    if (!record) return failure('inspection-unavailable')
    if (record.state !== 'available') return failure('inspection-used')
    if (record.expiresAt <= now()) {
      inspections.delete(record.id)
      return failure('inspection-expired')
    }

    try {
      const chainId = Number(BigInt(record.chainId))
      const draftAccount = canonicalAccount(input.draft.account)
      if (!draftAccount) return failure('invalid-account')
      const context = contextFor(dependencies, record.account, chainId)
      let snapshot
      try {
        snapshot = snapshotDeploymentDraft(input.draft, context.nativeDecimals)
      } catch (error) {
        return failure(domainFailure(error))
      }
      const initcode = inspectDeploymentInitcode(snapshot.initcode)
      const actualFingerprint = fingerprint({
        account: snapshot.account,
        chainId: snapshot.chainId,
        initcodeHash: initcode.hash,
        initcodeBytes: initcode.bytes,
        value: snapshot.value
      })
      if (actualFingerprint !== record.fingerprint) return failure('inspection-changed')
      assertContextStable(dependencies, context)

      const transaction: DeploymentTransaction = Object.freeze({
        from: snapshot.account,
        chainId: snapshot.chainId,
        data: snapshot.initcode,
        value: snapshot.value
      })
      const metadata: DeploymentTrustedMetadata = Object.freeze({
        version: 1,
        inspectionId: record.id,
        account: record.account,
        chainId: record.chainId,
        initcodeHash: record.initcodeHash,
        initcodeBytes: record.initcodeBytes,
        value: record.value,
        preparedAt: record.preparedAt,
        expiresAt: record.expiresAt,
        ...(record.provisionalAddress && record.pendingNonce
          ? {
              provisionalAddress: record.provisionalAddress,
              pendingNonce: record.pendingNonce
            }
          : {})
      })

      // Admission may have side effects even when its completion signal fails. Consume before crossing that boundary.
      record.state = 'queueing'
      inspections.delete(record.id)
      let originId: string
      try {
        originId = await dependencies.ensureDeploymentOrigin(chainId)
      } catch {
        return failure('origin-unavailable')
      }
      if (typeof originId !== 'string' || originId.length === 0 || originId.length > 256) {
        return failure('origin-unavailable')
      }
      if (record.expiresAt <= now()) return failure('inspection-expired')
      assertContextStable(dependencies, context)
      let admitted: { readonly handlerId: string }
      try {
        admitted = await dependencies.admitTransaction({ originId, transaction, metadata })
      } catch {
        return failure('queue-unavailable')
      }
      if (
        !admitted ||
        typeof admitted.handlerId !== 'string' ||
        admitted.handlerId.length === 0 ||
        admitted.handlerId.length > 256
      ) {
        return failure('queue-unavailable')
      }
      return Object.freeze({ success: true, handlerId: admitted.handlerId, metadata })
    } catch (error) {
      return failure(error instanceof ServiceFailure ? error.code : 'queue-unavailable')
    }
  }

  return Object.freeze({ prepare, queue })
}

export type DeploymentService = ReturnType<typeof createDeploymentService>
