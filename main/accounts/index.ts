import EventEmitter from 'events'
import log from 'electron-log'
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'

import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import FrameAccount from './Account'
import ExternalDataScanner, { DataScanner } from '../externalData'
import Signer from '../signers/Signer'
import { SignerUserRejectedError, USER_REJECTED_REQUEST } from '../signers/errors'
import { signerCompatibility as transactionCompatibility, maxFee, SignerCompatibility } from '../transaction'

import { accountPanelCrumb, signerPanelCrumb } from '../../resources/domain/nav'
import { usesBaseFee, TransactionData, GasFeesSource } from '../../resources/domain/transaction'
import {
  WATCH_ONLY_SIGNING_ERROR,
  findUnavailableSigners,
  isSignerReady,
  isWatchOnlyAccountType
} from '../../resources/domain/signer'
import { isCancelableRequest, isSignatureRequest, isTransactionRequest } from '../../resources/domain/request'

import {
  AccountRequest,
  AnyAccountRequest,
  AccessRequest,
  TransactionRequest,
  TransactionReceipt,
  ReplacementType,
  RequestStatus,
  RequestMode,
  TypedMessage,
  PermitSignatureRequest,
  ApprovalData,
  WalletCallsRequest,
  WalletCallsClaimEvidence,
  WalletCallsResponder,
  Eip7702RevokeRequest
} from './types'

import { ActionType } from '../transaction/actions'
import { ApprovalType } from '../../resources/constants'
import { accountNS } from '../../resources/domain/account'
import { chainUsesOptimismFees } from '../../resources/utils/chains'
import {
  MAX_UINT256,
  normalizeTransactionQuantities,
  parseRpcQuantity,
  toRpcQuantity
} from '../../resources/domain/transaction/quantity'
import {
  getReplacementStatus,
  replacementFees,
  type ReplacementFeeMarket
} from '../../resources/domain/transaction/replacement'
import { parseTokenBaseUnitAmount } from '../../resources/domain/token/amount'
import type { PreparedWalletCallExecutionSnapshot } from '../provider/walletCallPreparedExecution'
import type { PreparedWalletCallBatch } from '../provider/walletCallPreparation'
import type { WalletCallsSimulationResult } from '../transaction/simulation'
import {
  assertEip7702RevokeEvidenceStable,
  inspectEip7702RevokePreflight,
  prepareSoftwareEip7702Revoke,
  signSoftwareEip7702Revoke,
  verifyEip7702RevocationResult,
  type Eip7702RevokeEvidence,
  type Eip7702RevokePreflight,
  type SoftwareEip7702RevokeSigner
} from '../eip7702'
import { EIP7702_REVOKE_INTRINSIC_GAS } from '../transaction/eip7702'
import { isRecoverableAccountCodeEvidenceError } from '../transaction/simulation'
import { parseAccountCode, type ParsedAccountCode } from '../../resources/domain/account/code'
import { recordRequestActivity } from '../activity'
import operationLifecycleLedger from '../operationLifecycle'
import operationLifecycleRuntime from '../operationLifecycle/runtime'
import { operationLifecycleRpc } from '../operationLifecycle/rpc'
import { publishOperationLifecycleObservation } from '../operationLifecycle/events'
import type { OperationLifecycle } from '../store/state/types/operationLifecycle'
import { MAX_OPERATION_LIFECYCLE_AGE_MS } from '../store/state/types/operationLifecycle'
import recentRecipientsRuntime from '../recentRecipients/runtime'
import { fingerprintOutboundAddresses, transactionOutboundTargets } from '../addressSafety'
import type { OutboundAddressFingerprint } from '../store/state/types/outboundAddressMemory'
import {
  isTransactionFundingError,
  TransactionFundingError,
  TRANSACTION_FUNDING_UNAVAILABLE,
  type WalletCallFundingError
} from '../../resources/domain/transaction/funding'
import { WREN_DEPLOY_ORIGIN, originIdForName } from '../../resources/domain/origin'

const MAX_FEE_PER_GAS = 9_999n * 1_000_000_000n
const MAX_GAS_LIMIT = 12_500_000n
const EIP7702_REVOKE_GAS_LIMIT = 50_000n
const EIP7702_RPC_TIMEOUT_MS = 30_000
const EIP7702_CONFIRMATIONS = 12
const EIP7702_MONITOR_INTERVAL_MS = 15_000
const EIP7702_SUBMISSION_UNCLEAR_NOTICE = 'Submission status unclear'
const EIP7702_SUBMISSION_UNCLEAR_DETAIL =
  'Wren is monitoring the expected transaction hash, and this account’s request queue is paused until its status is known.'

export type TransactionSubmissionContext = Readonly<{
  handlerId: string
  activityId: string
  account: string
  origin: string
  chainId: number
  nonce: string
  replacementOf?: string
  deployment?: NonNullable<NonNullable<OperationLifecycle['transaction']>['deployment']>
  recentRecipient?: string
  outboundFingerprints: readonly OutboundAddressFingerprint[]
}>

class Eip7702EligibilityError extends Error {
  constructor(
    readonly status: Exclude<Eip7702RevocationEligibility['status'], 'eligible'>,
    message: string
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTransactionReceipt(value: unknown): value is TransactionReceipt {
  return (
    isRecord(value) &&
    parseRpcQuantity(value['gasUsed']) !== undefined &&
    parseRpcQuantity(value['blockNumber']) !== undefined &&
    parseRpcQuantity(value['status']) !== undefined
  )
}

function toTransactionsByLayer(requests: Record<string, AccountRequest>, chainId?: number) {
  return Object.entries(requests)
    .filter(([_, req]) => req.type === 'transaction')
    .reduce(
      ({ l1Transactions, l2Transactions }, [id, req]) => {
        const txRequest = req as TransactionRequest
        if (
          !txRequest.locked &&
          txRequest.status === undefined &&
          !txRequest.feesUpdatedByUser &&
          txRequest.data.gasFeesSource === GasFeesSource.Frame &&
          (!chainId || parseInt(txRequest.data.chainId, 16) === chainId)
        ) {
          l1Transactions.push([id, txRequest])
        }

        if (
          chainUsesOptimismFees(parseInt(txRequest.data.chainId, 16)) &&
          (!chainId || chainId === 1 || parseInt(txRequest.data.chainId, 16) === chainId)
        ) {
          l2Transactions.push([id, txRequest])
        }

        return { l1Transactions, l2Transactions }
      },
      { l1Transactions: [] as RequestWithId[], l2Transactions: [] as RequestWithId[] }
    )
}

const transactionRequests = (account: FrameAccount) =>
  Object.values(account.requests).filter(isTransactionRequest)

const frameOriginId = uuidv5('frame-internal', uuidv5.DNS)

const storeApi = {
  getAccounts: function () {
    return (store('main.accounts') || {}) as Record<string, Account>
  },
  getAccount: function (id: string) {
    return (store('main.accounts', id) || {}) as Account
  },
  getSigners: function () {
    return Object.values(store('main.signers') || {})
  }
}

export {
  RequestMode,
  AccountRequest,
  AccessRequest,
  TransactionRequest,
  SignTypedDataRequest,
  AddChainRequest,
  SwitchChainRequest,
  AddTokenRequest,
  WalletCallsClaimEvidence,
  WalletCallsRequest,
  Eip7702RevokeRequest
} from './types'

type Eip7702RevocationEligibilityBase = Readonly<{
  account: string
  chainId: number
}>

export type Eip7702RevocationEligibility = Eip7702RevocationEligibilityBase &
  Readonly<
    | { status: 'eligible'; source: 'eth_getCode'; delegate: string; codeHash: string }
    | { status: 'not-delegated' | 'unavailable' | 'unsupported-signer' | 'disconnected' }
  >

export type AccountExecutionState = Readonly<{ account: string; chainId: number }> &
  Readonly<({ source: 'eth_getCode' } & ParsedAccountCode) | { status: 'disconnected' | 'unavailable' }>

export type Eip7702RevocationRequestReference = Readonly<{
  handlerId: string
  account: string
  type: 'eip7702Revoke'
}>

type Eip7702Admission = Readonly<{
  account: FrameAccount
  signer: SoftwareEip7702RevokeSigner
  signerIndex: number
  chainId: number
  preflight: Eip7702RevokePreflight
  evidence: Eip7702RevokeEvidence
  fees: Eip7702RevokeRequest['fees']
}>

type Eip7702Block = Readonly<{
  number: string
  hash: string
}>

type RequestWithId = [string, TransactionRequest]

type PendingNonceAdjustment = {
  account: FrameAccount
  request: TransactionRequest
  adjustments: Array<-1 | 1>
}

const CONFIRMED_TRANSACTION_REVIEW_DWELL_MS = 4000
const CONFIRMED_DEPLOYMENT_REVIEW_DWELL_MS = 30_000
const CONFIRMED_TRANSACTION_RETENTION_MS = 60_000
const contractAddressFromReceipt = (receipt?: TransactionReceipt) =>
  typeof receipt?.['contractAddress'] === 'string' ? receipt['contractAddress'] : undefined

export class Accounts extends EventEmitter {
  _current: string
  accounts: Record<string, FrameAccount>

  private readonly dataScanner: DataScanner
  private readonly pendingNonceAdjustments = new Map<string, PendingNonceAdjustment>()
  private readonly eip7702MonitorTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly transactionReviewDismissTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly transactionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly eip7702Admissions = new Set<string>()
  private readonly replacementAdmissions = new Set<string>()
  private readonly removeOperationLifecycleObserver: () => void

  constructor() {
    super()

    this.accounts = Object.entries(storeApi.getAccounts()).reduce(
      (accounts, [id, account]) => {
        accounts[id] = new FrameAccount(JSON.parse(JSON.stringify(account)), this)

        return accounts
      },
      {} as Record<string, FrameAccount>
    )

    this._current = Object.values(this.accounts).find((acct) => acct.active)?.id || ''

    this.dataScanner = ExternalDataScanner()
    this.removeOperationLifecycleObserver = operationLifecycleRuntime.observe((observation) =>
      this.observeOperationLifecycle(observation.current, observation.confirmations, observation.receipt)
    )
  }

  get(id: string) {
    return this.accounts[id] && this.accounts[id].summary()
  }

  private getTransactionRequest(account: FrameAccount, id: string): TransactionRequest {
    return account.getRequest(id)
  }

  private persistOperationLifecycle(operation: OperationLifecycle) {
    try {
      return operationLifecycleLedger.put(operation, operation.updatedAt)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Operation lifecycle limit reached') throw error
      if (!operationLifecycleLedger.evictOldestHandledTerminal(operation.updatedAt)) throw error
      return operationLifecycleLedger.put(operation, operation.updatedAt)
    }
  }

  private transactionSubmissionContextFor(
    handlerId: string,
    request: TransactionRequest
  ): TransactionSubmissionContext | undefined {
    const activityId = request.activityId
    const chainId = parseRpcQuantity(request.data.chainId)
    const nonce = parseRpcQuantity(request.data.nonce)
    if (
      !activityId ||
      chainId === undefined ||
      chainId <= 0n ||
      chainId > BigInt(Number.MAX_SAFE_INTEGER) ||
      nonce === undefined
    ) {
      return undefined
    }
    let outboundFingerprints: readonly OutboundAddressFingerprint[]
    try {
      outboundFingerprints = Object.freeze(
        fingerprintOutboundAddresses(store('main.instanceId'), transactionOutboundTargets(request)).map(
          (fingerprint) => Object.freeze(fingerprint)
        )
      )
    } catch {
      return undefined
    }
    return Object.freeze({
      handlerId,
      activityId,
      account: request.account.toLowerCase(),
      origin: request.origin,
      chainId: Number(chainId),
      nonce: toRpcQuantity(nonce),
      ...(request.replacement ? { replacementOf: request.replacement.originalActivityId } : {}),
      ...(request.deployment
        ? {
            deployment: Object.freeze({
              version: 1 as const,
              inspectionId: request.deployment.inspectionId,
              initcodeHash: request.deployment.initcodeHash,
              initcodeBytes: request.deployment.initcodeBytes,
              value: request.deployment.value
            })
          }
        : {}),
      ...(request.recentRecipient && store('main.rememberRecentRecipients') === true
        ? { recentRecipient: request.recentRecipient.address.toLowerCase() }
        : {}),
      outboundFingerprints
    })
  }

  transactionSubmissionContext(
    handlerId: string,
    accountId?: string
  ): TransactionSubmissionContext | undefined {
    let currentAccount: FrameAccount | undefined
    try {
      currentAccount = this.requestAccount(handlerId, accountId)
    } catch {
      return undefined
    }
    const request = currentAccount?.getRequest<TransactionRequest>(handlerId)
    return request?.type === 'transaction' && request.status === RequestStatus.Sending
      ? this.transactionSubmissionContextFor(handlerId, request)
      : undefined
  }

  private operationForTransaction(context: TransactionSubmissionContext, hash: string): OperationLifecycle {
    const now = Date.now()
    return {
      id: context.activityId,
      kind: 'transaction',
      account: context.account,
      origin: context.origin,
      chainId: context.chainId,
      state: 'submitted',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MAX_OPERATION_LIFECYCLE_AGE_MS,
      visibleInActivity: true,
      notification: {},
      transaction: {
        hash: hash.toLowerCase(),
        nonce: context.nonce,
        ...(context.replacementOf ? { replacementOf: context.replacementOf } : {}),
        ...(context.deployment ? { deployment: context.deployment } : {})
      }
    }
  }

  private operationForEip7702(request: Eip7702RevokeRequest, hash: string): OperationLifecycle {
    const now = Date.now()
    if (!request.activityId) throw new Error('EIP-7702 revocation is missing its durable activity identity')
    const chainId = parseRpcQuantity(request.chainId)
    const nonce = parseRpcQuantity(request.evidence.latestNonce)
    if (chainId === undefined || chainId <= 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('EIP-7702 revocation is missing its durable chain identity')
    }
    if (nonce === undefined) throw new Error('EIP-7702 revocation is missing its durable nonce')
    return {
      id: request.activityId,
      kind: 'eip7702Revoke',
      account: request.account.toLowerCase(),
      origin: request.origin,
      chainId: Number(chainId),
      state: 'submitted',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MAX_OPERATION_LIFECYCLE_AGE_MS,
      visibleInActivity: true,
      notification: {},
      eip7702Revoke: {
        hash: hash.toLowerCase(),
        expectedFinalNonce: toRpcQuantity(nonce + 2n)
      }
    }
  }

  private updateEip7702Lifecycle(
    request: Eip7702RevokeRequest,
    state: OperationLifecycle['state'],
    receipt?: TransactionReceipt
  ) {
    if (!request.activityId) return
    const current = operationLifecycleLedger.get(request.activityId)
    if (!current || current.kind !== 'eip7702Revoke') return
    const now = Date.now()
    const blockHash = receipt?.['blockHash']
    const transactionHash = receipt?.['transactionHash']
    const status =
      receipt?.status === '0x0' ? ('0x0' as const) : receipt?.status === '0x1' ? ('0x1' as const) : undefined
    const persistedReceipt =
      receipt && typeof blockHash === 'string' && typeof transactionHash === 'string' && status
        ? {
            transactionHash: transactionHash.toLowerCase(),
            blockHash: blockHash.toLowerCase(),
            blockNumber: receipt.blockNumber,
            status
          }
        : undefined
    const { receipt: _receipt, ...withoutReceipt } = current
    const saved = this.persistOperationLifecycle({
      ...withoutReceipt,
      state,
      updatedAt: now,
      ...(persistedReceipt ? { receipt: persistedReceipt } : {})
    })
    publishOperationLifecycleObservation({
      previous: current,
      current: saved,
      ...(receipt ? { receipt } : {}),
      pendingEvidence: state === 'confirming' && receipt !== undefined
    })
  }

  private clearEip7702PendingEvidence(request: Eip7702RevokeRequest) {
    if (!request.activityId) return
    const current = operationLifecycleLedger
      .listStored()
      .find(({ id, kind }) => id === request.activityId && kind === 'eip7702Revoke')
    if (!current) return
    publishOperationLifecycleObservation({ previous: current, current, pendingEvidence: false })
  }

  private expireEip7702Lifecycle(request: Eip7702RevokeRequest, now = Date.now()) {
    if (!request.activityId) return false
    const previous = operationLifecycleLedger.listStored().find(({ id }) => id === request.activityId)
    if (
      !previous ||
      previous.kind !== 'eip7702Revoke' ||
      previous.expiresAt > now ||
      !['submitted', 'confirming', 'reorged'].includes(previous.state)
    ) {
      return false
    }

    operationLifecycleRuntime.release(previous.id)
    const current = operationLifecycleLedger.put(
      {
        ...previous,
        state: previous.receipt ? 'clearance-unverified' : 'stopped',
        updatedAt: previous.expiresAt
      },
      -1
    )
    publishOperationLifecycleObservation({ previous, current })
    return true
  }

  isLifecycleActivityManaged(request: AnyAccountRequest) {
    return Boolean(
      request.activityId &&
      (request.type === 'transaction' ||
        request.type === 'walletCalls' ||
        request.type === 'eip7702Revoke') &&
      operationLifecycleLedger.listStored().some(({ id }) => id === request.activityId)
    )
  }

  confirmedDeploymentOperation(handlerId: string, accountId: string) {
    const account = this.requestAccount(handlerId, accountId)
    const request = account?.getRequest<TransactionRequest>(handlerId)
    const receiptContractAddress = contractAddressFromReceipt(request?.tx?.receipt)
    if (
      !request ||
      request.type !== 'transaction' ||
      request.status !== RequestStatus.Confirmed ||
      request.origin !== originIdForName(WREN_DEPLOY_ORIGIN) ||
      !request.deployment ||
      !request.activityId ||
      !request.tx?.hash ||
      !receiptContractAddress
    ) {
      return undefined
    }

    const operation = operationLifecycleLedger.get(request.activityId)
    if (
      !operation ||
      operation.kind !== 'transaction' ||
      operation.state !== 'confirmed' ||
      operation.origin !== request.origin ||
      !operation.transaction?.deployment ||
      operation.transaction.hash !== request.tx.hash.toLowerCase() ||
      operation.receipt?.status !== '0x1' ||
      operation.receipt.contractAddress !== receiptContractAddress.toLowerCase()
    ) {
      return undefined
    }

    return Object.freeze({
      operationId: operation.id,
      chainId: operation.chainId,
      address: operation.receipt.contractAddress
    })
  }

  releaseOperationLifecycleAdmission(activityId: string) {
    operationLifecycleLedger.releaseReservation(activityId)
  }

  private reserveOperationLifecycleAdmission(activityId: string, now = Date.now()) {
    try {
      operationLifecycleLedger.reserve(activityId, now)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Operation lifecycle limit reached') throw error
      if (!operationLifecycleLedger.evictOldestHandledTerminal(now)) throw error
      operationLifecycleLedger.reserve(activityId, now)
    }
  }

  private observeOperationLifecycle(
    operation: OperationLifecycle,
    confirmations = 0,
    receipt?: Readonly<Record<string, unknown>>
  ) {
    const account = this.accounts[operation.account]
    if (!account) return
    const request = Object.values(account.requests).find(
      (candidate) => candidate.activityId === operation.id && candidate.type === operation.kind
    )
    if (!request || (request.type !== 'transaction' && request.type !== 'eip7702Revoke')) return

    const hash = operation.transaction?.hash ?? operation.eip7702Revoke?.hash
    if (!hash) return
    const liveReceipt = receipt && isTransactionReceipt(receipt) ? receipt : request.tx?.receipt
    const activityClearedAt = store('main.activityClearedAt') || 0
    const recordObservedActivity = (outcome: Parameters<typeof recordRequestActivity>[1]) => {
      if (
        activityClearedAt <= 0 ||
        operation.createdAt >= activityClearedAt ||
        operation.updatedAt > activityClearedAt
      ) {
        recordRequestActivity(request, outcome)
      }
    }
    request.tx = {
      hash,
      confirmations,
      ...(liveReceipt ? { receipt: liveReceipt } : {})
    }

    if (
      request.type === 'transaction' &&
      request.submission?.status === 'unconfirmed' &&
      ['confirming', 'confirmed', 'failed'].includes(operation.state)
    ) {
      delete request.submission
    }

    if (operation.state === 'reorged' || operation.state === 'submitted') {
      if (request.type === 'transaction') {
        this.cancelTransactionTerminalTimers(account.id, request.handlerId)
      }
      delete request.completed
      delete request.tx.receipt
      request.tx.confirmations = 0
      request.status = RequestStatus.Verifying
      if (request.type === 'transaction') request.mode = RequestMode.Monitor
      request.notice =
        operation.state === 'reorged'
          ? 'Rechecking after chain reorganization'
          : request.type === 'transaction' && request.submission?.status === 'unconfirmed'
            ? 'Submission unconfirmed; checking network'
            : 'Verifying'
    } else if (operation.state === 'confirming') {
      request.status = RequestStatus.Confirming
      if (request.type === 'transaction') request.mode = RequestMode.Monitor
      request.notice = request.type === 'eip7702Revoke' ? 'Included; confirming' : 'Confirming'
    } else if (operation.state === 'confirmed') {
      const firstConfirmation = request.status !== RequestStatus.Confirmed || !request.completed
      request.status = RequestStatus.Confirmed
      request.notice = 'Confirmed'
      if (firstConfirmation) request.completed = operation.updatedAt
      if (firstConfirmation) recordObservedActivity('confirmed')
      if (request.type === 'transaction') {
        request.mode = RequestMode.Monitor
        this.scheduleConfirmedTransactionHandoff(account, request)
      }
    } else if (operation.state === 'verified-clearance' && request.type === 'eip7702Revoke') {
      request.status = RequestStatus.Confirmed
      request.notice = 'Delegation removed'
      request.completed = operation.updatedAt
      request.result = Object.freeze({
        receiptStatus: operation.receipt?.status === '0x1' ? 'success' : 'failed',
        revocationStatus: 'cleared',
        reason: 'code-cleared'
      })
      recordObservedActivity('verified-clearance')
    } else if (operation.state === 'failed') {
      request.status = RequestStatus.Error
      request.notice = request.type === 'eip7702Revoke' ? 'Delegation remains' : 'Failed'
      request.completed = operation.updatedAt
      recordObservedActivity('failed')
    } else if (operation.state === 'replaced' && request.type === 'transaction') {
      request.status = RequestStatus.Error
      request.notice = 'Dropped'
      request.completed = operation.updatedAt
      recordObservedActivity('replaced')
    } else if (operation.state === 'stopped') {
      request.status = RequestStatus.Error
      request.notice = 'Monitoring stopped'
      request.completed = operation.updatedAt
    } else if (operation.state === 'clearance-unverified' && request.type === 'eip7702Revoke') {
      request.status = RequestStatus.Error
      request.notice = 'Clearance not verified'
      request.completed = operation.updatedAt
      request.result = Object.freeze({
        receiptStatus: operation.receipt?.status === '0x1' ? 'success' : 'failed',
        revocationStatus: 'unavailable',
        reason: 'code-unavailable'
      })
      recordObservedActivity('clearance-unverified')
    }
    account.update()
    if (
      request.type === 'transaction' &&
      request.mode === RequestMode.Monitor &&
      ['submitted', 'reorged', 'confirming'].includes(operation.state)
    ) {
      account.releaseRequestReviewIfQueued(request.handlerId)
    }
  }

  private transactionTerminalTimerKey(accountId: string, handlerId: string) {
    return `${accountId.toLowerCase()}:${handlerId}`
  }

  cancelTransactionTerminalTimers(accountId: string, handlerId: string) {
    const key = this.transactionTerminalTimerKey(accountId, handlerId)
    const dismissTimer = this.transactionReviewDismissTimers.get(key)
    const cleanupTimer = this.transactionCleanupTimers.get(key)
    if (dismissTimer) clearTimeout(dismissTimer)
    if (cleanupTimer) clearTimeout(cleanupTimer)
    this.transactionReviewDismissTimers.delete(key)
    this.transactionCleanupTimers.delete(key)
  }

  private scheduleConfirmedTransactionHandoff(account: FrameAccount, request: TransactionRequest) {
    const key = this.transactionTerminalTimerKey(account.id, request.handlerId)
    const completedAt = request.completed || Date.now()
    const reviewDwell =
      request.origin === originIdForName(WREN_DEPLOY_ORIGIN) &&
      request.deployment &&
      contractAddressFromReceipt(request.tx?.receipt)
        ? CONFIRMED_DEPLOYMENT_REVIEW_DWELL_MS
        : CONFIRMED_TRANSACTION_REVIEW_DWELL_MS

    if (!this.transactionReviewDismissTimers.has(key)) {
      const dismissTimer = setTimeout(() => {
        this.transactionReviewDismissTimers.delete(key)
        const current = this.accounts[account.address]?.getRequest<TransactionRequest>(request.handlerId)
        if (current?.type === 'transaction' && current.status === RequestStatus.Confirmed) {
          account.releaseRequestReview(request.handlerId)
        }
      }, reviewDwell)
      dismissTimer.unref?.()
      this.transactionReviewDismissTimers.set(key, dismissTimer)
    }

    if (!this.transactionCleanupTimers.has(key)) {
      const cleanupDelay = Math.max(0, completedAt + CONFIRMED_TRANSACTION_RETENTION_MS - Date.now())
      const cleanupTimer = setTimeout(() => {
        this.transactionCleanupTimers.delete(key)
        const current = this.accounts[account.address]?.getRequest<TransactionRequest>(request.handlerId)
        if (
          current?.type === 'transaction' &&
          current.status === RequestStatus.Confirmed &&
          current.completed === completedAt
        ) {
          account.clearRequest(request.handlerId, 'confirmed')
        }
      }, cleanupDelay)
      cleanupTimer.unref?.()
      this.transactionCleanupTimers.set(key, cleanupTimer)
    }
  }

  private nonceAdjustmentKey(account: FrameAccount, handlerId: string) {
    return `${account.id}:${handlerId}`
  }

  clearPendingNonceAdjustment(account: FrameAccount, handlerId: string) {
    this.pendingNonceAdjustments.delete(this.nonceAdjustmentKey(account, handlerId))
  }

  private restoreRequestedNonce(request: TransactionRequest) {
    request.data = { ...request.data }
    const requestedNonce = request.payload.params?.[0]?.nonce
    if (requestedNonce) {
      request.data.nonce = normalizeTransactionQuantities({ nonce: requestedNonce }).nonce
    } else delete request.data.nonce
  }

  private clearPendingNonceAdjustmentsForAccount(account: FrameAccount) {
    this.pendingNonceAdjustments.forEach((pending, key) => {
      if (pending.account === account) this.pendingNonceAdjustments.delete(key)
    })
  }

  private mutableTransactionRequest(account: FrameAccount, handlerId: string) {
    const request = account.getRequest<TransactionRequest>(handlerId)
    if (!request || request.type !== 'transaction' || request.locked || request.status !== undefined) {
      return undefined
    }
    return request
  }

  async add(address: Address, name = '', options = {}, cb: Callback<FrameAccount> = () => {}) {
    if (!address) return cb(new Error('No address, will not add account'))
    address = address.toLowerCase()
    const pendingAccountRemovals = store('main.pendingAccountRemovals') || []
    const pendingSignerRemovals = store('main.pendingSignerRemovals') || {}
    const pendingAddresses = new Set([
      ...pendingAccountRemovals.map((candidate: string) => candidate.toLowerCase()),
      ...Object.values(pendingSignerRemovals).flatMap((removal) =>
        Array.isArray(removal?.addresses)
          ? removal.addresses.map((candidate: string) => candidate.toLowerCase())
          : []
      )
    ])
    if (pendingAddresses.has(address)) {
      return cb(new Error('Account removal is still being completed'))
    }

    let account = this.accounts[address]
    if (!account) {
      log.info('Account not found, creating account')

      const created = 'new:' + Date.now()
      const accountMetaId = uuidv5(address, accountNS)
      const accountMeta = store('main.accountsMeta', accountMetaId) || { name }
      const createdAccount = new FrameAccount(
        { address, name: accountMeta.name, created, options, active: false },
        this
      )
      this.accounts[address] = createdAccount
      account = createdAccount
      createdAccount.update()
    }

    return cb(null, account)
  }

  rename(id: string, name: string) {
    const frameAccount = this.accounts[id]
    if (!frameAccount) throw new Error(`Could not find account ${id}`)
    frameAccount.rename(name)
    const account = frameAccount.summary()
    this.update(account)
  }

  update(account: Account) {
    if (!this.accounts || this.accounts[account.id]) {
      requireStoreAction('updateAccount')(account)
    }
  }

  current() {
    return this._current ? this.accounts[this._current] : null
  }

  private eip7702OperationKey(accountId: string, handlerId: string) {
    return `${accountId.toLowerCase()}:${handlerId}`
  }

  cancelEip7702Operation(accountId: string, handlerId: string) {
    const key = this.eip7702OperationKey(accountId, handlerId)
    const timer = this.eip7702MonitorTimers.get(key)
    if (timer) clearTimeout(timer)
    this.eip7702MonitorTimers.delete(key)

    const request = this.accounts[accountId.toLowerCase()]?.getRequest<Eip7702RevokeRequest>(handlerId)
    if (request?.type === 'eip7702Revoke') {
      request.operationVersion += 1
      if (request.activityId) operationLifecycleRuntime.release(request.activityId)
    }
  }

  private eip7702ChainConnected(chainId: number) {
    const network = store('main.networks.ethereum', chainId)
    const connection = provider.connection.connections?.ethereum?.[chainId]
    const active = connection?.active || connection?.primary || connection?.secondary
    return Boolean(network && network.on !== false && connection?.chainConfig && active?.connected)
  }

  private sendEip7702Rpc<T>(chainId: number, method: string, params: unknown[] = []) {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error, value?: T) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(value as T)
      }
      const timeout = setTimeout(
        () => finish(new Error(`Configured RPC timed out during ${method}`)),
        EIP7702_RPC_TIMEOUT_MS
      )
      timeout.unref?.()

      try {
        provider.connection.send(
          { id: 1, jsonrpc: '2.0', method, params },
          (response: RPCResponsePayload) => {
            if (response?.error)
              return finish(new Error(response.error.message || `Configured RPC ${method} failed`))
            finish(undefined, response?.result as T)
          },
          { type: 'ethereum', id: chainId }
        )
      } catch (error) {
        finish(error instanceof Error ? error : new Error(`Configured RPC ${method} failed`))
      }
    })
  }

  private eip7702Signer(account: FrameAccount) {
    const signer = account.getSigner() as (Signer & Partial<SoftwareEip7702RevokeSigner>) | undefined
    if (
      !signer ||
      (signer.type !== 'ring' && signer.type !== 'seed') ||
      !isSignerReady(signer) ||
      typeof signer.signEip7702Revoke !== 'function'
    ) {
      return undefined
    }
    const signerIndex = signer.addresses.findIndex((address) => address.toLowerCase() === account.id)
    if (signerIndex < 0) return undefined
    return { signer: signer as unknown as SoftwareEip7702RevokeSigner, signerIndex }
  }

  private eip7702FeeSnapshot(chainId: number): Eip7702RevokeRequest['fees'] {
    const feeMarket = store('main.networksMeta', 'ethereum', chainId, 'gas.price.fees') || {}
    const maxBaseFeePerGas = parseRpcQuantity(feeMarket.maxBaseFeePerGas)
    const maxPriorityFeePerGas = parseRpcQuantity(feeMarket.maxPriorityFeePerGas)
    if (
      maxBaseFeePerGas === undefined ||
      maxPriorityFeePerGas === undefined ||
      maxBaseFeePerGas === 0n ||
      maxPriorityFeePerGas > MAX_FEE_PER_GAS
    ) {
      throw new Error(`Network ${chainId} has no current EIP-1559 fee estimate`)
    }
    const maxFeePerGas = maxBaseFeePerGas + maxPriorityFeePerGas
    const chainFeeCap = maxFee({ chainId: toRpcQuantity(BigInt(chainId)) } as TransactionData)
    if (maxFeePerGas > MAX_FEE_PER_GAS || EIP7702_REVOKE_GAS_LIMIT * maxFeePerGas > chainFeeCap) {
      throw new Error('Current EIP-7702 fee estimate exceeds the safety cap')
    }
    return {
      gasLimit: toRpcQuantity(EIP7702_REVOKE_GAS_LIMIT),
      maxFeePerGas: toRpcQuantity(maxFeePerGas),
      maxPriorityFeePerGas: toRpcQuantity(maxPriorityFeePerGas),
      maxFee: toRpcQuantity(EIP7702_REVOKE_GAS_LIMIT * maxFeePerGas)
    }
  }

  private async eip7702Preflight(account: FrameAccount, chainId: number) {
    const [authorityCode, latestNonce, pendingNonce] = await Promise.all([
      this.sendEip7702Rpc<unknown>(chainId, 'eth_getCode', [account.id, 'latest']),
      this.sendEip7702Rpc<unknown>(chainId, 'eth_getTransactionCount', [account.id, 'latest']),
      this.sendEip7702Rpc<unknown>(chainId, 'eth_getTransactionCount', [account.id, 'pending'])
    ])
    const preflight = Object.freeze({ authorityCode, latestNonce, pendingNonce })
    return Object.freeze({ preflight, evidence: inspectEip7702RevokePreflight(account.id, preflight) })
  }

  private assertEip7702ReadinessStillCurrent(
    account: FrameAccount,
    chainId: number,
    requireAdmissionReservation: boolean
  ) {
    if (this.current() !== account || this.accounts[account.id] !== account) {
      throw new Eip7702EligibilityError('unavailable', 'EIP-7702 revocation requires the selected account')
    }
    const signerMatch = this.eip7702Signer(account)
    if (!signerMatch) {
      throw new Eip7702EligibilityError(
        'unsupported-signer',
        'EIP-7702 revocation requires an unlocked Ring or Seed signer'
      )
    }
    if (!this.eip7702ChainConnected(chainId)) {
      throw new Eip7702EligibilityError('disconnected', `Chain ${chainId} is disconnected`)
    }
    if (Object.values(account.requests).some((request) => request.type === 'eip7702Revoke')) {
      throw new Eip7702EligibilityError(
        'unavailable',
        'An EIP-7702 revocation is already active for this account'
      )
    }
    if (requireAdmissionReservation && !this.eip7702Admissions.has(account.id)) {
      throw new Eip7702EligibilityError('unavailable', 'EIP-7702 revocation admission expired')
    }
    if (!requireAdmissionReservation && this.eip7702Admissions.has(account.id)) {
      throw new Eip7702EligibilityError(
        'unavailable',
        'An EIP-7702 revocation is already being prepared for this account'
      )
    }
    return signerMatch
  }

  private async eip7702Readiness(
    accountId: string,
    chainId: number,
    requireAdmissionReservation = false
  ): Promise<Eip7702Admission> {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Eip7702EligibilityError('unavailable', 'Invalid EIP-7702 chain')
    }
    const account = this.current()
    if (!account || account.id !== accountId.toLowerCase()) {
      throw new Eip7702EligibilityError('unavailable', 'EIP-7702 revocation requires the selected account')
    }
    const signerMatch = this.eip7702Signer(account)
    if (!signerMatch) {
      throw new Eip7702EligibilityError(
        'unsupported-signer',
        'EIP-7702 revocation requires an unlocked Ring or Seed signer'
      )
    }
    if (!this.eip7702ChainConnected(chainId)) {
      throw new Eip7702EligibilityError('disconnected', `Chain ${chainId} is disconnected`)
    }
    if (Object.values(account.requests).some((request) => request.type === 'eip7702Revoke')) {
      throw new Eip7702EligibilityError(
        'unavailable',
        'An EIP-7702 revocation is already active for this account'
      )
    }
    if (!requireAdmissionReservation && this.eip7702Admissions.has(account.id)) {
      throw new Eip7702EligibilityError(
        'unavailable',
        'An EIP-7702 revocation is already being prepared for this account'
      )
    }

    let fees: Eip7702RevokeRequest['fees']
    let preflight: Eip7702RevokePreflight
    let evidence: Eip7702RevokeEvidence
    try {
      fees = this.eip7702FeeSnapshot(chainId)
      const inspected = await this.eip7702Preflight(account, chainId)
      preflight = inspected.preflight
      evidence = inspected.evidence
    } catch (error) {
      const message = error instanceof Error ? error.message : 'EIP-7702 evidence unavailable'
      const status = message === 'EIP-7702 authority is not delegated' ? 'not-delegated' : 'unavailable'
      throw new Eip7702EligibilityError(status, message)
    }
    const currentSignerMatch = this.assertEip7702ReadinessStillCurrent(
      account,
      chainId,
      requireAdmissionReservation
    )
    const input = {
      authority: account.id,
      chainId: BigInt(chainId),
      nonce: BigInt(evidence.latestNonce),
      gasLimit: BigInt(fees.gasLimit),
      maxFeePerGas: BigInt(fees.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(fees.maxPriorityFeePerGas)
    }
    prepareSoftwareEip7702Revoke(currentSignerMatch.signer, currentSignerMatch.signerIndex, input, preflight)
    return Object.freeze({ account, chainId, preflight, evidence, fees, ...currentSignerMatch })
  }

  private async eip7702Admission(accountId: string, chainId: number): Promise<Eip7702Admission> {
    return this.eip7702Readiness(accountId, chainId, true)
  }

  async getEip7702RevocationEligibility(
    accountId: string,
    chainId: number
  ): Promise<Eip7702RevocationEligibility> {
    const base = { account: accountId.toLowerCase(), chainId }
    try {
      const { evidence } = await this.eip7702Readiness(accountId, chainId)
      return Object.freeze({
        ...base,
        status: 'eligible',
        source: evidence.source,
        delegate: evidence.delegate,
        codeHash: evidence.codeHash
      })
    } catch (error) {
      const status = error instanceof Eip7702EligibilityError ? error.status : 'unavailable'
      return Object.freeze({ ...base, status })
    }
  }

  async getAccountExecutionState(accountId: string, chainId: number): Promise<AccountExecutionState> {
    const account = accountId.toLowerCase()
    const base = { account, chainId }
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !this.accounts[account]) {
      return Object.freeze({ ...base, status: 'unavailable' })
    }
    if (!this.eip7702ChainConnected(chainId)) {
      return Object.freeze({ ...base, status: 'disconnected' })
    }
    try {
      const code = await this.sendEip7702Rpc<unknown>(chainId, 'eth_getCode', [account, 'latest'])
      const execution = parseAccountCode(code)
      return execution
        ? Object.freeze({ ...base, source: 'eth_getCode' as const, ...execution })
        : Object.freeze({ ...base, status: 'unavailable' as const })
    } catch {
      return Object.freeze({ ...base, status: 'unavailable' })
    }
  }

  async requestEip7702Revocation(
    accountId: string,
    chainId: number
  ): Promise<Eip7702RevocationRequestReference> {
    const reservation = accountId.toLowerCase()
    if (this.eip7702Admissions.has(reservation)) {
      throw new Error('An EIP-7702 revocation is already being prepared for this account')
    }
    this.eip7702Admissions.add(reservation)
    try {
      const admission = await this.eip7702Admission(accountId, chainId)
      const handlerId = uuidv4()
      const request: Eip7702RevokeRequest = {
        type: 'eip7702Revoke',
        version: '1',
        handlerId,
        origin: frameOriginId,
        account: admission.account.id,
        payload: {
          id: 1,
          jsonrpc: '2.0',
          method: 'wren_revokeEip7702Delegation',
          params: [admission.account.id, toRpcQuantity(BigInt(chainId))]
        },
        chainId: toRpcQuantity(BigInt(chainId)),
        evidence: admission.evidence,
        fees: { ...admission.fees },
        feesUpdatedByUser: false,
        operationVersion: 0
      }
      this.addRequestForAccount(admission.account.id, request)
      return Object.freeze({ handlerId, account: admission.account.id, type: 'eip7702Revoke' })
    } finally {
      this.eip7702Admissions.delete(reservation)
    }
  }

  private activeEip7702Operation(
    account: FrameAccount,
    request: Eip7702RevokeRequest,
    operationVersion: number
  ) {
    return (
      this.accounts[account.id] === account &&
      account.getRequest<Eip7702RevokeRequest>(request.handlerId) === request &&
      request.operationVersion === operationVersion
    )
  }

  private failEip7702Revocation(
    account: FrameAccount,
    request: Eip7702RevokeRequest,
    operationVersion: number,
    error: unknown
  ) {
    if (!this.activeEip7702Operation(account, request, operationVersion)) return
    const message = error instanceof Error ? error.message : 'EIP-7702 revocation failed'
    request.status = RequestStatus.Error
    request.failureReason =
      message === 'EIP-7702 authority is not delegated'
        ? 'not-delegated'
        : message.includes('changed after review') || message.includes('stable account nonce')
          ? 'evidence-changed'
          : 'unavailable'
    request.notice = message.slice(0, 240)
    request.mode = RequestMode.Monitor
    account.update()
    account.releaseRequestReview(request.handlerId)
    const timer = setTimeout(() => {
      if (this.activeEip7702Operation(account, request, operationVersion)) {
        account.clearRequest(request.handlerId)
      }
    }, 8000)
    timer.unref?.()
    this.eip7702MonitorTimers.set(this.eip7702OperationKey(account.id, request.handlerId), timer)
  }

  approveEip7702Revocation(accountId: string, handlerId: string) {
    const account = this.current()
    if (!account || account.id !== accountId.toLowerCase()) {
      throw new Error('EIP-7702 revocation requires the selected account')
    }
    const request = account.getActiveReviewRequest<Eip7702RevokeRequest>(handlerId)
    if (!request || request.type !== 'eip7702Revoke') throw new Error('Request is waiting for review')
    if (request.status !== undefined || request.locked)
      throw new Error('Request is already pending or complete')
    if (!this.eip7702Signer(account)) {
      throw new Error('EIP-7702 revocation requires an unlocked Ring or Seed signer')
    }

    request.locked = true
    request.status = RequestStatus.Pending
    request.notice = 'Checking delegation'
    request.operationVersion += 1
    const operationVersion = request.operationVersion
    account.update()
    void this.executeEip7702Revocation(account, request, operationVersion).catch((error) => {
      this.failEip7702Revocation(account, request, operationVersion, error)
    })
    return true
  }

  stopEip7702RevocationMonitoring(accountId: string, handlerId: string) {
    const account = this.current()
    if (!account || account.id !== accountId.toLowerCase()) {
      throw new Error('EIP-7702 revocation requires the selected account')
    }
    const request = account.getActiveReviewRequest<Eip7702RevokeRequest>(handlerId)
    if (!request || request.type !== 'eip7702Revoke') throw new Error('Request is no longer active')
    if (
      request.mode !== RequestMode.Monitor ||
      !request.tx?.hash ||
      ![RequestStatus.Verifying, RequestStatus.Confirming].includes(request.status as RequestStatus)
    ) {
      throw new Error('Revocation submission monitoring cannot be stopped')
    }

    if (!this.expireEip7702Lifecycle(request) && request.activityId) {
      const operation = operationLifecycleLedger.listStored().find(({ id }) => id === request.activityId)
      if (operation && ['submitted', 'confirming', 'reorged'].includes(operation.state)) {
        const now = Date.now()
        const current = this.persistOperationLifecycle({ ...operation, state: 'stopped', updatedAt: now })
        publishOperationLifecycleObservation({ previous: operation, current })
      }
    }
    account.clearRequest(request.handlerId)
    return true
  }

  private async executeEip7702Revocation(
    account: FrameAccount,
    request: Eip7702RevokeRequest,
    operationVersion: number
  ) {
    const chainId = Number(BigInt(request.chainId))
    if (!this.eip7702ChainConnected(chainId)) throw new Error(`Chain ${chainId} is disconnected`)
    const signerMatch = this.eip7702Signer(account)
    if (!signerMatch) throw new Error('EIP-7702 revocation requires an unlocked Ring or Seed signer')

    const { preflight, evidence } = await this.eip7702Preflight(account, chainId)
    if (!this.activeEip7702Operation(account, request, operationVersion)) return
    assertEip7702RevokeEvidenceStable(request.evidence, evidence)

    const input = {
      authority: account.id,
      chainId: BigInt(chainId),
      nonce: BigInt(request.evidence.latestNonce),
      gasLimit: BigInt(request.fees.gasLimit),
      maxFeePerGas: BigInt(request.fees.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(request.fees.maxPriorityFeePerGas)
    }
    const signingRequest = prepareSoftwareEip7702Revoke(
      signerMatch.signer,
      signerMatch.signerIndex,
      input,
      preflight
    )
    const signed = await signSoftwareEip7702Revoke(
      signerMatch.signer,
      signerMatch.signerIndex,
      signingRequest,
      preflight
    )
    if (!this.activeEip7702Operation(account, request, operationVersion)) return

    request.status = RequestStatus.Sending
    request.notice = 'Sending'
    request.mode = RequestMode.Monitor
    request.tx = { hash: signed.evidence.transactionHash.toLowerCase(), confirmations: 0 }
    account.update()

    const operation = this.operationForEip7702(request, signed.evidence.transactionHash)
    this.persistOperationLifecycle(operation)
    operationLifecycleRuntime.claim(operation.id)

    let submissionUnconfirmed = false
    try {
      const returnedHash = await this.sendEip7702Rpc<unknown>(chainId, 'eth_sendRawTransaction', [
        signed.rawTransaction
      ])
      if (
        typeof returnedHash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(returnedHash) ||
        returnedHash.toLowerCase() !== signed.evidence.transactionHash.toLowerCase()
      ) {
        submissionUnconfirmed = true
      }
    } catch {
      submissionUnconfirmed = true
    }
    if (!this.activeEip7702Operation(account, request, operationVersion)) return

    request.status = RequestStatus.Verifying
    request.notice = submissionUnconfirmed ? EIP7702_SUBMISSION_UNCLEAR_NOTICE : 'Verifying delegation'
    if (submissionUnconfirmed) {
      request.submission = Object.freeze({
        status: 'unconfirmed',
        detail: EIP7702_SUBMISSION_UNCLEAR_DETAIL
      })
    }
    account.update()
    void this.monitorEip7702Revocation(account, request, operationVersion)
  }

  private parseEip7702Receipt(value: unknown, expectedHash: string): TransactionReceipt | undefined {
    if (value === null || value === undefined) return undefined
    if (!isRecord(value)) throw new Error('Invalid EIP-7702 receipt response')
    const transactionHash = value['transactionHash']
    const blockHash = value['blockHash']
    const blockNumber = value['blockNumber']
    const status = value['status']
    const gasUsed = value['gasUsed']
    if (
      typeof transactionHash !== 'string' ||
      transactionHash.toLowerCase() !== expectedHash.toLowerCase() ||
      typeof blockHash !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(blockHash) ||
      parseRpcQuantity(blockNumber) === undefined ||
      toRpcQuantity(parseRpcQuantity(blockNumber) as bigint) !== blockNumber ||
      parseRpcQuantity(gasUsed) === undefined ||
      toRpcQuantity(parseRpcQuantity(gasUsed) as bigint) !== gasUsed ||
      (status !== '0x0' && status !== '0x1')
    ) {
      throw new Error('Invalid EIP-7702 receipt response')
    }
    return Object.freeze({
      transactionHash: transactionHash.toLowerCase(),
      blockHash: blockHash.toLowerCase(),
      blockNumber,
      gasUsed,
      status
    })
  }

  private parseEip7702Block(value: unknown): Eip7702Block {
    if (!isRecord(value)) throw new Error('Invalid EIP-7702 block response')
    const number = value['number']
    const hash = value['hash']
    const parsedNumber = parseRpcQuantity(number)
    if (
      parsedNumber === undefined ||
      toRpcQuantity(parsedNumber) !== number ||
      typeof hash !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(hash)
    ) {
      throw new Error('Invalid EIP-7702 block response')
    }
    return Object.freeze({ number, hash: hash.toLowerCase() })
  }

  private async monitorEip7702Revocation(
    account: FrameAccount,
    request: Eip7702RevokeRequest,
    operationVersion: number
  ) {
    if (!this.activeEip7702Operation(account, request, operationVersion) || !request.tx) return
    if (this.expireEip7702Lifecycle(request)) {
      if (this.activeEip7702Operation(account, request, operationVersion)) {
        account.releaseRequestReview(request.handlerId)
        account.clearRequest(request.handlerId)
      }
      return
    }
    const chainId = Number(BigInt(request.chainId))
    const key = this.eip7702OperationKey(account.id, request.handlerId)

    try {
      const receiptValue = await this.sendEip7702Rpc<unknown>(chainId, 'eth_getTransactionReceipt', [
        request.tx.hash
      ])
      if (!this.activeEip7702Operation(account, request, operationVersion) || !request.tx) return
      const receipt = this.parseEip7702Receipt(receiptValue, request.tx.hash)
      if (!receipt) {
        if (request.tx.receipt) {
          delete request.tx.receipt
          request.tx.confirmations = 0
          delete request.result
          request.status = RequestStatus.Verifying
          request.notice = 'Rechecking after chain reorganization'
          account.update()
          this.updateEip7702Lifecycle(request, 'reorged')
        } else {
          this.clearEip7702PendingEvidence(request)
        }
        this.scheduleEip7702Monitor(account, request, operationVersion)
        return
      }
      delete request.submission

      const [receiptBlockValue, latestBlockValue] = await Promise.all([
        this.sendEip7702Rpc<unknown>(chainId, 'eth_getBlockByNumber', [receipt.blockNumber, false]),
        this.sendEip7702Rpc<unknown>(chainId, 'eth_getBlockByNumber', ['latest', false])
      ])
      if (!this.activeEip7702Operation(account, request, operationVersion) || !request.tx) return
      const canonicalReceiptBlock = this.parseEip7702Block(receiptBlockValue)
      const latestBlock = this.parseEip7702Block(latestBlockValue)
      if (
        canonicalReceiptBlock.number !== receipt.blockNumber ||
        canonicalReceiptBlock.hash !== receipt['blockHash']
      ) {
        delete request.tx.receipt
        request.tx.confirmations = 0
        delete request.result
        delete request.completed
        request.status = RequestStatus.Verifying
        request.notice = 'Rechecking after chain reorganization'
        account.update()
        this.updateEip7702Lifecycle(request, 'reorged')
        this.scheduleEip7702Monitor(account, request, operationVersion)
        return
      }
      const blockNumber = parseRpcQuantity(latestBlock.number)
      const receiptBlock = parseRpcQuantity(receipt.blockNumber)
      if (blockNumber === undefined || receiptBlock === undefined || blockNumber < receiptBlock) {
        throw new Error('Invalid EIP-7702 confirmation response')
      }

      const authorityCode = await this.sendEip7702Rpc<unknown>(chainId, 'eth_getCode', [
        account.id,
        { blockHash: latestBlock.hash, requireCanonical: true }
      ])
      if (!this.activeEip7702Operation(account, request, operationVersion) || !request.tx) return

      const [confirmedReceiptBlockValue, confirmedLatestBlockValue] = await Promise.all([
        this.sendEip7702Rpc<unknown>(chainId, 'eth_getBlockByNumber', [receipt.blockNumber, false]),
        this.sendEip7702Rpc<unknown>(chainId, 'eth_getBlockByNumber', [latestBlock.number, false])
      ])
      if (!this.activeEip7702Operation(account, request, operationVersion) || !request.tx) return
      const confirmedReceiptBlock = this.parseEip7702Block(confirmedReceiptBlockValue)
      const confirmedLatestBlock = this.parseEip7702Block(confirmedLatestBlockValue)
      if (
        confirmedReceiptBlock.number !== canonicalReceiptBlock.number ||
        confirmedReceiptBlock.hash !== canonicalReceiptBlock.hash ||
        confirmedLatestBlock.number !== latestBlock.number ||
        confirmedLatestBlock.hash !== latestBlock.hash
      ) {
        delete request.tx.receipt
        request.tx.confirmations = 0
        delete request.result
        delete request.completed
        request.status = RequestStatus.Verifying
        request.notice = 'Rechecking after chain reorganization'
        account.update()
        this.updateEip7702Lifecycle(request, 'reorged')
        this.scheduleEip7702Monitor(account, request, operationVersion)
        return
      }

      const result = await verifyEip7702RevocationResult(receipt, async () => authorityCode)
      if (!this.activeEip7702Operation(account, request, operationVersion) || !request.tx) return
      const confirmations = Number(blockNumber - receiptBlock + 1n)
      request.tx = { ...request.tx, receipt, confirmations }
      request.result = Object.freeze({ ...result, checkedAtBlock: toRpcQuantity(blockNumber) })
      request.completed = Date.now()

      if (confirmations < EIP7702_CONFIRMATIONS || result.revocationStatus === 'unavailable') {
        request.status = RequestStatus.Confirming
        request.notice =
          result.revocationStatus === 'cleared'
            ? 'Delegation removed; confirming'
            : result.revocationStatus === 'skipped'
              ? 'Delegation still present; rechecking'
              : 'Delegation state unavailable; rechecking'
        account.update()
        this.updateEip7702Lifecycle(request, 'confirming', receipt)
        this.scheduleEip7702Monitor(account, request, operationVersion)
        return
      }

      request.status = result.revocationStatus === 'cleared' ? RequestStatus.Confirmed : RequestStatus.Error
      request.notice =
        result.revocationStatus === 'cleared'
          ? 'Delegation removed'
          : result.revocationStatus === 'skipped'
            ? 'Delegation remains'
            : 'Could not verify delegation'
      account.update()
      this.updateEip7702Lifecycle(
        request,
        result.revocationStatus === 'cleared' ? 'verified-clearance' : 'failed',
        receipt
      )
      if (request.activityId) operationLifecycleRuntime.release(request.activityId)
      account.releaseRequestReview(request.handlerId)
      const timer = setTimeout(() => {
        if (this.activeEip7702Operation(account, request, operationVersion)) {
          account.clearRequest(request.handlerId)
        }
      }, 8000)
      timer.unref?.()
      this.eip7702MonitorTimers.set(key, timer)
    } catch (error) {
      if (!this.activeEip7702Operation(account, request, operationVersion)) return
      this.clearEip7702PendingEvidence(request)
      log.warn('EIP-7702 revocation monitor check failed', {
        handlerId: request.handlerId,
        error: error instanceof Error ? error.message : String(error)
      })
      if (request.submission?.status !== 'unconfirmed') {
        request.notice = 'Waiting to verify delegation'
      }
      account.update()
      this.scheduleEip7702Monitor(account, request, operationVersion)
    }
  }

  private scheduleEip7702Monitor(
    account: FrameAccount,
    request: Eip7702RevokeRequest,
    operationVersion: number
  ) {
    if (!this.activeEip7702Operation(account, request, operationVersion)) return
    const key = this.eip7702OperationKey(account.id, request.handlerId)
    const currentTimer = this.eip7702MonitorTimers.get(key)
    if (currentTimer) clearTimeout(currentTimer)
    const timer = setTimeout(
      () => void this.monitorEip7702Revocation(account, request, operationVersion),
      EIP7702_MONITOR_INTERVAL_MS
    )
    timer.unref?.()
    this.eip7702MonitorTimers.set(key, timer)
  }

  private requestAccount(handlerId: string, accountId?: string) {
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    const request = account?.getRequest(handlerId)
    if (!account || !request) return undefined
    if (
      (typeof request.account === 'string' && request.account.toLowerCase() !== account.id) ||
      (accountId !== undefined && typeof request.account !== 'string')
    ) {
      throw new Error('Request does not belong to account')
    }
    return account
  }

  updateNonce(reqId: string, nonce: string, accountId?: string) {
    log.info('Update Nonce: ', reqId, nonce)

    const currentAccount = this.requestAccount(reqId, accountId)

    if (currentAccount) {
      const txRequest = currentAccount.getActiveReviewRequest<TransactionRequest>(reqId)
      if (!txRequest) throw new Error('Request is waiting for review')

      txRequest.data.nonce = nonce
      currentAccount.update()

      return txRequest
    }

    return undefined
  }

  confirmRequestApproval(
    reqId: string,
    approvalType: ApprovalType,
    approvalData?: ApprovalData,
    accountId?: string
  ) {
    log.info('confirmRequestApproval', reqId, approvalType)

    const currentAccount = this.requestAccount(reqId, accountId)
    if (currentAccount && !currentAccount.getActiveReviewRequest(reqId)) {
      throw new Error('Request is waiting for review')
    }
    const request = currentAccount?.getActiveReviewRequest(reqId) as
      (TransactionRequest | PermitSignatureRequest | WalletCallsRequest) | undefined
    if (currentAccount && request && request.status === undefined) {
      const approval = (request.approvals || []).find((a) => a.type === approvalType)

      if (approval) {
        approval.approve(approvalData)
      }
    }
  }

  updateRequest(
    reqId: string,
    data: Readonly<{ amount?: unknown }> = {},
    actionId: ActionType | null,
    accountId?: string
  ) {
    log.verbose('updateRequest', { reqId, actionId })

    const currentAccount = this.requestAccount(reqId, accountId)
    const request = currentAccount?.getActiveReviewRequest(reqId)
    if (!currentAccount || !request) return false
    if (request.status !== undefined) return false

    if (request.type === 'transaction') {
      const transactionReq = request as TransactionRequest
      if (!actionId || transactionReq.locked) return false

      const action = (transactionReq.recognizedActions || []).find((a) => a.id === actionId)
      if (!action?.update) return false

      let updated = false
      try {
        updated = action.update(transactionReq, data)
      } catch {
        log.warn('Transaction action update failed', { reqId, actionId })
      }
      if (!updated) {
        log.warn('Ignored invalid transaction action update', { reqId, actionId })
        return false
      }
      currentAccount.refreshTransactionSimulation(transactionReq, true, false, undefined, {
        preserveRecognizedActions: true
      })
      return true
    }

    if (request.type === 'signErc20Permit') {
      const permitReq = request as PermitSignatureRequest
      const amount = parseTokenBaseUnitAmount(data['amount'])
      if (amount === undefined || !permitReq.typedMessage?.data?.message || !permitReq.permit) {
        log.warn('Ignored invalid token permit amount update', { reqId })
        return false
      }

      const normalizedAmount = amount.toString(10)
      permitReq.typedMessage.data.message.value = normalizedAmount
      permitReq.permit.value = normalizedAmount
      currentAccount.syncPermitApprovalRisk(permitReq)
      currentAccount.update()
      return true
    }

    return false
  }

  private replacementFeeMarket(chainId: number, baseFee: boolean): ReplacementFeeMarket {
    const price = store('main.networksMeta', 'ethereum', chainId, 'gas.price') || {}
    if (baseFee) {
      return {
        maxBaseFeePerGas: price.fees?.maxBaseFeePerGas,
        maxPriorityFeePerGas: price.fees?.maxPriorityFeePerGas
      }
    }
    return { gasPrice: price.levels?.fast }
  }

  private applyReplacementFees(account: FrameAccount, request: TransactionRequest) {
    const chainId = Number(parseRpcQuantity(request.data.chainId))
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Invalid replacement chain')
    const fees = replacementFees(
      request,
      transactionRequests(account),
      this.replacementFeeMarket(chainId, usesBaseFee(request.data))
    )
    request.data = { ...request.data, ...fees, gasFeesSource: GasFeesSource.Frame }
    request.feesUpdatedByUser = false
    return fees
  }

  private replacementOperation(
    account: FrameAccount,
    replacement: NonNullable<TransactionRequest['replacement']>
  ) {
    const operation = operationLifecycleLedger
      .listStored()
      .find(({ id }) => id === replacement.originalActivityId)
    if (
      !operation ||
      operation.kind !== 'transaction' ||
      operation.account !== account.id ||
      operation.transaction?.hash !== replacement.originalHash.toLowerCase()
    ) {
      throw new Error('Original transaction monitoring evidence is unavailable')
    }
    if (!['submitted', 'reorged'].includes(operation.state) || operation.receipt) {
      throw new Error('Original transaction is no longer replaceable')
    }
    return operation
  }

  private async assertReplacementStillCurrent(
    account: FrameAccount,
    replacement: NonNullable<TransactionRequest['replacement']>
  ) {
    if (this.current() !== account || this.accounts[account.id] !== account) {
      throw new Error('Replacement requires the selected account')
    }
    const operation = this.replacementOperation(account, replacement)
    const [receipt, latestNonceValue] = await Promise.all([
      operationLifecycleRpc(operation.chainId, 'eth_getTransactionReceipt', [replacement.originalHash]),
      operationLifecycleRpc(operation.chainId, 'eth_getTransactionCount', [account.id, 'latest'])
    ])
    if (receipt !== null) throw new Error('Original transaction is already included')
    const latestNonce = parseRpcQuantity(latestNonceValue)
    const originalNonce = parseRpcQuantity(operation.transaction?.nonce)
    if (latestNonce === undefined || originalNonce === undefined) {
      throw new Error('Could not verify the original transaction nonce')
    }
    if (latestNonce > originalNonce) throw new Error('Original transaction nonce is already used')

    // Reject a chain/account/state change that raced the configured-RPC checks.
    this.replacementOperation(account, replacement)
    return operation
  }

  async recheckReplacementRequest(request: TransactionRequest) {
    if (!request.replacement) return true
    const account = this.requestAccount(request.handlerId, request.account)
    if (!account || account.getRequest(request.handlerId) !== request) {
      throw new Error('Replacement request is no longer available')
    }
    await this.assertReplacementStillCurrent(account, request.replacement)
    const status = getReplacementStatus(request, transactionRequests(account))
    if (!status.replacement || !status.possible) {
      throw new Error('Replacement fees or nonce are no longer valid')
    }
    return true
  }

  async replaceTx(accountId: string, id: string, type: ReplacementType) {
    const currentAccount = this.requestAccount(id, accountId)
    if (!currentAccount || this.current() !== currentAccount)
      throw new Error('Replacement requires the selected account')
    const original = currentAccount.getRequest<TransactionRequest>(id)
    if (!original || original.type !== 'transaction') throw new Error('Original transaction is unavailable')
    if (
      original.mode !== RequestMode.Monitor ||
      ![RequestStatus.Verifying, RequestStatus.Sent].includes(original.status as RequestStatus) ||
      !original.tx?.hash ||
      original.tx.receipt ||
      !original.activityId
    ) {
      throw new Error('Original transaction is no longer replaceable')
    }

    const replacement = Object.freeze({
      kind: type,
      originalActivityId: original.activityId,
      originalHash: original.tx.hash.toLowerCase()
    })
    if (
      this.replacementAdmissions.has(original.activityId) ||
      Object.values(currentAccount.requests).some(
        (candidate) =>
          candidate.type === 'transaction' &&
          candidate.replacement?.originalActivityId === original.activityId &&
          ![RequestStatus.Declined, RequestStatus.Error].includes(candidate.status as RequestStatus)
      )
    ) {
      throw new Error('A replacement for this transaction is already pending')
    }

    this.replacementAdmissions.add(original.activityId)
    try {
      const operation = await this.assertReplacementStillCurrent(currentAccount, replacement)
      const chainId = operation.chainId
      const base = original.data
      const fees = replacementFees(
        original,
        transactionRequests(currentAccount),
        this.replacementFeeMarket(chainId, usesBaseFee(base))
      )
      const nonce = operation.transaction?.nonce
      if (!nonce) throw new Error('Original transaction has no durable nonce')
      const shared = {
        from: currentAccount.getSelectedAddress(),
        nonce,
        chainId: toRpcQuantity(BigInt(chainId)),
        type: base.type,
        ...(base.accessList === undefined ? {} : { accessList: base.accessList }),
        ...fees
      }
      const params: RPC.SendTransaction.TxParams =
        type === ReplacementType.Speed
          ? {
              ...shared,
              ...(base.to === undefined ? {} : { to: base.to }),
              ...(base.value === undefined ? {} : { value: base.value }),
              ...(base.data === undefined ? {} : { data: base.data }),
              ...(base.gasLimit === undefined ? {} : { gasLimit: base.gasLimit })
            }
          : { ...shared, to: currentAccount.getSelectedAddress(), value: '0x0', data: '0x' }
      const payload: RPC.SendTransaction.Request = {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_sendTransaction',
        chainId: toRpcQuantity(BigInt(chainId)),
        params: [params],
        _origin:
          type === ReplacementType.Cancel && original.origin === originIdForName(WREN_DEPLOY_ORIGIN)
            ? frameOriginId
            : original.origin
      }

      const isManagedDeployment = original.origin === originIdForName(WREN_DEPLOY_ORIGIN)
      if (isManagedDeployment && !original.deployment) {
        throw new Error('Managed deployment replacement requires deployment evidence')
      }

      return await new Promise<void>((resolve, reject) => {
        let queued = false
        provider.sendTransaction(
          payload,
          (response) => {
            if (!queued && response.error) reject(new Error(response.error.message))
          },
          { type: 'ethereum', id: chainId },
          (handlerId) => {
            const request = currentAccount.getRequest<TransactionRequest>(handlerId)
            if (!request || request.type !== 'transaction') {
              reject(new Error('Replacement request could not be created'))
              return
            }
            queued = true
            request.replacement = replacement
            this.applyReplacementFees(currentAccount, request)
            currentAccount.update()
            resolve()
          },
          {
            replacement,
            ...(type === ReplacementType.Speed && isManagedDeployment
              ? { deployment: original.deployment }
              : {}),
            ...(type === ReplacementType.Speed && !isManagedDeployment && original.recentRecipient
              ? { recentRecipient: original.recentRecipient }
              : {})
          }
        )
      })
    } finally {
      this.replacementAdmissions.delete(original.activityId)
    }
  }

  private sendRequest(
    {
      method,
      params,
      chainId,
      _origin = frameOriginId
    }: { method: string; params: unknown[]; chainId: string; _origin?: string },
    cb: RPCRequestCallback
  ) {
    provider.send({ id: 1, jsonrpc: '2.0', method, params, chainId, _origin }, cb)
  }

  private transactionLifecycleMatches(
    operation: OperationLifecycle,
    context: TransactionSubmissionContext,
    hash: string
  ) {
    const deployment = operation.transaction?.deployment
    const expectedDeployment = context.deployment
    const deploymentMatches =
      (!deployment && !expectedDeployment) ||
      (deployment?.version === expectedDeployment?.version &&
        deployment?.inspectionId === expectedDeployment?.inspectionId &&
        deployment?.initcodeHash === expectedDeployment?.initcodeHash &&
        deployment?.initcodeBytes === expectedDeployment?.initcodeBytes &&
        deployment?.value === expectedDeployment?.value)
    return (
      operation.kind === 'transaction' &&
      operation.id === context.activityId &&
      operation.account === context.account &&
      operation.origin === context.origin &&
      operation.chainId === context.chainId &&
      operation.transaction?.hash === hash.toLowerCase() &&
      operation.transaction.nonce === context.nonce &&
      operation.transaction.replacementOf === context.replacementOf &&
      deploymentMatches
    )
  }

  private admitTransactionLifecycle(
    context: TransactionSubmissionContext,
    hash: string,
    phase: NonNullable<OperationLifecycle['broadcast']>['phase']
  ) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return undefined
    const existing = operationLifecycleLedger.listStored().find(({ id }) => id === context.activityId)
    if (existing) {
      if (!this.transactionLifecycleMatches(existing, context, hash) || !existing.broadcast) return undefined
      const phaseRank = { broadcasting: 0, unconfirmed: 1, acknowledged: 2 } as const
      if (phaseRank[phase] <= phaseRank[existing.broadcast.phase]) {
        return { operation: existing, admitted: false }
      }
      try {
        const operation = this.persistOperationLifecycle({
          ...existing,
          updatedAt: Math.min(Date.now(), existing.expiresAt),
          broadcast: { ...existing.broadcast, phase }
        })
        return { operation, admitted: false }
      } catch (error) {
        log.error('Transaction lifecycle promotion failed', {
          handlerId: context.handlerId,
          error: error instanceof Error ? error.message : String(error)
        })
        return undefined
      }
    }
    try {
      return {
        operation: this.persistOperationLifecycle({
          ...this.operationForTransaction(context, hash),
          broadcast: {
            phase,
            ...(context.recentRecipient ? { pendingRecipient: context.recentRecipient } : {}),
            ...(context.outboundFingerprints.length
              ? { pendingOutboundFingerprints: [...context.outboundFingerprints] }
              : {})
          }
        }),
        admitted: true
      }
    } catch (error) {
      operationLifecycleLedger.releaseReservation(context.activityId)
      log.error('Transaction lifecycle admission failed', {
        handlerId: context.handlerId,
        error: error instanceof Error ? error.message : String(error)
      })
      return undefined
    }
  }

  private reconcileTransactionLifecycle(operation: OperationLifecycle, admitted: boolean) {
    if (!admitted) return
    void operationLifecycleRuntime.reconcile(operation.id).catch((error) => {
      log.warn('Transaction lifecycle monitor could not start', {
        operationId: operation.id,
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }

  // Set Current Account
  setSigner(id: string, cb: Callback<Account>) {
    const previouslyActiveAccount = this.current()

    this._current = id
    const currentAccount = this.current()

    if (!currentAccount) {
      const err = new Error('could not set signer')
      log.error(`no current account with id: ${id}`, err.stack)

      return cb(err)
    }

    currentAccount.active = true
    currentAccount.update()

    const summary = currentAccount.summary()
    cb(null, summary)

    if (previouslyActiveAccount && previouslyActiveAccount.address !== currentAccount.address) {
      previouslyActiveAccount.active = false
      previouslyActiveAccount.update()
    }

    requireStoreAction('setAccount')(summary)
    currentAccount.presentActiveRequest()

    if (currentAccount.status === 'ok')
      this.verifyAddress(false, (err, verified) => {
        if (!err && !verified) {
          currentAccount.signer = ''
          currentAccount.update()
        }
      })

    // If the account has any current requests, make sure fees are current
    this.updatePendingFees()
  }

  private pendingTransactionFeeData(account: FrameAccount, req: TransactionRequest) {
    const tx = req.data
    const chain = { type: 'ethereum', id: parseInt(tx.chainId, 16) }
    const gas = store('main.networksMeta', chain.type, chain.id, 'gas')
    const gasLimit = this.requiredQuantity(tx.gasLimit, 'transaction gas limit')
    const perGasCap = this.maxFeePerGasFor(gasLimit, tx)
    let candidateData: TransactionData

    if (usesBaseFee(tx)) {
      const { maxBaseFeePerGas, maxPriorityFeePerGas } = gas.price.fees || {}
      if (!maxBaseFeePerGas || !maxPriorityFeePerGas) {
        throw new Error(`Network ${chain.id} has no EIP-1559 fee estimate`)
      }
      const priorityFee = this.limitedQuantity(
        this.requiredQuantity(maxPriorityFeePerGas, 'network priority fee'),
        this.limitedQuantity(MAX_FEE_PER_GAS, perGasCap)
      )
      const baseFee = this.limitedQuantity(
        this.requiredQuantity(maxBaseFeePerGas, 'network base fee'),
        this.limitedQuantity(MAX_FEE_PER_GAS, perGasCap - priorityFee)
      )
      candidateData = {
        ...tx,
        maxPriorityFeePerGas: toRpcQuantity(priorityFee),
        maxFeePerGas: toRpcQuantity(baseFee + priorityFee)
      }
    } else {
      const gasPrice = gas.price.levels.fast
      if (!gasPrice) throw new Error(`Network ${chain.id} has no fast gas-price estimate`)
      candidateData = {
        ...tx,
        gasPrice: toRpcQuantity(
          this.limitedQuantity(
            this.requiredQuantity(gasPrice, 'network gas price'),
            this.limitedQuantity(MAX_FEE_PER_GAS, perGasCap)
          )
        )
      }
    }

    if (req.replacement) {
      candidateData = {
        ...candidateData,
        ...replacementFees(
          { ...req, data: candidateData },
          transactionRequests(account),
          this.replacementFeeMarket(chain.id, usesBaseFee(tx))
        ),
        gasFeesSource: GasFeesSource.Frame
      }
    }

    return candidateData
  }

  private async refreshTransactionL1Fee(req: TransactionRequest) {
    try {
      const estimate = toRpcQuantity(await provider.getL1GasCost(req.data))
      req.chainData = {
        ...req.chainData,
        optimism: {
          l1Fees: estimate
        }
      }
      return true
    } catch (error) {
      log.error('Error estimating L1 gas cost', error)
      return false
    }
  }

  async updatePendingFees(chainId?: number) {
    const currentAccount = this.current()

    if (currentAccount) {
      // If chainId, update pending tx requests from that chain, otherwise update all pending tx requests
      const { l1Transactions, l2Transactions } = toTransactionsByLayer(currentAccount.requests, chainId)
      const walletCalls = Object.values(currentAccount.requests)
        .filter((request): request is WalletCallsRequest => request.type === 'walletCalls')
        .filter(
          (request) =>
            request.status === undefined &&
            (chainId === undefined || parseInt(request.chainId, 16) === chainId)
        )

      walletCalls.forEach((request) => currentAccount.refreshWalletCallsPreparation(request))

      l1Transactions.forEach(([_id, req]) => {
        try {
          const tx = req.data
          const candidateData = this.pendingTransactionFeeData(currentAccount, req)
          const changed = usesBaseFee(tx)
            ? candidateData.maxPriorityFeePerGas !== tx.maxPriorityFeePerGas ||
              candidateData.maxFeePerGas !== tx.maxFeePerGas
            : candidateData.gasPrice !== tx.gasPrice
          if (changed) {
            currentAccount.refreshTransactionSimulation(req, false, true, candidateData)
          }
        } catch (e) {
          log.error('Could not update gas fees for transaction', e)
        }
      })

      await Promise.all(
        l2Transactions.map(async ([_id, req]) => {
          if (await this.refreshTransactionL1Fee(req)) currentAccount.update()
        })
      )
    }
  }

  unsetSigner(cb: Callback<{ id: string; status: string }>) {
    const summary = { id: '', status: '' }
    if (cb) cb(null, summary)

    requireStoreAction('unsetAccount')()

    // setTimeout(() => { // Clear signer requests when unset
    //   if (s) {
    //     s.requests = {}
    //     s.update()
    //   }
    // })
  }

  verifyAddress(display: boolean, cb: Callback<boolean>) {
    const currentAccount = this.current()
    if (currentAccount && currentAccount.verifyAddress) currentAccount.verifyAddress(display, cb)
  }

  getSelectedAddresses() {
    const currentAccount = this.current()
    return currentAccount ? currentAccount.getSelectedAddresses() : []
  }

  getAccounts(cb?: Callback<Array<string>>) {
    const currentAccount = this.current()
    if (!currentAccount) {
      if (cb) cb(new Error('No Account Selected'))
      return
    }

    return currentAccount.getAccounts(cb)
  }

  getCoinbase(cb: Callback<Array<string>>) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))

    currentAccount.getCoinbase(cb)
  }

  signMessage(address: Address, message: string, cb: Callback<string>, beforeSign?: () => void) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))
    if (address.toLowerCase() !== currentAccount.getSelectedAddress().toLowerCase())
      return cb(new Error('signMessage: Wrong Account Selected'))

    if (beforeSign) currentAccount.signMessage(message, cb, beforeSign)
    else currentAccount.signMessage(message, cb)
  }

  signTypedData(address: Address, typedMessage: TypedMessage, cb: Callback<string>, beforeSign?: () => void) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))
    if (address.toLowerCase() !== currentAccount.getSelectedAddress().toLowerCase())
      return cb(new Error('signMessage: Wrong Account Selected'))

    if (beforeSign) currentAccount.signTypedData(typedMessage, cb, beforeSign)
    else currentAccount.signTypedData(typedMessage, cb)
  }

  signTransaction(rawTx: TransactionData, cb: Callback<string>) {
    const currentAccount = this.current()

    if (!currentAccount) return cb(new Error('No Account Selected'))

    return this.signTransactionForAccount(currentAccount.id, rawTx, cb)
  }

  signTransactionForAccount(
    accountId: string,
    rawTx: TransactionData,
    cb: Callback<string>,
    beforeSign?: () => void
  ) {
    if (typeof accountId !== 'string') return cb(new Error('Invalid signing account'))

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) return cb(new Error('Could not locate signing account'))

    const matchesAccount =
      typeof rawTx?.from === 'string' &&
      rawTx.from.toLowerCase() === account.getSelectedAddress().toLowerCase()

    if (!matchesAccount) return cb(new Error('Transaction does not match signing account'))

    if (beforeSign) account.signTransaction(rawTx, cb, beforeSign)
    else account.signTransaction(rawTx, cb)
  }

  claimWalletCallsRequest(
    accountId: string,
    handlerId: string,
    simulationAcknowledged = false
  ): Readonly<PreparedWalletCallExecutionSnapshot> {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate wallet-call account')
    if (!account.getActiveReviewRequest(handlerId)) {
      throw new Error('Wallet-call request is waiting for review')
    }

    const snapshot = account.claimWalletCallsRequest(handlerId, simulationAcknowledged)
    account.releaseRequestReview(handlerId)
    return snapshot
  }

  adjustWalletCallsRequest(accountId: string, handlerId: string, adjustment: unknown) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate wallet-call account')
    if (!account.getActiveReviewRequest(handlerId)) {
      throw new Error('Wallet-call request is waiting for review')
    }

    return account.adjustWalletCalls(handlerId, adjustment)
  }

  applyWalletCallsPreflightEvidence(
    accountId: string,
    handlerId: string,
    preparation: Readonly<PreparedWalletCallBatch>,
    simulation: WalletCallsSimulationResult
  ) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }
    const account = this.accounts[accountId.toLowerCase()]
    if (!account?.getActiveReviewRequest<WalletCallsRequest>(handlerId)) {
      throw new Error('Wallet-call request is no longer available')
    }
    return account.applyWalletCallsPreflightEvidence(handlerId, preparation, simulation)
  }

  claimWalletCallsRequestWithResponse(
    accountId: string,
    handlerId: string,
    expectedEvidence: Readonly<WalletCallsClaimEvidence>,
    simulationAcknowledged = false
  ) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate wallet-call account')
    if (!account.getActiveReviewRequest(handlerId)) {
      throw new Error('Wallet-call request is waiting for review')
    }

    const request = account.getRequest<WalletCallsRequest>(handlerId)
    const responder = request?.res as WalletCallsResponder | undefined
    if (
      !request ||
      request.type !== 'walletCalls' ||
      typeof request.account !== 'string' ||
      request.account.toLowerCase() !== account.id ||
      typeof responder !== 'function' ||
      responder.walletCallsLifecycle !== true ||
      typeof responder.accept !== 'function'
    ) {
      throw new Error('Wallet-call response is no longer available')
    }
    if (
      !expectedEvidence ||
      typeof expectedEvidence !== 'object' ||
      !expectedEvidence.execution ||
      typeof expectedEvidence.simulation !== 'string'
    ) {
      throw new Error('Wallet-call final preflight evidence is unavailable')
    }

    const snapshot = account.claimWalletCallsRequest(handlerId, simulationAcknowledged, expectedEvidence)
    if (account.getRequest(handlerId) !== request) {
      throw new Error('Wallet-call request changed during approval')
    }
    request.responsePending = false
    delete request.res
    account.releaseRequestReview(handlerId)

    return Object.freeze({ snapshot, responder })
  }

  cancelUnapprovedRequestForAccount(accountId: string, handlerId: string, error: EVMError) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) return false

    const account = this.accounts[accountId.toLowerCase()]
    const request = account?.getRequest<AnyAccountRequest>(handlerId)
    const retainedPreBroadcastFailure =
      request?.type === 'transaction' &&
      request.status === RequestStatus.Error &&
      Boolean(request.retainedPreBroadcastError)
    const retainedWalletCallsFailure =
      request?.type === 'walletCalls' &&
      request.status === RequestStatus.Error &&
      Boolean(request.recoverableError) &&
      !request.locked
    if (
      !account ||
      !request ||
      (!retainedPreBroadcastFailure &&
        !retainedWalletCallsFailure &&
        (request.status !== undefined || ('locked' in request && request.locked)))
    ) {
      return false
    }

    if (retainedWalletCallsFailure) {
      delete request.status
      delete request.notice
      delete request.recoverableError
      account.rejectRequest(request, error)
    } else if (
      request.type === 'transaction' &&
      request.retainedPreBroadcastError &&
      !request.retainedPreBroadcastError.responderPending
    ) {
      account.clearRequest(handlerId)
    } else {
      account.rejectRequest(request, error)
    }
    return true
  }

  settleWalletCallsRequest(accountId: string, handlerId: string, error?: Error) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) return false
    const request = account.getRequest<WalletCallsRequest>(handlerId)
    if (!request) return false
    if (
      request.type !== 'walletCalls' ||
      typeof request.account !== 'string' ||
      request.account.toLowerCase() !== account.id ||
      !request.locked ||
      request.status !== RequestStatus.Pending
    ) {
      throw new Error('Wallet-call request is not awaiting an execution outcome')
    }

    const previousState = {
      status: request.status,
      notice: request.notice,
      mode: request.mode
    }
    request.status = error ? RequestStatus.Error : RequestStatus.Success
    request.notice = error
      ? (error.message || 'Wallet-call execution failed').slice(0, 240)
      : 'Batch Submitted'
    request.mode = RequestMode.Monitor
    try {
      account.update()
    } catch (updateError) {
      if (previousState.status !== undefined) request.status = previousState.status
      else delete request.status
      if (previousState.notice !== undefined) request.notice = previousState.notice
      else delete request.notice
      if (previousState.mode !== undefined) request.mode = previousState.mode
      else delete request.mode
      throw updateError
    }

    setTimeout(
      () => {
        if (this.accounts[account.id] === account && account.getRequest(handlerId) === request) {
          account.clearRequest(handlerId)
        }
      },
      error ? 8000 : 3300
    )

    return true
  }

  retainWalletCallsFundingFailure(
    accountId: string,
    handlerId: string,
    error:
      WalletCallFundingError | Readonly<{ code: 'managed-sweep-changed'; message: string; data?: undefined }>
  ) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid wallet-call request identity')
    }
    const account = this.accounts[accountId.toLowerCase()]
    const request = account?.getActiveReviewRequest<WalletCallsRequest>(handlerId)
    const updatingRecovery =
      request?.type === 'walletCalls' &&
      request.status === RequestStatus.Error &&
      Boolean(request.recoverableError)
    if (
      !account ||
      !request ||
      request.type !== 'walletCalls' ||
      (request.status !== undefined && !updatingRecovery) ||
      request.locked ||
      !request.res
    ) {
      throw new Error('Wallet-call request is not available for recovery')
    }

    request.status = RequestStatus.Error
    request.notice = error.message.slice(0, 240)
    request.recoverableError = {
      code: error.code,
      message: request.notice,
      ...(error.data === undefined ? {} : { data: error.data })
    }
    account.update()
    return true
  }

  closeFailedWalletCalls(handlerId: string, accountId: string) {
    const account = this.accounts[accountId.toLowerCase()]
    const request = account?.getActiveReviewRequest<WalletCallsRequest>(handlerId)
    if (
      !account ||
      !request ||
      request.type !== 'walletCalls' ||
      request.status !== RequestStatus.Error ||
      !request.recoverableError ||
      !request.res ||
      request.locked
    ) {
      throw new Error('Wallet-call request is not available to close')
    }

    delete request.status
    delete request.notice
    delete request.recoverableError
    account.rejectRequest(request, { code: 4001, message: 'User closed the failed wallet-call request' })
    return true
  }

  signerCompatibility(handlerId: string, cb: Callback<SignerCompatibility>, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return cb(new Error('Could not locate account'))

    const request = currentAccount.requests[handlerId]
    if (!request) return cb(new Error(`Could not locate request ${handlerId}`))

    if (isWatchOnlyAccountType(currentAccount.lastSignerType)) {
      return cb(new Error(WATCH_ONLY_SIGNING_ERROR))
    }

    const signer = currentAccount.getSigner()

    const signerUnavailable = (knownSigner?: Signer) => {
      const crumb = knownSigner ? signerPanelCrumb(knownSigner) : accountPanelCrumb()

      requireStoreAction('navDash')(crumb)
      return cb(new Error('Signer unavailable'))
    }

    if (!signer) {
      // if no signer is active, check if this account was previously relying on a
      // hardware signer that is currently disconnected
      const unavailableSigners = findUnavailableSigners(currentAccount.lastSignerType, storeApi.getSigners())

      // if there is only one matching disconnected signer, open the signer panel so it can be unlocked
      if (unavailableSigners.length === 1) return signerUnavailable(unavailableSigners[0])

      // if there is more than one matching signer, open the account panel so the user can choose
      if (unavailableSigners.length > 1) return signerUnavailable()

      // otherwise there are no signers that can be found
      return cb(new Error('No signer'))
    }

    if (!isSignerReady(signer)) {
      // if the signer is not ready to sign, open the signer panel so that
      // the user can unlock it or reconnect
      return signerUnavailable(signer)
    }

    const getCompatibility = () => {
      if (request.type === 'transaction') {
        const data = this.getTransactionRequest(currentAccount, handlerId).data
        return transactionCompatibility(data, signer.summary())
      }

      // all requests besides transactions are always compatible
      return { signer: signer.type, tx: '', compatible: true }
    }

    cb(null, getCompatibility())
  }

  close() {
    this.pendingNonceAdjustments.clear()
    this.removeOperationLifecycleObserver()
    this.eip7702MonitorTimers.forEach((timer) => clearTimeout(timer))
    this.eip7702MonitorTimers.clear()
    this.transactionReviewDismissTimers.forEach((timer) => clearTimeout(timer))
    this.transactionReviewDismissTimers.clear()
    this.transactionCleanupTimers.forEach((timer) => clearTimeout(timer))
    this.transactionCleanupTimers.clear()
    this.dataScanner.close()
    // usbDetect.stopMonitoring()
  }

  setAccess(req: AccessRequest, access: boolean) {
    const currentAccount = this.requestAccount(req.handlerId, req.account)
    const request = currentAccount?.getActiveReviewRequest<AccessRequest>(req.handlerId)
    if (!currentAccount || !request || request.type !== 'access') return false
    currentAccount.setAccess(request, access)
    return true
  }

  resolveRequest<T>(req: AccountRequest, result?: T) {
    const currentAccount = this.current()
    if (currentAccount && currentAccount.resolveRequest) {
      currentAccount.resolveRequest(req, result)
    }
  }

  resolveRequestForAccount<T>(accountId: string, handlerId: string, result?: T) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid account request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    const request = account?.getRequest(handlerId)
    if (!account || !request) return false
    if (typeof request.account !== 'string' || request.account.toLowerCase() !== account.id) {
      throw new Error('Request does not belong to account')
    }

    account.resolveRequest(request, result)
    return true
  }

  rejectRequest(req: AccountRequest, error: EVMError) {
    const currentAccount = this.requestAccount(req.handlerId, req.account)
    if (currentAccount) {
      const request = currentAccount.getRequest(req.handlerId)
      currentAccount.rejectRequest(request, error)
    }
  }

  rejectRequestForAccount(accountId: string, handlerId: string, error: EVMError) {
    if (
      typeof accountId !== 'string' ||
      typeof handlerId !== 'string' ||
      !handlerId ||
      !error ||
      typeof error !== 'object' ||
      typeof error.code !== 'number' ||
      typeof error.message !== 'string' ||
      !error.message
    ) {
      throw new Error('Invalid account rejection')
    }

    const request = this.getRequestForAccount(accountId, handlerId)
    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')

    account.rejectRequest(request, error)
    return true
  }

  getRequestForAccount<T extends AccountRequest = AccountRequest>(accountId: string, handlerId: string) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid account request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')
    const request = account.getRequest<T>(handlerId)
    if (!request) throw new Error('Could not locate account request')
    if (typeof request.account !== 'string' || request.account.toLowerCase() !== account.id) {
      throw new Error('Request does not belong to account')
    }

    return request
  }

  getActiveRequestForAccount<T extends AccountRequest = AccountRequest>(
    accountId: string,
    handlerId: string
  ) {
    const request = this.getRequestForAccount<T>(accountId, handlerId)
    const account = this.accounts[accountId.toLowerCase()]
    if (!account?.getActiveReviewRequest(handlerId)) {
      throw new Error('Request is waiting for review')
    }
    return request
  }

  refreshRequestAddressSafety(accountId: string, handlerId: string) {
    if (typeof accountId !== 'string' || typeof handlerId !== 'string' || !handlerId) {
      throw new Error('Invalid address-safety request identity')
    }
    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')
    return account.refreshRequestAddressSafety(handlerId)
  }

  syncDappGuardrailApproval(req: AnyAccountRequest, data?: Record<string, unknown>) {
    const account = this.accounts[req.account.toLowerCase()]
    if (!account) throw new Error('Could not locate guardrail request account')
    if (
      req.type !== 'transaction' &&
      req.type !== 'walletCalls' &&
      req.type !== 'sign' &&
      req.type !== 'signTypedData' &&
      req.type !== 'signErc20Permit'
    ) {
      throw new Error('Request type does not support dapp guardrails')
    }
    account.syncDappGuardrailApproval(req, data)
  }

  dappGuardrailRequests(accountId: string, originId: string) {
    const account = this.accounts[accountId.toLowerCase()]
    if (!account) return []
    return Object.values(account.requests).filter(
      (request) =>
        request.origin === originId &&
        (request.type === 'transaction' ||
          request.type === 'walletCalls' ||
          request.type === 'sign' ||
          request.type === 'signTypedData' ||
          request.type === 'signErc20Permit') &&
        (request.status === undefined ||
          (request.type === 'walletCalls' && Boolean(request.recoverableError) && !request.locked))
    )
  }

  addRequest(req: AnyAccountRequest, res?: RPCRequestCallback) {
    log.info('addRequest', { handlerId: req.handlerId, type: req.type })

    const currentAccount = this.current()
    if (!currentAccount) throw new Error('Could not locate request account')
    if (req.account === undefined) req.account = currentAccount.id
    if (typeof req.account !== 'string' || req.account.toLowerCase() !== currentAccount.id) {
      throw new Error('Request does not belong to current account')
    }
    if (currentAccount.requests[req.handlerId]) throw new Error('Request handler is already in use')

    try {
      currentAccount.addRequest(req, res)
      if (currentAccount.requests[req.handlerId] !== req) throw new Error('Account did not admit request')
      return true
    } catch (error) {
      if (currentAccount.requests[req.handlerId] === req) {
        try {
          currentAccount.clearRequest(req.handlerId)
        } catch (cleanupError) {
          const admissionMessage = error instanceof Error ? error.message : String(error)
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          throw new Error(
            `Account request admission failed: ${admissionMessage}; cleanup failed: ${cleanupMessage}`
          )
        }
      }
      throw error
    }
  }

  addRequestForAccount(
    accountId: string,
    req: AnyAccountRequest,
    res?: RPCRequestCallback | WalletCallsResponder
  ) {
    if (
      typeof accountId !== 'string' ||
      !req ||
      typeof req !== 'object' ||
      typeof req.handlerId !== 'string' ||
      !req.handlerId ||
      typeof req.account !== 'string'
    ) {
      throw new Error('Invalid account request identity')
    }

    const account = this.accounts[accountId.toLowerCase()]
    if (!account) throw new Error('Could not locate request account')
    if (req.account.toLowerCase() !== account.id) throw new Error('Request does not belong to account')
    if (account.requests[req.handlerId]) throw new Error('Request handler is already in use')

    try {
      account.addRequest(req, res)
      if (account.requests[req.handlerId] !== req) throw new Error('Account did not admit request')
      return true
    } catch (error) {
      if (account.requests[req.handlerId] === req) {
        try {
          account.clearRequest(req.handlerId)
        } catch (cleanupError) {
          const admissionMessage = error instanceof Error ? error.message : String(error)
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          throw new Error(
            `Account request admission failed: ${admissionMessage}; cleanup failed: ${cleanupMessage}`
          )
        }
      }
      throw error
    }
  }

  removeRequests(handlerId: string) {
    Object.values(this.accounts).forEach((account) => {
      if (account.requests[handlerId]) {
        this.removeRequest(account, handlerId)
      }
    })
  }

  markRequestResponseSettled(handlerId: string) {
    const account = Object.values(this.accounts).find((candidate) => candidate.requests[handlerId])
    const request = account?.requests[handlerId]
    if (!request) return false
    request.responsePending = false
    return true
  }

  removeRequest(account: FrameAccount, handlerId: string) {
    log.info(`removeRequest(${account.id}, ${handlerId})`)

    account.clearRequest(handlerId)
  }

  declineRequest(handlerId: string, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    const request = currentAccount?.getActiveReviewRequest(handlerId)

    if (currentAccount && request) {
      if (request.type === 'eip7702Revoke' && request.status !== undefined) return false
      if (!isCancelableRequest(request.status || '')) return false

      if (request.type === 'eip7702Revoke') this.cancelEip7702Operation(currentAccount.id, handlerId)
      if (request.type === 'transaction') currentAccount.cancelTransactionSigning(handlerId)
      request.status = RequestStatus.Declined
      request.notice =
        request.type === 'transaction'
          ? 'Transaction declined'
          : request.type === 'eip7702Revoke'
            ? 'Delegation revocation declined'
            : 'Request declined'
      request.mode = RequestMode.Monitor

      const declineTimer = setTimeout(() => {
        const account = this.accounts[currentAccount.address]
        if (account?.requests[handlerId]?.status === RequestStatus.Declined) {
          this.removeRequest(account, handlerId)
        }
      }, 2000)
      declineTimer.unref?.()
      currentAccount.update()
      return true
    }

    return false
  }

  setRequestPending(req: AccountRequest) {
    const handlerId = req.handlerId
    const currentAccount = this.requestAccount(handlerId, req.account)

    log.info('setRequestPending', handlerId)

    if (!currentAccount) throw new Error('Request is no longer pending')

    const storedRequest = currentAccount.getRequest(handlerId)
    if (!storedRequest) throw new Error('Request is no longer pending')
    if (!currentAccount.getActiveReviewRequest(handlerId)) {
      throw new Error('Request is waiting for review')
    }
    if (storedRequest.status !== undefined) {
      throw new Error('Request is already pending or complete')
    }
    if (
      isWatchOnlyAccountType(currentAccount.lastSignerType) &&
      (storedRequest.type === 'transaction' || isSignatureRequest(storedRequest))
    ) {
      throw new Error(WATCH_ONLY_SIGNING_ERROR)
    }
    if (
      isTransactionRequest(storedRequest) &&
      (storedRequest.simulation?.status === 'pending' ||
        storedRequest.simulation?.advancedChecks?.status === 'pending')
    ) {
      throw new Error('Transaction safety checks are still pending')
    }
    if (isTransactionRequest(storedRequest) && storedRequest.replacement) {
      const replacementStatus = getReplacementStatus(storedRequest, transactionRequests(currentAccount))
      if (!replacementStatus.replacement || !replacementStatus.possible) {
        throw new Error('Replacement fees or nonce are no longer valid')
      }
    }

    storedRequest.status = RequestStatus.Pending

    const signerType = currentAccount.lastSignerType
    const hwSigner = signerType !== 'seed' && signerType !== 'ring'

    storedRequest.notice = hwSigner ? 'See Signer' : ''
    if (storedRequest.type === 'transaction') {
      const transactionRequest = storedRequest as TransactionRequest
      this.setTransactionSigningProgress(
        transactionRequest.account,
        transactionRequest.handlerId,
        transactionRequest.data.nonce ? 'rechecking-safety' : 'preparing-nonce'
      )
    }
    currentAccount.update()
    return true
  }

  setTransactionSigningProgress(
    accountId: string,
    handlerId: string,
    phase: NonNullable<TransactionRequest['signingProgress']>['phase'],
    signer?: { type?: string; name?: string }
  ) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    const request = currentAccount?.getRequest<TransactionRequest>(handlerId)
    if (!currentAccount || !request || request.type !== 'transaction') return false
    if (
      [RequestStatus.Declined, RequestStatus.Error, RequestStatus.Confirmed].includes(
        request.status as RequestStatus
      )
    ) {
      return false
    }

    const previous = request.signingProgress
    if (previous && previous.phase !== phase) {
      const duration = Date.now() - previous.startedAt
      log.info('transaction signing timing', {
        phase: previous.phase,
        duration:
          duration < 250
            ? 'under-250ms'
            : duration < 1000
              ? 'under-1s'
              : duration < 3000
                ? 'under-3s'
                : duration < 8000
                  ? 'under-8s'
                  : '8s-or-more'
      })
    }
    if (
      previous?.phase === phase &&
      previous.signerType === signer?.type &&
      previous.signerName === signer?.name
    ) {
      return true
    }

    request.signingProgress = {
      phase,
      startedAt: Date.now(),
      ...(signer?.type ? { signerType: signer.type } : {}),
      ...(signer?.name ? { signerName: signer.name } : {})
    }
    currentAccount.update()
    return true
  }

  setRequestError(handlerId: string, err: unknown, accountId?: string) {
    log.info('setRequestError', handlerId)

    const currentAccount = this.requestAccount(handlerId, accountId)

    if (currentAccount && currentAccount.requests[handlerId]) {
      if (currentAccount.requests[handlerId].status === RequestStatus.Declined) return false

      const failedRequest = currentAccount.requests[handlerId]
      if (
        failedRequest.type === 'transaction' &&
        failedRequest.status === RequestStatus.Verifying &&
        failedRequest.submission?.status === 'unconfirmed'
      ) {
        return true
      }
      const failedBeforeBroadcast =
        failedRequest.type === 'transaction' && failedRequest.status === RequestStatus.Pending

      if (
        err instanceof SignerUserRejectedError ||
        (typeof err === 'object' && err && 'code' in err && err.code === USER_REJECTED_REQUEST)
      ) {
        if (failedRequest.type === 'transaction') {
          delete failedRequest.recoverableError
          delete failedRequest.retainedPreBroadcastError
        }
        currentAccount.requests[handlerId].status = RequestStatus.Declined
        currentAccount.requests[handlerId].notice = 'Request declined'
        currentAccount.requests[handlerId].mode = RequestMode.Monitor
        setTimeout(
          () => this.accounts[currentAccount.address] && this.removeRequest(currentAccount, handlerId),
          2000
        )
        currentAccount.update()
        return true
      }

      if (
        failedBeforeBroadcast &&
        (isRecoverableAccountCodeEvidenceError(err) || isTransactionFundingError(err))
      ) {
        const recoverableError = err as
          | (Error & {
              code: 'account-code-evidence-unavailable' | 'account-code-evidence-changed'
              data?: unknown
            })
          | TransactionFundingError
        failedRequest.status = RequestStatus.Error
        failedRequest.notice =
          recoverableError.message || 'The transaction safety check could not be repeated.'
        failedRequest.recoverableError = {
          code: recoverableError.code,
          message: failedRequest.notice,
          ...(recoverableError.data === undefined ? {} : { data: recoverableError.data })
        }
        failedRequest.retainedPreBroadcastError = { responderPending: true }
        currentAccount.update()
        return true
      }

      if (failedRequest.type === 'transaction') {
        delete failedRequest.recoverableError
        if (failedBeforeBroadcast) {
          failedRequest.retainedPreBroadcastError = { responderPending: false }
        } else {
          delete failedRequest.retainedPreBroadcastError
        }
      }

      currentAccount.requests[handlerId].status = RequestStatus.Error
      const notice =
        typeof err === 'string'
          ? err
          : isRecord(err) && typeof err['message'] === 'string'
            ? err['message']
            : 'Unknown Error'
      const errorMessage = notice.toLowerCase()

      if (errorMessage === 'ledger device: invalid data received (0x6a80)') {
        currentAccount.requests[handlerId].notice = 'Ledger rejected transaction data (0x6a80)'
      } else if (
        errorMessage === 'ledger device: condition of use not satisfied (denied by the user?) (0x6985)'
      ) {
        currentAccount.requests[handlerId].notice = 'Ledger Signature Declined'
      } else if (errorMessage.includes('insufficient funds')) {
        currentAccount.requests[handlerId].notice = errorMessage.includes('for gas')
          ? 'insufficient funds for gas'
          : 'insufficient funds'
      } else {
        currentAccount.requests[handlerId].notice = notice
      }

      if (failedBeforeBroadcast) {
        currentAccount.update()
        return true
      }

      if (currentAccount.requests[handlerId].type === 'transaction') {
        const transitionTimer = setTimeout(() => {
          if (
            this.accounts[currentAccount.address] === currentAccount &&
            currentAccount.requests[handlerId]
          ) {
            currentAccount.requests[handlerId].mode = RequestMode.Monitor
            currentAccount.update()
            currentAccount.releaseRequestReview(handlerId)

            const removalTimer = setTimeout(() => {
              if (
                this.accounts[currentAccount.address] === currentAccount &&
                currentAccount.requests[handlerId]
              ) {
                this.removeRequest(currentAccount, handlerId)
              }
            }, 8000)
            removalTimer.unref?.()
          }
        }, 1500)
        transitionTimer.unref?.()
      } else {
        const removalTimer = setTimeout(() => {
          const account = this.accounts[currentAccount.address]
          if (account?.requests[handlerId]) this.removeRequest(account, handlerId)
        }, 3300)
        removalTimer.unref?.()
      }

      currentAccount.update()
      return true
    }

    return false
  }

  async retryFailedTransaction(handlerId: string, accountId: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    const request = currentAccount?.getActiveReviewRequest<TransactionRequest>(handlerId)
    if (
      !currentAccount ||
      !request ||
      request.type !== 'transaction' ||
      request.status !== RequestStatus.Error ||
      !request.recoverableError
    ) {
      throw new Error('Transaction request is not available for another review')
    }

    const fundingRecovery = request.recoverableError.code.startsWith('transaction-funding-')
    if (fundingRecovery) {
      delete request.locked
      const failFundingRecheck = (message: string): never => {
        const error = new TransactionFundingError(TRANSACTION_FUNDING_UNAVAILABLE, message)
        request.locked = true
        request.notice = error.message
        request.recoverableError = { code: error.code, message: error.message }
        currentAccount.update()
        throw error
      }

      const { gasLimit: retainedGasLimit, ...retainedData } = request.data
      try {
        request.data = normalizeTransactionQuantities(retainedData) as TransactionData
      } catch {
        failFundingRecheck('Transaction data could not be verified. Nothing was signed.')
      }

      let normalizedGasLimit: string | undefined
      try {
        normalizedGasLimit = normalizeTransactionQuantities({ gasLimit: retainedGasLimit }).gasLimit
      } catch {
        normalizedGasLimit = undefined
      }
      const failedGasEstimate = (parseRpcQuantity(normalizedGasLimit) ?? 0n) === 0n
      if (failedGasEstimate) {
        try {
          request.data.gasLimit = await provider.estimateGas(request.data)
          request.approvals = request.approvals.filter(
            (approval) => approval.type !== ApprovalType.GasLimitApproval
          )
        } catch {
          failFundingRecheck('Gas estimate unavailable. Nothing was signed.')
        }
      } else {
        request.data.gasLimit = normalizedGasLimit as string
      }
      if (!request.feesUpdatedByUser && request.data.gasFeesSource === GasFeesSource.Frame) {
        try {
          request.data = this.pendingTransactionFeeData(currentAccount, request)
        } catch {
          log.warn('Could not refresh transaction fees during funding recheck', { handlerId })
        }
      }
      const chainId = Number(parseRpcQuantity(request.data.chainId))
      if (Number.isSafeInteger(chainId) && chainId > 0 && chainUsesOptimismFees(chainId)) {
        if (await this.refreshTransactionL1Fee(request)) currentAccount.update()
      }
      request.locked = true
      try {
        await provider.assertTransactionFunding(request)
      } catch (error) {
        if (isTransactionFundingError(error)) {
          request.notice = error.message
          request.recoverableError = {
            code: error.code,
            message: error.message,
            ...(error.data === undefined ? {} : { data: error.data })
          }
          currentAccount.update()
        }
        throw error
      }
    }

    this.clearPendingNonceAdjustment(currentAccount, handlerId)
    this.restoreRequestedNonce(request)
    delete request.locked
    delete request.status
    delete request.notice
    delete request.recoverableError
    delete request.retainedPreBroadcastError
    delete request.signingProgress
    request.mode = RequestMode.Normal
    currentAccount.refreshTransactionSimulation(request, true, false)
    return true
  }

  closeFailedTransaction(handlerId: string, accountId: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    const request = currentAccount?.getActiveReviewRequest<TransactionRequest>(handlerId)
    if (
      !currentAccount ||
      !request ||
      request.type !== 'transaction' ||
      request.status !== RequestStatus.Error ||
      !request.retainedPreBroadcastError
    ) {
      throw new Error('Failed transaction request is no longer available')
    }

    const retainedFailure = request.retainedPreBroadcastError
    const recoverableFailure = request.recoverableError
    if (retainedFailure.responderPending) {
      if (!recoverableFailure) {
        throw new Error('Failed transaction response is no longer available')
      }
      currentAccount.rejectRequest(request, {
        code: -32603,
        message: recoverableFailure.message,
        data: {
          reason: recoverableFailure.code,
          ...(recoverableFailure.data === undefined ? {} : { evidence: recoverableFailure.data })
        }
      })
    } else {
      currentAccount.clearRequest(handlerId)
    }
    return true
  }

  setTxSigned(handlerId: string, cb: Callback<void>, accountId?: string) {
    log.info('setTxSigned', handlerId)

    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return cb(new Error('No valid request for ' + handlerId))

    if (currentAccount.requests[handlerId]) {
      if (
        currentAccount.requests[handlerId].status === RequestStatus.Declined ||
        currentAccount.requests[handlerId].status === RequestStatus.Error
      ) {
        cb(new Error('Request already declined'))
      } else {
        const transaction = currentAccount.requests[handlerId]
        if (!transaction.activityId)
          return cb(new Error('Transaction is missing its durable activity identity'))
        try {
          this.reserveOperationLifecycleAdmission(transaction.activityId)
        } catch (error) {
          return cb(
            error instanceof Error ? error : new Error('Transaction monitoring capacity is unavailable')
          )
        }
        currentAccount.requests[handlerId].status = RequestStatus.Sending
        currentAccount.requests[handlerId].notice = 'Sending'
        this.setTransactionSigningProgress(currentAccount.id, handlerId, 'sending')
        currentAccount.update()
        cb(null)
      }
    } else {
      cb(new Error('No valid request for ' + handlerId))
    }
  }

  admitTxBroadcast(
    handlerId: string,
    hash: string,
    accountId: string,
    approvedContext: TransactionSubmissionContext
  ) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    const request = currentAccount?.getRequest<TransactionRequest>(handlerId)
    if (
      request?.type !== 'transaction' ||
      request.status !== RequestStatus.Sending ||
      request.activityId !== approvedContext.activityId ||
      approvedContext.handlerId !== handlerId ||
      approvedContext.account !== accountId.toLowerCase()
    ) {
      return false
    }
    return this.admitTransactionLifecycle(approvedContext, hash, 'broadcasting')?.admitted === true
  }

  startTxBroadcastMonitoring(context: TransactionSubmissionContext) {
    const operation = operationLifecycleLedger.listStored().find(({ id }) => id === context.activityId)
    if (!operation?.broadcast || operation.kind !== 'transaction') return false
    this.reconcileTransactionLifecycle(operation, true)
    return true
  }

  cancelTxBroadcastAdmission(context: TransactionSubmissionContext, hash: string) {
    const operation = operationLifecycleLedger.listStored().find(({ id }) => id === context.activityId)
    if (
      !operation ||
      operation.broadcast?.phase !== 'broadcasting' ||
      !this.transactionLifecycleMatches(operation, context, hash)
    ) {
      return false
    }
    operationLifecycleRuntime.release(operation.id)
    recentRecipientsRuntime.forget(operation.id)
    const removed = operationLifecycleLedger.remove(operation.id, -1)
    operationLifecycleLedger.releaseReservation(operation.id)
    return removed
  }

  setTxSent(
    handlerId: string,
    hash: string,
    accountId?: string,
    approvedContext?: TransactionSubmissionContext
  ) {
    log.info('setTxSent', handlerId, 'Hash', hash)

    let currentAccount: FrameAccount | undefined
    try {
      currentAccount = this.requestAccount(handlerId, accountId)
    } catch {
      if (!approvedContext) return false
    }
    const request = currentAccount?.requests[handlerId]
    const context =
      approvedContext ||
      (request?.type === 'transaction' ? this.transactionSubmissionContextFor(handlerId, request) : undefined)
    const expectedAccount = (accountId || currentAccount?.id || '').toLowerCase()
    if (!context || context.handlerId !== handlerId || context.account !== expectedAccount) {
      return false
    }
    const lifecycle = this.admitTransactionLifecycle(context, hash, 'acknowledged')
    if (!lifecycle) return false
    const lateAcknowledgement =
      currentAccount &&
      request?.type === 'transaction' &&
      request.activityId === context.activityId &&
      request.status === RequestStatus.Verifying &&
      request.submission?.status === 'unconfirmed' &&
      request.tx?.hash === hash.toLowerCase()
    const sendingRequest =
      currentAccount &&
      request?.type === 'transaction' &&
      request.activityId === context.activityId &&
      request.status === RequestStatus.Sending
    const transitioned = Boolean(lateAcknowledgement || sendingRequest)

    if (lateAcknowledgement) {
      try {
        delete request.submission
        request.notice = 'Verifying'
        currentAccount?.update()
      } catch (error) {
        log.warn('Submitted transaction request projection could not be updated', {
          handlerId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    } else if (sendingRequest) {
      try {
        request.status = RequestStatus.Verifying
        request.notice = 'Verifying'
        request.mode = RequestMode.Monitor
        request.tx = { hash: hash.toLowerCase(), confirmations: 0 }
        recordRequestActivity(request, 'submitted')
        currentAccount?.update()
      } catch (error) {
        log.warn('Submitted transaction request projection could not be updated', {
          handlerId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (transitioned && currentAccount) {
      try {
        currentAccount.releaseRequestReviewIfQueued(handlerId)
      } catch (error) {
        log.warn('Submitted transaction review queue could not be released cleanly', {
          handlerId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    this.reconcileTransactionLifecycle(lifecycle.operation, lifecycle.admitted)
    return true
  }

  setTxSubmissionUnclear(
    handlerId: string,
    hash: string,
    accountId?: string,
    approvedContext?: TransactionSubmissionContext
  ) {
    let currentAccount: FrameAccount | undefined
    try {
      currentAccount = this.requestAccount(handlerId, accountId)
    } catch {
      if (!approvedContext) return false
    }
    const request = currentAccount?.requests[handlerId]
    const context =
      approvedContext ||
      (request?.type === 'transaction' ? this.transactionSubmissionContextFor(handlerId, request) : undefined)
    const expectedAccount = (accountId || currentAccount?.id || '').toLowerCase()
    if (!context || context.handlerId !== handlerId || context.account !== expectedAccount) {
      return false
    }
    const lifecycle = this.admitTransactionLifecycle(context, hash, 'unconfirmed')
    if (!lifecycle) return false

    const transitioned = Boolean(
      currentAccount &&
      request?.type === 'transaction' &&
      request.activityId === context.activityId &&
      request.status === RequestStatus.Sending
    )
    if (transitioned && currentAccount && request?.type === 'transaction') {
      try {
        request.status = RequestStatus.Verifying
        request.notice = 'Submission unconfirmed; checking network'
        request.mode = RequestMode.Monitor
        request.submission = Object.freeze({
          status: 'unconfirmed',
          detail: 'Wren attempted one broadcast, but the RPC response was not confirmed.'
        })
        request.tx = { hash: hash.toLowerCase(), confirmations: 0 }
        recordRequestActivity(request, 'submitted')
        currentAccount.update()
      } catch (error) {
        log.warn('Unconfirmed transaction request projection could not be updated', {
          handlerId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    if (transitioned && currentAccount) {
      try {
        currentAccount.releaseRequestReviewIfQueued(handlerId)
      } catch (error) {
        log.warn('Unconfirmed transaction review queue could not be released cleanly', {
          handlerId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    this.reconcileTransactionLifecycle(lifecycle.operation, lifecycle.admitted)
    return true
  }

  setRequestSuccess(handlerId: string, accountId?: string) {
    log.info('setRequestSuccess', handlerId)

    const currentAccount = this.requestAccount(handlerId, accountId)
    if (currentAccount && currentAccount.requests[handlerId]) {
      if (currentAccount.requests[handlerId].status !== RequestStatus.Pending) return false
      currentAccount.requests[handlerId].status = RequestStatus.Success
      currentAccount.requests[handlerId].notice = 'Successful'
      if (currentAccount.requests[handlerId].type === 'transaction') {
        currentAccount.requests[handlerId].mode = RequestMode.Monitor
      } else {
        setTimeout(
          () => this.accounts[currentAccount.address] && this.removeRequest(currentAccount, handlerId),
          3300
        )
      }

      currentAccount.update()
      if (currentAccount.requests[handlerId].type === 'transaction') {
        currentAccount.releaseRequestReview(handlerId)
      }
      return true
    }

    return false
  }

  clearRequests(address: string) {
    if (!address) return
    this.accounts[address.toLowerCase()]?.clearRequests()
  }

  rejectUnapprovedRequestsForOriginChain(origin: string, chainId: number, exceptHandlerId?: string) {
    Object.values(this.accounts).forEach((account) => {
      account.rejectUnapprovedRequestsForOriginChain(origin, chainId, exceptHandlerId)
    })
  }

  rejectUnapprovedRequestsForOrigins(accountId: string, origins: readonly string[]) {
    const account = this.accounts[accountId.toLowerCase()]
    if (!account || origins.length === 0) return false

    account.rejectUnapprovedRequestsForOrigins(origins)
    return true
  }

  remove(address = '') {
    return this.removeMany([address])
  }

  removeMany(addresses: readonly string[]) {
    const normalizedAddresses = [
      ...new Set(addresses.map((address) => address.toLowerCase()).filter(Boolean))
    ]
    const removedAddresses = normalizedAddresses.filter((address) => this.accounts[address])
    const removalSet = new Set(normalizedAddresses)
    const selectedAddress = this._current?.toLowerCase()
    const removesSelected = Boolean(selectedAddress && removalSet.has(selectedAddress))
    const replacement = removesSelected
      ? Object.values(this.accounts).find((account) => !removalSet.has(account.address))
      : undefined

    normalizedAddresses.forEach((address) => {
      const account = this.accounts[address]
      if (account) {
        try {
          account.clearRequests()
        } catch (error) {
          log.warn('Could not notify every request before removing an account', error)
        }
      }

      requireStoreAction('removeAccount')(address)

      if (account) {
        this.clearPendingNonceAdjustmentsForAccount(account)
        account.close()
      }
      delete this.accounts[address]
    })

    if (removesSelected) {
      if (replacement) {
        replacement.active = true
        replacement.update()
        requireStoreAction('setAccount')(replacement.summary())
        this._current = replacement.id
        replacement.presentActiveRequest()
      } else {
        requireStoreAction('removeSelectedAccount')()
        this._current = ''
      }
    }

    return removedAddresses
  }

  removeAccountsForSigner(
    signerId: string,
    signerAddresses: readonly string[] = [],
    retainedSignerAddresses: readonly string[] = []
  ) {
    return this.removeMany(this.accountsForSignerRemoval(signerId, signerAddresses, retainedSignerAddresses))
  }

  accountsForSignerRemoval(
    signerId: string,
    signerAddresses: readonly string[] = [],
    retainedSignerAddresses: readonly string[] = []
  ) {
    const signerAccountIds = new Set(signerAddresses.map((address) => address.toLowerCase()))
    const retainedAccountIds = new Set(retainedSignerAddresses.map((address) => address.toLowerCase()))
    return Object.values(this.accounts)
      .filter((account) => {
        const address = account.address.toLowerCase()
        return (
          !retainedAccountIds.has(address) && (account.signer === signerId || signerAccountIds.has(address))
        )
      })
      .map((account) => account.address)
  }

  private requiredQuantity(value: unknown, field: string) {
    const quantity = parseRpcQuantity(value)
    if (quantity === undefined) throw new Error(`Invalid ${field}`)
    return quantity
  }

  private limitedQuantity(value: bigint, maximum: bigint) {
    return value > maximum ? maximum : value
  }

  private maxFeePerGasFor(gasLimit: bigint, tx: TransactionData) {
    return gasLimit === 0n ? MAX_UINT256 : maxFee(tx) / gasLimit
  }

  private txFeeUpdate(inputValue: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const input = this.requiredQuantity(inputValue, 'fee update value')

    const selectedAccount = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (!selectedAccount) throw new Error('No account selected while setting base fee')

    const currentAccount = accountId ? this.requestAccount(handlerId, accountId) : selectedAccount
    if (!currentAccount) throw new Error('Could not find transaction request')

    const request = this.getTransactionRequest(currentAccount, handlerId)
    if (!request || request.type !== 'transaction')
      throw new Error(`Could not find transaction request with handlerId ${handlerId}`)
    if (userUpdate && !currentAccount.getActiveReviewRequest(handlerId)) {
      throw new Error('Request is waiting for review')
    }
    if (request.locked) throw new Error('Request has already been approved by the user')
    if (request.feesUpdatedByUser && !userUpdate) throw new Error('Fee has been updated by user')

    const tx = request.data
    const gasLimit = this.requiredQuantity(tx.gasLimit, 'transaction gas limit')
    const txType = tx.type
    const baseFeeTransaction = usesBaseFee(tx)

    if (baseFeeTransaction) {
      const maxFeePerGas = this.requiredQuantity(tx.maxFeePerGas, 'transaction max fee per gas')
      const maxPriorityFeePerGas = this.requiredQuantity(
        tx.maxPriorityFeePerGas,
        'transaction max priority fee per gas'
      )
      if (maxPriorityFeePerGas > maxFeePerGas) throw new Error('Priority fee exceeds max fee per gas')
      const currentBaseFee = maxFeePerGas - maxPriorityFeePerGas
      return {
        currentAccount,
        input,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit,
        currentBaseFee,
        baseFeeTransaction,
        txType,
        gasPrice: 0n
      }
    } else {
      const gasPrice = this.requiredQuantity(tx.gasPrice, 'transaction gas price')
      return {
        currentAccount,
        input,
        gasPrice,
        gasLimit,
        baseFeeTransaction,
        txType,
        currentBaseFee: 0n,
        maxPriorityFeePerGas: 0n,
        maxFeePerGas: 0n
      }
    }
  }

  private completeTxFeeUpdate(currentAccount: FrameAccount, handlerId: string, userUpdate: boolean) {
    const txRequest = this.getTransactionRequest(currentAccount, handlerId)

    if (userUpdate) txRequest.feesUpdatedByUser = true

    currentAccount.refreshTransactionSimulation(txRequest, userUpdate, !userUpdate)
  }

  private updateEip7702Fee(
    kind: 'baseFee' | 'priorityFee' | 'gasLimit',
    value: string,
    handlerId: string,
    accountId?: string
  ) {
    const input = this.requiredQuantity(value, 'EIP-7702 fee update value')
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (!account) throw new Error('No account selected while updating EIP-7702 fees')
    const request = account.getActiveReviewRequest<Eip7702RevokeRequest>(handlerId)
    if (!request || request.type !== 'eip7702Revoke') throw new Error('Request is waiting for review')
    if (request.locked || request.status !== undefined) {
      throw new Error('EIP-7702 revocation has already been approved')
    }

    const gasLimit = BigInt(request.fees.gasLimit)
    const maxFeePerGas = BigInt(request.fees.maxFeePerGas)
    const priorityFee = BigInt(request.fees.maxPriorityFeePerGas)
    if (priorityFee > maxFeePerGas) throw new Error('Invalid reviewed EIP-7702 fees')
    const chainFeeCap = maxFee({ chainId: request.chainId } as TransactionData)

    let nextGasLimit = gasLimit
    let nextMaxFeePerGas = maxFeePerGas
    let nextPriorityFee = priorityFee
    if (kind === 'gasLimit') {
      if (input < EIP7702_REVOKE_INTRINSIC_GAS) {
        throw new Error('EIP-7702 gas limit is below the intrinsic minimum')
      }
      const affordableGas = maxFeePerGas === 0n ? MAX_GAS_LIMIT : chainFeeCap / maxFeePerGas
      nextGasLimit = this.limitedQuantity(input, this.limitedQuantity(MAX_GAS_LIMIT, affordableGas))
      if (nextGasLimit < EIP7702_REVOKE_INTRINSIC_GAS) {
        throw new Error('EIP-7702 fees exceed the account safety cap')
      }
    } else {
      const perGasCap = this.limitedQuantity(MAX_FEE_PER_GAS, chainFeeCap / gasLimit)
      if (kind === 'baseFee') {
        nextPriorityFee = this.limitedQuantity(priorityFee, perGasCap)
        nextMaxFeePerGas = nextPriorityFee + this.limitedQuantity(input, perGasCap - nextPriorityFee)
      } else {
        const baseFee = maxFeePerGas - priorityFee
        const limitedBaseFee = this.limitedQuantity(baseFee, perGasCap)
        nextPriorityFee = this.limitedQuantity(input, perGasCap - limitedBaseFee)
        nextMaxFeePerGas = limitedBaseFee + nextPriorityFee
      }
      if (nextMaxFeePerGas === 0n) throw new Error('EIP-7702 maximum fee must be nonzero')
    }

    this.cancelEip7702Operation(account.id, handlerId)
    request.fees = {
      gasLimit: toRpcQuantity(nextGasLimit),
      maxFeePerGas: toRpcQuantity(nextMaxFeePerGas),
      maxPriorityFeePerGas: toRpcQuantity(nextPriorityFee),
      maxFee: toRpcQuantity(nextGasLimit * nextMaxFeePerGas)
    }
    request.feesUpdatedByUser = true
    account.update()
    return request.fees
  }

  setBaseFee(baseFee: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (account?.getRequest<Eip7702RevokeRequest>(handlerId)?.type === 'eip7702Revoke') {
      if (!userUpdate) return
      this.updateEip7702Fee('baseFee', baseFee, handlerId, accountId)
      return
    }
    const { currentAccount, input, maxPriorityFeePerGas, gasLimit, currentBaseFee, baseFeeTransaction } =
      this.txFeeUpdate(baseFee, handlerId, userUpdate, accountId)
    if (!baseFeeTransaction) throw new Error('Cannot set a base fee on a legacy transaction')

    // New value
    const newBaseFee = this.limitedQuantity(input, MAX_FEE_PER_GAS)

    // No change
    if (newBaseFee === currentBaseFee) return

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const tx = txRequest.data

    // New max fee per gas
    const perGasCap = this.maxFeePerGasFor(gasLimit, tx)
    const limitedPriorityFee = this.limitedQuantity(maxPriorityFeePerGas, perGasCap)
    const limitedBaseFee = this.limitedQuantity(newBaseFee, perGasCap - limitedPriorityFee)
    tx.maxPriorityFeePerGas = toRpcQuantity(limitedPriorityFee)
    tx.maxFeePerGas = toRpcQuantity(limitedBaseFee + limitedPriorityFee)

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate)
  }

  setPriorityFee(priorityFee: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (account?.getRequest<Eip7702RevokeRequest>(handlerId)?.type === 'eip7702Revoke') {
      if (!userUpdate) return
      this.updateEip7702Fee('priorityFee', priorityFee, handlerId, accountId)
      return
    }
    const { currentAccount, input, maxPriorityFeePerGas, gasLimit, currentBaseFee, baseFeeTransaction } =
      this.txFeeUpdate(priorityFee, handlerId, userUpdate, accountId)
    if (!baseFeeTransaction) throw new Error('Cannot set a priority fee on a legacy transaction')

    // New values
    const newMaxPriorityFeePerGas = this.limitedQuantity(input, MAX_FEE_PER_GAS)

    // No change
    if (newMaxPriorityFeePerGas === maxPriorityFeePerGas) return

    const tx = this.getTransactionRequest(currentAccount, handlerId).data

    // New max fee per gas
    const perGasCap = this.maxFeePerGasFor(gasLimit, tx)
    const limitedBaseFee = this.limitedQuantity(currentBaseFee, perGasCap)
    const limitedPriorityFee = this.limitedQuantity(newMaxPriorityFeePerGas, perGasCap - limitedBaseFee)
    tx.maxPriorityFeePerGas = toRpcQuantity(limitedPriorityFee)
    tx.maxFeePerGas = toRpcQuantity(limitedBaseFee + limitedPriorityFee)

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate)
  }

  setGasPrice(price: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (account?.getRequest<Eip7702RevokeRequest>(handlerId)?.type === 'eip7702Revoke') {
      throw new Error('EIP-7702 revocation does not use a legacy gas price')
    }
    const { currentAccount, input, gasLimit, gasPrice, baseFeeTransaction } = this.txFeeUpdate(
      price,
      handlerId,
      userUpdate,
      accountId
    )
    if (baseFeeTransaction) throw new Error('Cannot set a gas price on an EIP-1559 transaction')

    // New values
    const newGasPrice = this.limitedQuantity(input, MAX_FEE_PER_GAS)

    // No change
    if (newGasPrice === gasPrice) return

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const tx = txRequest.data
    tx.gasPrice = toRpcQuantity(this.limitedQuantity(newGasPrice, this.maxFeePerGasFor(gasLimit, tx)))

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate)
  }

  setGasLimit(limit: string, handlerId: string, userUpdate: boolean, accountId?: string) {
    const account = accountId ? this.accounts[accountId.toLowerCase()] : this.current()
    if (account?.getRequest<Eip7702RevokeRequest>(handlerId)?.type === 'eip7702Revoke') {
      if (!userUpdate) return
      this.updateEip7702Fee('gasLimit', limit, handlerId, accountId)
      return
    }
    const { currentAccount, input, maxFeePerGas, gasPrice, baseFeeTransaction } = this.txFeeUpdate(
      limit,
      handlerId,
      userUpdate,
      accountId
    )

    // New values
    const newGasLimit = this.limitedQuantity(input, MAX_GAS_LIMIT)

    const txRequest = this.getTransactionRequest(currentAccount, handlerId)
    const tx = txRequest.data
    const fee = baseFeeTransaction ? maxFeePerGas : gasPrice
    const feeLimitedGas = fee === 0n ? MAX_GAS_LIMIT : maxFee(tx) / fee
    tx.gasLimit = toRpcQuantity(this.limitedQuantity(newGasLimit, feeLimitedGas))

    // Complete update
    this.completeTxFeeUpdate(currentAccount, handlerId, userUpdate)
  }

  adjustNonce(handlerId: string, nonceAdjust: number, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)

    if (nonceAdjust !== 1 && nonceAdjust !== -1) return log.error('Invalid nonce adjustment', nonceAdjust)
    if (!currentAccount) return log.error('No account selected during nonce adjustement', nonceAdjust)
    if (!currentAccount.getActiveReviewRequest(handlerId)) {
      return log.warn('Ignoring nonce adjustment for a queued transaction request')
    }

    const txRequest = this.mutableTransactionRequest(currentAccount, handlerId)
    if (!txRequest) return log.warn('Ignoring nonce adjustment for immutable transaction request')

    txRequest.data = Object.assign({}, txRequest.data)

    const nonce = txRequest.data.nonce
    if (nonce) {
      const parsedNonce = parseRpcQuantity(nonce)
      if (parsedNonce === undefined) return log.warn('Ignoring adjustment for invalid transaction nonce')

      let updatedNonce = parsedNonce + BigInt(nonceAdjust)
      if (updatedNonce < 0n) updatedNonce = 0n
      if (updatedNonce > MAX_UINT256) updatedNonce = MAX_UINT256
      txRequest.data.nonce = toRpcQuantity(updatedNonce)
      currentAccount.refreshTransactionSimulation(txRequest)
      return
    }

    const key = this.nonceAdjustmentKey(currentAccount, handlerId)
    const pending = this.pendingNonceAdjustments.get(key)
    if (pending && pending.account === currentAccount && pending.request === txRequest) {
      pending.adjustments.push(nonceAdjust)
      return
    }

    const adjustment: PendingNonceAdjustment = {
      account: currentAccount,
      request: txRequest,
      adjustments: [nonceAdjust]
    }
    this.pendingNonceAdjustments.set(key, adjustment)

    const { from, chainId } = txRequest.data
    this.sendRequest(
      { method: 'eth_getTransactionCount', chainId, params: [from, 'pending'] },
      (res: RPCResponsePayload) => {
        if (this.pendingNonceAdjustments.get(key) !== adjustment) return
        this.pendingNonceAdjustments.delete(key)

        if (
          this.accounts[currentAccount.id] !== currentAccount ||
          this.mutableTransactionRequest(currentAccount, handlerId) !== txRequest ||
          currentAccount.getActiveReviewRequest(handlerId) !== txRequest
        ) {
          return
        }

        const parsedNonce = parseRpcQuantity(res.result)
        if (parsedNonce === undefined) return

        let updatedNonce = parsedNonce
        adjustment.adjustments.forEach((value, index) => {
          if (index > 0 || value === -1) updatedNonce += BigInt(value)
          if (updatedNonce < 0n) updatedNonce = 0n
          if (updatedNonce > MAX_UINT256) updatedNonce = MAX_UINT256
        })
        txRequest.data.nonce = toRpcQuantity(updatedNonce)
        currentAccount.refreshTransactionSimulation(txRequest)
      }
    )
  }

  resetNonce(handlerId: string, accountId?: string) {
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (!currentAccount) return log.error('No account selected during nonce reset')
    if (!currentAccount.getActiveReviewRequest(handlerId)) {
      return log.warn('Ignoring nonce reset for a queued transaction request')
    }

    const txRequest = this.mutableTransactionRequest(currentAccount, handlerId)
    if (!txRequest) return log.warn('Ignoring nonce reset for immutable transaction request')

    this.clearPendingNonceAdjustment(currentAccount, handlerId)
    this.restoreRequestedNonce(txRequest)
    currentAccount.refreshTransactionSimulation(txRequest)
  }

  lockRequest(handlerId: string, accountId?: string) {
    // When a request is approved, lock it so that no automatic updates such as fee changes can happen
    const currentAccount = this.requestAccount(handlerId, accountId)
    if (currentAccount && currentAccount.requests[handlerId]) {
      this.clearPendingNonceAdjustment(currentAccount, handlerId)
      ;(currentAccount.requests[handlerId] as TransactionRequest).locked = true
    } else {
      log.error('Trying to lock request ' + handlerId + ' but there is no current account')
    }
  }

  // removeAllAccounts () {
  //   setTimeout(() => {
  //     Object.keys(this.accounts).forEach(id => {
  //       if (this.accounts[id]) this.accounts[id].close()
  //       store.removeAccount(id)
  //       delete this.accounts[id]
  //     })
  //   }, 1000)
  // }
}

export default new Accounts()
