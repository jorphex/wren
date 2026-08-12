import log from 'electron-log'
import { randomUUID } from 'crypto'
import { isValidAddress } from '@ethereumjs/util'

import {
  AccessRequest,
  AccountRequest,
  Accounts,
  AddTokenRequest,
  RequestMode,
  SignTypedDataRequest,
  TransactionRequest,
  WalletCallsRequest
} from '..'
import nebulaApi from '../../nebula'
import signers from '../../signers'
import windows from '../../windows'
import nav from '../../windows/nav'
import store from '../../store'
import { requireStoreAction } from '../../store/action'
import { recordRequestActivity, type ActivityOutcome } from '../../activity'
import { TransactionData } from '../../../resources/domain/transaction'
import { MAX_UINT256, parseRpcQuantity } from '../../../resources/domain/transaction/quantity'
import { isBroadTokenAuthorityEffect } from '../../../resources/domain/transaction/effects'
import {
  effectReportsBroadTokenAuthorityIntent,
  parseBroadTokenAuthorityIntent
} from '../../../resources/domain/transaction/approvalRisk'
import {
  Type as SignerType,
  WATCH_ONLY_SIGNING_ERROR,
  getAccountSignerType,
  getSignerType,
  isSignerReady,
  isWatchOnlyAccountType,
  type AccountSignerType
} from '../../../resources/domain/signer'

import provider from '../../provider'
import { ApprovalType } from '../../../resources/constants'
import { parseTokenBaseUnitAmount } from '../../../resources/domain/token/amount'
import { requiredSignatureRisks } from '../../../resources/domain/signature/risk'

import reveal from '../../reveal'
import { isTransactionRequest, isTypedMessageSignatureRequest } from '../../../resources/domain/request'
import Erc20Contract from '../../contracts/erc20'
import {
  assertAccountCodeEvidenceStable,
  inspectTransactionAccountCode,
  simulateTransaction,
  simulateWalletCalls
} from '../../transaction/simulation'
import { snapshotWalletCalls } from '../../provider/walletCallExecution'
import { prepareWalletCallBatch } from '../../provider/walletCallPreparation'
import {
  snapshotWalletCallBatchAdjustment,
  type WalletCallBatchAdjustment
} from '../../provider/walletCallAdjustment'
import {
  snapshotPreparedWalletCallExecutionInput,
  type PreparedWalletCallExecutionSnapshot
} from '../../provider/walletCallPreparedExecution'

import type {
  ApprovalData,
  AnyAccountRequest,
  PermitSignatureRequest,
  SignatureRequest,
  SignRequest,
  TypedMessage,
  WalletCallsResponder
} from '../types'
import type { Breadcrumb } from '../../windows/nav/breadcrumb'
import { RequestStatus } from '../types'
import type {
  TransactionAccountCodeEvidence,
  TransactionSimulation,
  WalletCallsSimulationResult
} from '../../transaction/simulation'
import type Signer from '../../signers/Signer'
import { parseErc20ApprovalIntent } from '../../../resources/domain/transaction/allowance'
import { getRequestSignal } from '../../provider/requestSignal'
import { applyPermissionAction } from '../../provider/permissionEvents'
import { notificationByOwner, requestNotificationOwner } from '../../../resources/store/notifications'

const nebula = nebulaApi()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

interface SignerOptions {
  type?: string
}

type ManagedApprovalRequest = TransactionRequest | SignatureRequest

interface AccountOptions {
  address?: Address
  name: string
  ensName?: string
  created?: string
  lastSignerType?: string
  active: boolean
  options: SignerOptions
}

type WalletCallsPreparationSnapshot = Readonly<{
  account: string
  chainId: string
  calls: Readonly<ReturnType<typeof snapshotWalletCalls>>
  adjustment?: Readonly<WalletCallBatchAdjustment>
}>

type AccountCodeSnapshot = Readonly<{ codeAddress?: string; fingerprint: string }>

function accountCodeSnapshot(
  simulation: { status: string; accountCodeEvidence?: TransactionAccountCodeEvidence } | undefined,
  target: string,
  callIndex: number
): AccountCodeSnapshot {
  const evidence = simulation?.accountCodeEvidence
  if (!evidence) return Object.freeze({ codeAddress: target, fingerprint: `legacy:${target.toLowerCase()}` })
  const targetEvidence = evidence.targets.find(
    (candidate) => candidate.account === target.toLowerCase() && candidate.callIndexes.includes(callIndex)
  )
  const fingerprint = JSON.stringify(
    targetEvidence
      ? {
          account: targetEvidence.account,
          status: targetEvidence.status,
          ...('codeHash' in targetEvidence ? { codeHash: targetEvidence.codeHash } : {}),
          ...('delegate' in targetEvidence ? { delegate: targetEvidence.delegate } : {}),
          ...('delegateCodeStatus' in targetEvidence
            ? { delegateCodeStatus: targetEvidence.delegateCodeStatus }
            : {}),
          ...('delegateCodeHash' in targetEvidence && targetEvidence.delegateCodeHash
            ? { delegateCodeHash: targetEvidence.delegateCodeHash }
            : {})
        }
      : { account: target.toLowerCase(), status: 'missing' }
  )
  if (targetEvidence?.status === 'contract') {
    return Object.freeze({ codeAddress: target, fingerprint })
  }
  if (targetEvidence?.status === 'delegated' && targetEvidence.delegateCodeStatus === 'contract') {
    return Object.freeze({ codeAddress: targetEvidence.delegate, fingerprint })
  }
  return Object.freeze({ fingerprint })
}

class FrameAccount {
  id: Address
  address: Address
  name: string
  ensName: string | undefined
  created: string

  lastSignerType: AccountSignerType
  signer: string
  signerStatus: string

  accounts: Accounts
  requests: Record<string, AnyAccountRequest> = {}
  private simulationVersions: Record<string, number> = {}
  private simulationTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  private preparationVersions: Record<string, number> = {}
  private preparationTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  private requestAbortCleanup: Record<string, () => void> = {}
  private nextRequestQueueIndex = 0
  private activeReviewHandlerId: string | undefined
  private requestPresentationDeferrals = 0

  accountObserver: Observer
  private ensLookupInFlight = false
  private ensLookupClosed = false
  private readonly ensStatusHandler = (status: string) => {
    if (status.toLowerCase() === 'connected') void this.lookupAddress()
  }

  status = 'ok'
  active = false

  constructor(params: AccountOptions, accounts: Accounts) {
    const { lastSignerType, name, ensName, created, address, active, options = {} } = params
    this.accounts = accounts // Parent Accounts Module

    const formattedAddress = (address && address.toLowerCase()) || '0x'
    this.id = formattedAddress // Account ID
    this.address = formattedAddress
    this.lastSignerType = getAccountSignerType(lastSignerType || options.type)

    this.active = active
    this.name = name
    this.ensName = ensName

    this.created = created || `new:${Date.now()}`

    this.signer = '' // Matched Signer ID
    this.signerStatus = ''

    this.update()

    this.accountObserver = store.observer(() => {
      // When signer data changes in any way this will rerun to make sure we're matched correctly
      const updatedSigner = this.findSigner(this.address)

      if (updatedSigner) {
        if (this.signer !== updatedSigner.id || this.signerStatus !== updatedSigner.status) {
          this.signer = updatedSigner.id
          const signerType = getSignerType(updatedSigner.type)

          this.lastSignerType = signerType || this.lastSignerType
          this.signerStatus = updatedSigner.status

          if (updatedSigner.status === 'ok' && this.id === this.accounts._current) {
            this.verifyAddress(false, (err, verified) => {
              if (!err && !verified) this.signer = ''
            })
          }
        }
      } else {
        this.signer = ''
      }

      this.update()
    }, `account:${this.address}`)

    if (this.created.split(':')[0] === 'new') {
      provider.on('connect', () => {
        provider.send(
          {
            jsonrpc: '2.0',
            id: 1,
            chainId: '0x1',
            method: 'eth_blockNumber',
            _origin: 'frame-internal',
            params: []
          },
          (response: RPCResponsePayload) => {
            const blockNumber = parseRpcQuantity(response.result)
            if (blockNumber !== undefined)
              this.created = blockNumber.toString(10) + ':' + this.created.split(':')[1]
            this.update()
          }
        )
      })
    }

    provider.on('status:ethereum:1', this.ensStatusHandler)

    if (nebula.ready()) {
      void this.lookupAddress()
    } else {
      nebula.once('ready', this.lookupAddress.bind(this))
    }

    this.update()
  }

  async lookupAddress() {
    if (this.ensLookupClosed || this.ensLookupInFlight) return
    this.ensLookupInFlight = true

    try {
      const ensName = (await nebula.ens.reverseLookup(this.address))[0] || ''
      if (!this.ensLookupClosed && ensName !== this.ensName) {
        this.ensName = ensName
        this.update()
      }
    } catch (e) {
      log.error('lookupAddress Error:', e)
    } finally {
      this.ensLookupInFlight = false
    }
  }

  findSigner(address: Address) {
    const signers = store('main.signers') as Record<string, Signer>

    const signerOrdinal = (signer: Signer) => {
      const signerIndex = Object.values(SignerType).findIndex((type) => type === signer.type)
      const typeIndex = Math.max(signerIndex, 0)

      return (isSignerReady(signer) ? 1 : 0) * 100 + typeIndex
    }

    const availableSigners = Object.values(signers)
      .filter((signer) => signer.addresses.some((addr) => addr.toLowerCase() === address))
      .sort((a, b) => signerOrdinal(b) - signerOrdinal(a))

    return availableSigners[0]
  }

  setAccess(req: AccessRequest, access: boolean) {
    const { origin, account } = req
    if (account.toLowerCase() === this.address) {
      // Permissions do no live inside the account summary
      applyPermissionAction(
        this.address,
        () => {
          if (access) requireStoreAction('setPermission')(this.address, req.permission)
        },
        this.accounts,
        provider,
        [origin]
      )
    }

    this.resolveRequest(req)
  }

  getRequest<T extends AccountRequest>(id: string) {
    return this.requests[id] as unknown as T
  }

  getActiveReviewRequest<T extends AccountRequest>(handlerId: string) {
    if (this.activeReviewHandlerId !== handlerId) return undefined
    return this.requests[handlerId] as T | undefined
  }

  resolveRequest({ handlerId }: AccountRequest, result?: unknown) {
    const knownRequest = this.requests[handlerId]

    if (knownRequest) {
      const payload = knownRequest.payload
      const responder = knownRequest.res
      try {
        this.clearRequest(knownRequest.handlerId, 'completed')
      } finally {
        if (responder && payload) {
          const { id, jsonrpc } = payload
          responder({ id, jsonrpc, result })
        }
      }
    }
  }

  rejectRequest({ handlerId }: AccountRequest, error: EVMError) {
    const knownRequest = this.requests[handlerId]

    if (knownRequest) {
      const payload = knownRequest.payload
      const responder = knownRequest.res
      try {
        this.clearRequest(knownRequest.handlerId, error.code === 4001 ? 'declined' : 'failed')
      } finally {
        if (responder && payload) {
          const { id, jsonrpc } = payload
          responder({ id, jsonrpc, error })
        }
      }
    }
  }

  clearRequest(handlerId: string, outcome?: ActivityOutcome) {
    log.info(`clearRequest(${handlerId}) for account ${this.id}`)

    const clearedActiveReview = this.activeReviewHandlerId === handlerId
    const request = this.requests[handlerId]
    if (request) recordRequestActivity(request, outcome)
    this.accounts.clearPendingNonceAdjustment?.(this, handlerId)
    this.accounts.cancelEip7702Operation?.(this.id, handlerId)
    this.requestAbortCleanup[handlerId]?.()
    delete this.requestAbortCleanup[handlerId]
    delete this.requests[handlerId]
    delete this.simulationVersions[handlerId]
    clearTimeout(this.simulationTimers[handlerId])
    delete this.simulationTimers[handlerId]
    delete this.preparationVersions[handlerId]
    clearTimeout(this.preparationTimers[handlerId])
    delete this.preparationTimers[handlerId]
    const notificationQueue = store('view.notifyQueue')
    const notification = notificationByOwner(
      Array.isArray(notificationQueue) ? notificationQueue : [],
      requestNotificationOwner(this.id, handlerId)
    )
    if (notification) {
      requireStoreAction('notify')('', {}, { expectedId: notification.id })
    }
    requireStoreAction('navClearReq')(this.id, handlerId, Object.keys(this.requests).length > 0)

    if (clearedActiveReview) {
      this.activeReviewHandlerId = undefined
      if (this.requestPresentationDeferrals === 0) this.presentNextRequest(false)
    }

    this.update()
  }

  private deferRequestPresentation(action: () => void) {
    this.requestPresentationDeferrals += 1
    try {
      action()
    } finally {
      this.requestPresentationDeferrals -= 1
      if (this.requestPresentationDeferrals === 0 && !this.activeReviewHandlerId) {
        this.presentNextRequest(false)
        this.update()
      }
    }
  }

  clearRequestsByOrigin(origin: string) {
    this.deferRequestPresentation(() => {
      Object.values(this.requests).forEach((req) => {
        if (req.origin === origin) {
          const err = { code: 4001, message: 'User rejected the request' }
          this.rejectRequest(req, err)
        }
      })
    })
  }

  rejectUnapprovedRequestsForOriginChain(origin: string, chainId: number) {
    const requestChainId = (request: AccountRequest) => {
      if (request.type === 'transaction') {
        return parseInt((request as TransactionRequest).data.chainId, 16)
      }
      if (request.type === 'sign') {
        return (request as SignRequest).data.context.requestChainId
      }
      if (request.type === 'signTypedData' || request.type === 'signErc20Permit') {
        return (request as SignTypedDataRequest).context.requestChainId
      }
      if (request.type === 'addToken') {
        return Number((request as AddTokenRequest).token.chainId)
      }
      if (request.type === 'walletCalls') {
        return parseInt((request as WalletCallsRequest).chainId, 16)
      }
      return undefined
    }

    this.deferRequestPresentation(() => {
      Object.values(this.requests).forEach((request) => {
        if (
          request.origin === origin &&
          request.status === undefined &&
          requestChainId(request) === chainId
        ) {
          this.rejectRequest(request, {
            code: 4901,
            message: `Request cancelled because the origin switched away from chain ${chainId}`
          })
        }
      })
    })
  }

  rejectUnapprovedRequestsForOrigins(origins: readonly string[]) {
    const revokedOrigins = new Set(origins)
    this.deferRequestPresentation(() => {
      Object.values(this.requests).forEach((request) => {
        if (
          revokedOrigins.has(request.origin) &&
          request.status === undefined &&
          !('locked' in request && request.locked)
        ) {
          this.rejectRequest(request, { code: 4100, message: 'Request origin access was revoked' })
        }
      })
    })
  }

  addRequiredApproval(
    req: TransactionRequest,
    type: ApprovalType,
    data: ApprovalData = {},
    onApprove: (data?: ApprovalData) => void = () => {}
  ) {
    const approve = (data?: ApprovalData) => {
      const confirmedApproval = req.approvals.find((a) => a.type === type)

      if (confirmedApproval) {
        onApprove(data)

        confirmedApproval.approved = true
        this.update()
      }
    }

    req.approvals = [
      ...(req.approvals || []),
      {
        type,
        data,
        approved: false,
        approve
      }
    ]
  }

  resError(err: string | Error, payload: RPCResponsePayload, res: RPCErrorCallback) {
    const error = typeof err === 'string' ? { message: err, code: -1 } : err

    log.error(error)

    res({ id: payload.id, jsonrpc: payload.jsonrpc, error })
  }

  private async recipientIdentity(req: TransactionRequest) {
    const { to } = req.data

    if (to) {
      // Get recipient identity
      try {
        const recipient = await reveal.identity(to)
        const knownTxRequest = this.requests[req.handlerId] as TransactionRequest

        if (recipient && knownTxRequest) {
          knownTxRequest.recipient = recipient.ens
          this.update()
        }
      } catch (e) {
        log.warn(e)
      }
    }
  }

  private async decodeCalldata(req: TransactionRequest) {
    const { to, chainId, data: calldata } = req.data
    const codeSnapshot = to ? accountCodeSnapshot(req.simulation, to, 0) : undefined
    const codeAddress = codeSnapshot?.codeAddress

    if (to && codeAddress && calldata && calldata !== '0x' && parseInt(calldata, 16) !== 0) {
      try {
        // Decode calldata
        const decodedData = await reveal.decode(to, parseInt(chainId, 16), calldata, codeAddress)

        const knownTxRequest = this.requests[req.handlerId] as TransactionRequest
        const knownCodeSnapshot = knownTxRequest
          ? accountCodeSnapshot(knownTxRequest.simulation, to, 0)
          : undefined

        if (
          knownTxRequest === req &&
          knownCodeSnapshot?.fingerprint === codeSnapshot.fingerprint &&
          decodedData
        ) {
          knownTxRequest.decodedData = decodedData
          this.update()
        }
      } catch (e) {
        log.warn(e)
      }
    }
  }

  private async recognizeActions(req: TransactionRequest) {
    const { to, chainId, data: calldata } = req.data
    const codeSnapshot = to ? accountCodeSnapshot(req.simulation, to, 0) : undefined
    const targetEvidence = req.simulation?.accountCodeEvidence?.targets.find(
      (target) => target.account === to?.toLowerCase() && target.callIndexes.includes(0)
    )
    const recognitionAllowed = !req.simulation?.accountCodeEvidence || targetEvidence?.status === 'contract'

    if (to && recognitionAllowed && calldata && calldata !== '0x' && parseInt(calldata, 16) !== 0) {
      try {
        // Recognize actions
        const actions = await reveal.recog(calldata, {
          contractAddress: to,
          chainId: parseInt(chainId, 16),
          account: this.address,
          ...(req.data.value !== undefined && { value: req.data.value })
        })

        const knownTxRequest = this.requests[req.handlerId] as TransactionRequest
        const knownTargetEvidence = knownTxRequest?.simulation?.accountCodeEvidence?.targets.find(
          (target) => target.account === to.toLowerCase() && target.callIndexes.includes(0)
        )
        const recognitionStillAllowed =
          !knownTxRequest?.simulation?.accountCodeEvidence || knownTargetEvidence?.status === 'contract'
        const knownCodeSnapshot = accountCodeSnapshot(knownTxRequest?.simulation, to, 0)

        if (
          knownTxRequest === req &&
          recognitionStillAllowed &&
          knownCodeSnapshot.fingerprint === codeSnapshot?.fingerprint &&
          actions
        ) {
          knownTxRequest.recognizedActions = actions
          this.update()
        }
      } catch (e) {
        log.warn(e)
      }
    }
  }

  private removeApproval(req: ManagedApprovalRequest, type: ApprovalType) {
    req.approvals = (req.approvals || []).filter((approval) => approval.type !== type)
  }

  private syncManagedApproval(
    req: ManagedApprovalRequest,
    type: ApprovalType,
    data?: Record<string, unknown>
  ) {
    if (!data) {
      this.removeApproval(req, type)
      return
    }

    const existingApproval = (req.approvals || []).find((approval) => approval.type === type)
    if (existingApproval) {
      const previousKeys = Object.keys(existingApproval.data || {})
      const nextKeys = Object.keys(data)
      const unchanged =
        previousKeys.length === nextKeys.length &&
        nextKeys.every((key) => Object.is(existingApproval.data?.[key], data[key]))

      existingApproval.data = data
      if (!unchanged) existingApproval.approved = false
      return
    }

    const approval = {
      type,
      data,
      approved: false,
      approve: () => {
        const knownRequest = this.requests[req.handlerId] as ManagedApprovalRequest | undefined
        const knownApproval = knownRequest?.approvals?.find((candidate) => candidate.type === type)

        if (knownRequest === req && knownApproval === approval) {
          approval.approved = true
          this.update()
        }
      }
    }

    req.approvals = [...(req.approvals || []), approval]
  }

  private removeSimulationApprovals(req: TransactionRequest) {
    this.removeApproval(req, ApprovalType.SimulationApproval)
    this.removeApproval(req, ApprovalType.TokenApprovalRisk)
    this.removeApproval(req, ApprovalType.TokenAllowanceChangeRisk)
    this.removeApproval(req, ApprovalType.DelegatedAccountRisk)
    this.removeApproval(req, ApprovalType.ProxyImplementationChangeRisk)
  }

  private syncSimulationApproval(req: TransactionRequest, simulation: TransactionSimulation) {
    if (simulation.status === 'succeeded') {
      this.removeApproval(req, ApprovalType.SimulationApproval)
      return
    }

    let copy: { title: string; message: string }
    switch (simulation.status) {
      case 'reverted':
        copy = {
          title: 'RPC Reports Revert',
          message: 'Your configured RPC reports that this transaction will revert.'
        }
        break
      case 'failed':
        copy = {
          title: 'Execution Check Failed',
          message: 'Wren could not determine whether this transaction will execute successfully.'
        }
        break
      case 'unavailable':
        copy = {
          title: 'Execution Check Unavailable',
          message: 'Your configured RPC does not provide a usable transaction execution check.'
        }
        break
      default:
        return
    }
    const detail = simulation.reason ? ` RPC detail: ${simulation.reason}` : ''
    const data = { ...copy, message: `${copy.message}${detail}`, confirmLabel: 'Sign Anyway' }
    this.syncManagedApproval(req, ApprovalType.SimulationApproval, data)
  }

  private syncTokenApprovalRisk(req: TransactionRequest, simulation: TransactionSimulation) {
    const broadEffects =
      simulation.status === 'succeeded'
        ? (simulation.effects || []).filter((effect) => isBroadTokenAuthorityEffect(effect, req.account))
        : []
    const intent = req.data.to ? parseBroadTokenAuthorityIntent(req.data.data) : undefined
    const intentReported =
      intent !== undefined &&
      broadEffects.some((effect) =>
        effectReportsBroadTokenAuthorityIntent(intent, effect, req.account, req.data.to)
      )
    const broadApprovalCount = broadEffects.length + (intent && !intentReported ? 1 : 0)

    if (broadApprovalCount === 0) {
      this.removeApproval(req, ApprovalType.TokenApprovalRisk)
      return
    }

    const subject =
      broadApprovalCount === 1
        ? 'one broad token permission'
        : `${broadApprovalCount} broad token permissions`
    const evidence = intent ? (broadEffects.length > 0 ? 'calldata-and-rpc' : 'calldata') : 'rpc'
    const message =
      evidence === 'rpc'
        ? `Your configured RPC reports ${subject}. This may grant maximum ERC-20 spending or collection-wide operator access. Review RPC-reported effects before proceeding.`
        : evidence === 'calldata-and-rpc'
          ? `Top-level calldata requests broad token-like authority, and your configured RPC reports ${subject}. Review both the request intent and RPC-reported effects before proceeding.`
          : `Top-level calldata requests ${subject}. The selector matches maximum approve(address,uint256) or enabled setApprovalForAll(address,bool), but does not prove the contract standard or successful execution.`
    this.syncManagedApproval(req, ApprovalType.TokenApprovalRisk, {
      title: broadApprovalCount === 1 ? 'Broad Token Approval' : 'Broad Token Approvals',
      message,
      confirmLabel: 'Approve Anyway',
      riskCount: broadApprovalCount,
      evidence
    })
  }

  private syncTokenAllowanceChangeRisk(req: TransactionRequest, simulation: TransactionSimulation) {
    const allowance = simulation.allowance
    const intent = parseErc20ApprovalIntent(req.data.data)
    const sameAddress = (left: unknown, right: unknown) =>
      typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
    const evidenceMatchesRequest =
      allowance !== undefined &&
      intent !== undefined &&
      sameAddress(allowance.token, req.data.to) &&
      sameAddress(allowance.owner, req.account) &&
      sameAddress(allowance.owner, req.data.from) &&
      sameAddress(allowance.spender, intent.spender) &&
      allowance.requestedAmount === intent.amount
    const changesNonzeroAllowance =
      evidenceMatchesRequest &&
      allowance.currentAmount !== '0' &&
      allowance.requestedAmount !== '0' &&
      allowance.currentAmount !== allowance.requestedAmount

    if (!changesNonzeroAllowance) {
      this.removeApproval(req, ApprovalType.TokenAllowanceChangeRisk)
      return
    }

    this.syncManagedApproval(req, ApprovalType.TokenAllowanceChangeRisk, {
      title: 'Existing Token Allowance',
      message:
        'Your configured RPC reports a different nonzero allowance for this owner and spender. ERC-20 recommends setting the allowance to zero before assigning another nonzero value to reduce an approval-race risk.',
      confirmLabel: 'Change Anyway',
      currentAmount: allowance.currentAmount,
      requestedAmount: allowance.requestedAmount
    })
  }

  private syncDelegatedAccountRisk(req: TransactionRequest, simulation: TransactionSimulation) {
    const delegation = simulation.delegation
    if (delegation?.status !== 'delegated' || !delegation.delegate) {
      this.removeApproval(req, ApprovalType.DelegatedAccountRisk)
      return
    }

    this.syncManagedApproval(req, ApprovalType.DelegatedAccountRisk, {
      title: 'Delegated Account',
      message: `This account delegates execution to ${delegation.delegate}. Calls to this account run the delegate’s code in this account’s context. Sending this transaction does not by itself run that code.`,
      confirmLabel: 'Sign With Delegated Account',
      account: delegation.account,
      delegate: delegation.delegate
    })
  }

  private syncProxyImplementationChangeRisk(req: TransactionRequest, simulation: TransactionSimulation) {
    const evidence = simulation.proxyImplementationCheck
    if (!evidence || evidence.status !== 'succeeded') return
    if (!evidence.changes.length) {
      this.removeApproval(req, ApprovalType.ProxyImplementationChangeRisk)
      return
    }

    const count = evidence.changes.length
    const subject = evidence.truncated
      ? `at least ${count} ERC-1967 proxy implementation slots`
      : `${count} ERC-1967 proxy implementation slot${count === 1 ? '' : 's'}`
    this.syncManagedApproval(req, ApprovalType.ProxyImplementationChangeRisk, {
      title:
        count === 1 && !evidence.truncated
          ? 'ERC-1967 Implementation Slot Change'
          : 'ERC-1967 Implementation Slot Changes',
      message: `Your configured RPC reports that this transaction causes a net pre/post change to ${subject}. This can replace the code executed by a proxy and change control over its assets. Verify every proxy and implementation value before proceeding.`,
      confirmLabel: 'Approve Upgrade Anyway',
      riskCount: count,
      truncated: evidence.truncated === true,
      evidenceKey: evidence.changes
        .map((change) => `${change.proxy}:${change.beforeValue}->${change.afterValue}`)
        .join(',')
    })
  }

  syncPermitApprovalRisk(req: PermitSignatureRequest) {
    const amount = parseTokenBaseUnitAmount(req.typedMessage?.data?.message?.value)
    if (amount !== MAX_UINT256) {
      this.removeApproval(req, ApprovalType.TokenPermitRisk)
      return
    }

    this.syncManagedApproval(req, ApprovalType.TokenPermitRisk, {
      title: 'Unlimited Token Permit',
      message:
        'This EIP-2612 signature authorizes the displayed spender to use the maximum uint256 token amount. It can grant broad authority without sending an onchain transaction.',
      confirmLabel: 'Sign Permit Anyway'
    })
  }

  syncSignatureApprovalRisk(req: SignatureRequest) {
    const kind = req.type === 'sign' ? 'message' : 'typed-data'
    const context = req.type === 'sign' ? req.data?.context : req.context
    const risks = requiredSignatureRisks(kind, context?.risks)
    if (risks.length === 0) {
      this.removeApproval(req, ApprovalType.SignatureRisk)
      return
    }

    const subject = kind === 'message' ? 'message signing request' : 'typed-data signing request'
    this.syncManagedApproval(req, ApprovalType.SignatureRisk, {
      title: kind === 'message' ? 'Dangerous Message Signature' : 'Risky Typed Signature',
      message: `Wren detected ${risks.length} high-risk condition${
        risks.length === 1 ? '' : 's'
      } in this ${subject}. Review every displayed warning before proceeding.`,
      confirmLabel: 'Sign Anyway',
      riskCodes: risks.join(',')
    })
  }

  private applySimulationResult(req: TransactionRequest, simulation: TransactionSimulation) {
    req.simulation = simulation
    delete req.decodedData
    req.recognizedActions = []
    this.syncSimulationApproval(req, simulation)
    this.syncTokenApprovalRisk(req, simulation)
    this.syncTokenAllowanceChangeRisk(req, simulation)
    this.syncDelegatedAccountRisk(req, simulation)
    this.syncProxyImplementationChangeRisk(req, simulation)
    this.update()
    this.decodeCalldata(req)
    this.recognizeActions(req)
  }

  refreshTransactionSimulation(req: TransactionRequest, publishPending = true, preserveApproval = false) {
    if (this.requests[req.handlerId] !== req) return

    const version = (this.simulationVersions[req.handlerId] || 0) + 1
    this.simulationVersions[req.handlerId] = version
    if (publishPending) req.simulation = { status: 'pending' }
    if (!preserveApproval) this.removeSimulationApprovals(req)

    if (publishPending) this.update()

    clearTimeout(this.simulationTimers[req.handlerId])
    this.simulationTimers[req.handlerId] = setTimeout(() => {
      delete this.simulationTimers[req.handlerId]
      if (this.requests[req.handlerId] !== req || this.simulationVersions[req.handlerId] !== version) return

      simulateTransaction(req.data, {
        send: (payload, callback, targetChain) => provider.connection.send(payload, callback, targetChain)
      })
        .then((simulation) => {
          const knownRequest = this.requests[req.handlerId]
          if (knownRequest !== req || this.simulationVersions[req.handlerId] !== version) return

          this.applySimulationResult(req, simulation)
        })
        .catch((error) => {
          const knownRequest = this.requests[req.handlerId]
          if (knownRequest !== req || this.simulationVersions[req.handlerId] !== version) return

          this.applySimulationResult(req, {
            status: 'failed',
            reason: error instanceof Error ? error.message.slice(0, 240) : 'RPC execution check failed'
          })
        })
    }, 0)
  }

  private applyWalletCallsSimulationResult(req: WalletCallsRequest, simulation: WalletCallsSimulationResult) {
    req.simulation = simulation
    this.update()
    if (simulation.accountCodeEvidence) this.revealWalletCallDetails(req)
  }

  refreshWalletCallsSimulation(req: WalletCallsRequest, publishPending = true) {
    if (this.requests[req.handlerId] !== req) return

    const version = (this.simulationVersions[req.handlerId] || 0) + 1
    this.simulationVersions[req.handlerId] = version
    req.simulation = { status: 'pending', calls: [] }
    if (publishPending) this.update()

    clearTimeout(this.simulationTimers[req.handlerId])
    this.simulationTimers[req.handlerId] = setTimeout(() => {
      delete this.simulationTimers[req.handlerId]
      if (this.requests[req.handlerId] !== req || this.simulationVersions[req.handlerId] !== version) return

      const calls = req.calls.map((call) => ({
        ...call,
        chainId: req.chainId,
        from: req.account
      }))
      simulateWalletCalls(calls, {
        send: (payload, callback, targetChain) => provider.connection.send(payload, callback, targetChain)
      })
        .then((simulation) => {
          const knownRequest = this.requests[req.handlerId]
          if (knownRequest !== req || this.simulationVersions[req.handlerId] !== version) return

          this.applyWalletCallsSimulationResult(req, simulation)
        })
        .catch((error) => {
          const knownRequest = this.requests[req.handlerId]
          if (knownRequest !== req || this.simulationVersions[req.handlerId] !== version) return

          this.applyWalletCallsSimulationResult(req, {
            status: 'failed',
            source: 'eth_simulateV1',
            calls: [],
            reason: error instanceof Error ? error.message.slice(0, 240) : 'Stateful simulation failed'
          })
        })
    }, 0)
  }

  private async revealWalletCallDetails(req: WalletCallsRequest) {
    const calls = snapshotWalletCalls(req.calls)
    const chainId = Number(parseRpcQuantity(req.chainId))
    const codeSnapshots = calls.map((call, index) =>
      call.to ? accountCodeSnapshot(req.simulation, call.to, index) : undefined
    )

    const details = await Promise.all(
      calls.map(async (call, index) => {
        if (!call.to || call.data === '0x') return null
        const codeAddress = codeSnapshots[index]?.codeAddress
        if (!codeAddress) return null
        try {
          const decoded = await reveal.decode(call.to, chainId, call.data, codeAddress)
          if (!decoded) return null
          if (decoded.contractName !== 'ERC-20') {
            return {
              label: decoded.contractName,
              source: decoded.source,
              ...(decoded.method ? { method: decoded.method } : {})
            }
          }

          try {
            const token = await new Erc20Contract(call.to, chainId).getTokenData()
            const label = token.name
              ? `${token.name}${token.symbol ? ` (${token.symbol})` : ''}`
              : token.symbol || 'ERC-20 contract'
            return {
              label,
              source: token.name || token.symbol ? 'ERC-20 token metadata' : decoded.source,
              ...(decoded.method ? { method: decoded.method } : {})
            }
          } catch {
            return {
              label: 'ERC-20 contract',
              source: decoded.source,
              ...(decoded.method ? { method: decoded.method } : {})
            }
          }
        } catch (error) {
          log.warn('unable to resolve wallet-call destination', { error, handlerId: req.handlerId })
          return null
        }
      })
    )

    const knownRequest = this.requests[req.handlerId]
    if (knownRequest !== req) return
    try {
      const currentCalls = snapshotWalletCalls(req.calls)
      if (JSON.stringify(currentCalls) !== JSON.stringify(calls)) return
      const currentCodeSnapshots = currentCalls.map((call, index) =>
        call.to ? accountCodeSnapshot(req.simulation, call.to, index) : undefined
      )
      if (
        JSON.stringify(currentCodeSnapshots.map((snapshot) => snapshot?.fingerprint)) !==
        JSON.stringify(codeSnapshots.map((snapshot) => snapshot?.fingerprint))
      )
        return
    } catch {
      return
    }
    req.callDetails = Object.freeze(details.map((detail) => (detail ? Object.freeze(detail) : null)))
    this.update()
  }

  adjustWalletCalls(handlerId: string, adjustment: unknown) {
    const request = this.requests[handlerId]
    if (!request || request.type !== 'walletCalls') {
      throw new Error('Wallet-call request is no longer available')
    }
    const walletCalls = request as WalletCallsRequest
    if (walletCalls.locked || walletCalls.status !== undefined) {
      throw new Error('Wallet-call request can no longer be adjusted')
    }
    if (walletCalls.preparation?.status !== 'succeeded') {
      throw new Error('Wallet-call preparation is not ready for adjustment')
    }

    walletCalls.adjustment = snapshotWalletCallBatchAdjustment(adjustment, walletCalls.preparation)
    this.refreshWalletCallsSimulation(walletCalls, false)
    this.refreshWalletCallsPreparation(walletCalls, false)
    this.update()
    return walletCalls.adjustment
  }

  private walletCallsPendingNonce(account: string, chainId: string) {
    return new Promise<string>((resolve, reject) => {
      provider.getNonce({ from: account, chainId } as TransactionData, (response) => {
        if (response?.error) {
          const message =
            typeof response.error.message === 'string'
              ? response.error.message
              : 'Pending nonce request failed'
          reject(new Error(message))
        } else if (typeof response?.result !== 'string') {
          reject(new Error('Pending nonce request returned invalid data'))
        } else {
          resolve(response.result)
        }
      })
    })
  }

  private applyWalletCallsPreparationFailure(req: WalletCallsRequest, error: unknown) {
    const message = error instanceof Error ? error.message : 'Wallet call preparation failed'
    req.preparation = {
      status: 'failed',
      reason: (message.trim() || 'Wallet call preparation failed').slice(0, 240)
    }
    this.update()
  }

  private walletCallsRequestMatchesSnapshot(
    req: WalletCallsRequest,
    snapshot: WalletCallsPreparationSnapshot
  ) {
    if (
      req.account !== snapshot.account ||
      req.chainId !== snapshot.chainId ||
      JSON.stringify(req.adjustment) !== JSON.stringify(snapshot.adjustment)
    ) {
      return false
    }

    try {
      const calls = snapshotWalletCalls(req.calls)
      return (
        calls.length === snapshot.calls.length &&
        calls.every((call, index) => {
          const snapshotCall = snapshot.calls[index]
          return (
            snapshotCall !== undefined &&
            call.to === snapshotCall.to &&
            call.data === snapshotCall.data &&
            call.value === snapshotCall.value
          )
        })
      )
    } catch {
      return false
    }
  }

  refreshWalletCallsPreparation(req: WalletCallsRequest, publishPending = true) {
    if (this.requests[req.handlerId] !== req) return

    const version = (this.preparationVersions[req.handlerId] || 0) + 1
    this.preparationVersions[req.handlerId] = version
    req.preparation = { status: 'pending' }

    let snapshot: WalletCallsPreparationSnapshot
    try {
      snapshot = Object.freeze({
        account: req.account,
        chainId: req.chainId,
        calls: Object.freeze(snapshotWalletCalls(req.calls)),
        ...(req.adjustment
          ? {
              adjustment: Object.freeze({
                startingNonce: req.adjustment.startingNonce,
                calls: Object.freeze(req.adjustment.calls.map((call) => Object.freeze({ ...call })))
              })
            }
          : {})
      })
    } catch (error) {
      if (publishPending) this.applyWalletCallsPreparationFailure(req, error)
      else {
        const message = error instanceof Error ? error.message : 'Wallet call preparation failed'
        req.preparation = {
          status: 'failed',
          reason: (message.trim() || 'Wallet call preparation failed').slice(0, 240)
        }
      }
      return
    }

    if (publishPending) this.update()

    clearTimeout(this.preparationTimers[req.handlerId])
    this.preparationTimers[req.handlerId] = setTimeout(() => {
      delete this.preparationTimers[req.handlerId]
      if (this.requests[req.handlerId] !== req || this.preparationVersions[req.handlerId] !== version) return

      const pendingNonce = snapshot.adjustment?.startingNonce
        ? Promise.resolve(snapshot.adjustment.startingNonce)
        : this.walletCallsPendingNonce(snapshot.account, snapshot.chainId)
      pendingNonce
        .then((pendingNonce) =>
          prepareWalletCallBatch(
            {
              ...snapshot,
              pendingNonce,
              ...(snapshot.adjustment ? { adjustment: snapshot.adjustment } : {})
            },
            {
              fillTransaction: (transaction) =>
                new Promise((resolve, reject) => {
                  provider.fillTransaction({ ...transaction }, (error, metadata) => {
                    if (error) reject(error)
                    else if (!metadata) reject(new Error('Transaction preparation returned no metadata'))
                    else resolve(metadata)
                  })
                })
            }
          )
        )
        .then((preparation) => {
          const knownRequest = this.requests[req.handlerId]
          if (knownRequest !== req || this.preparationVersions[req.handlerId] !== version) return
          if (!this.walletCallsRequestMatchesSnapshot(req, snapshot)) {
            this.applyWalletCallsPreparationFailure(
              req,
              new Error('Wallet call request changed during preparation')
            )
            return
          }

          req.preparation = { status: 'succeeded', ...preparation }
          this.update()
        })
        .catch((error) => {
          const knownRequest = this.requests[req.handlerId]
          if (knownRequest !== req || this.preparationVersions[req.handlerId] !== version) return
          if (!this.walletCallsRequestMatchesSnapshot(req, snapshot)) {
            this.applyWalletCallsPreparationFailure(
              req,
              new Error('Wallet call request changed during preparation')
            )
            return
          }

          this.applyWalletCallsPreparationFailure(req, error)
        })
    }, 0)
  }

  claimWalletCallsRequest(
    handlerId: string,
    simulationAcknowledged = false
  ): Readonly<PreparedWalletCallExecutionSnapshot> {
    const request = this.requests[handlerId]
    if (!request || request.type !== 'walletCalls') {
      throw new Error('Wallet-call request is no longer available')
    }

    const walletCalls = request as WalletCallsRequest
    if (
      walletCalls.handlerId !== handlerId ||
      typeof walletCalls.account !== 'string' ||
      walletCalls.account.toLowerCase() !== this.address
    ) {
      throw new Error('Wallet-call request identity does not match account')
    }
    if (isWatchOnlyAccountType(this.lastSignerType)) {
      throw new Error(WATCH_ONLY_SIGNING_ERROR)
    }
    if (walletCalls.locked || walletCalls.status !== undefined) {
      throw new Error('Wallet-call request has already been claimed')
    }
    if (!walletCalls.simulation || walletCalls.simulation.status === 'pending') {
      throw new Error('Wallet-call execution check is still pending')
    }
    if (
      walletCalls.simulation.status !== 'succeeded' &&
      (!['failed', 'reverted', 'unavailable'].includes(walletCalls.simulation.status) ||
        !simulationAcknowledged)
    ) {
      throw new Error('Wallet-call simulation requires explicit acknowledgement')
    }
    if (
      walletCalls.simulation.accountCodeEvidence?.sender.status === 'delegated' ||
      walletCalls.simulation.delegation?.status === 'delegated'
    ) {
      throw new Error('Wallet-call batches from delegated sending accounts are not supported.')
    }
    if (!walletCalls.preparation || walletCalls.preparation.status !== 'succeeded') {
      throw new Error('Wallet-call transaction preparation is not ready')
    }

    const snapshot = snapshotPreparedWalletCallExecutionInput({
      id: walletCalls.batchId,
      origin: walletCalls.origin,
      account: walletCalls.account,
      chainId: walletCalls.chainId,
      calls: walletCalls.calls,
      preparation: walletCalls.preparation
    })

    const previousState = {
      locked: walletCalls.locked,
      status: walletCalls.status,
      notice: walletCalls.notice
    }
    walletCalls.locked = true
    walletCalls.status = RequestStatus.Pending
    walletCalls.notice =
      this.lastSignerType !== SignerType.Seed && this.lastSignerType !== SignerType.Ring ? 'See Signer' : ''
    try {
      this.update()
    } catch (error) {
      if (previousState.locked !== undefined) walletCalls.locked = previousState.locked
      else delete walletCalls.locked
      if (previousState.status !== undefined) walletCalls.status = previousState.status
      else delete walletCalls.status
      if (previousState.notice !== undefined) walletCalls.notice = previousState.notice
      else delete walletCalls.notice
      throw error
    }

    clearTimeout(this.simulationTimers[handlerId])
    delete this.simulationTimers[handlerId]
    this.simulationVersions[handlerId] = (this.simulationVersions[handlerId] || 0) + 1
    clearTimeout(this.preparationTimers[handlerId])
    delete this.preparationTimers[handlerId]
    this.preparationVersions[handlerId] = (this.preparationVersions[handlerId] || 0) + 1

    return snapshot
  }

  private async decodeTypedMessage(req: SignTypedDataRequest) {
    if (req.type === 'signTypedData') return

    const knownRequest = this.requests[req.handlerId]
    if (!knownRequest) return

    try {
      const permitRequest = knownRequest as PermitSignatureRequest
      const { permit } = permitRequest

      const contract = new Erc20Contract(permit.verifyingContract.address, Number(permit.chainId))
      const [tokenData, contractIdentity, spenderIdentity] = await Promise.all([
        contract.getTokenData(),
        reveal.identity(permit.verifyingContract.address),
        reveal.identity(permit.spender.address)
      ])

      Object.assign(permitRequest, {
        tokenData,
        permit: {
          ...permit,
          verifyingContract: { ...permit.verifyingContract, ...contractIdentity },
          spender: { ...permit.spender, ...spenderIdentity }
        }
      })

      this.update()
    } catch (error) {
      log.warn('unable to decode typed message', { error, handlerId: req.handlerId })
    }
  }

  private async revealDetails(req?: AccountRequest) {
    if (!req) return

    if (isTransactionRequest(req)) {
      this.refreshTransactionSimulation(req, false)
      this.recipientIdentity(req)
      this.decodeCalldata(req)
      this.recognizeActions(req)
      return
    }

    if (req.type === 'walletCalls') {
      this.refreshWalletCallsSimulation(req as WalletCallsRequest, false)
      this.refreshWalletCallsPreparation(req as WalletCallsRequest, false)
      this.revealWalletCallDetails(req as WalletCallsRequest)
      return
    }

    if (isTypedMessageSignatureRequest(req)) {
      this.decodeTypedMessage(req)
    }
  }

  private orderedRequests() {
    return Object.values(this.requests)
      .filter((request) => request.mode !== RequestMode.Monitor)
      .sort((a, b) => {
        const aIndex = a.queueIndex ?? Number.MAX_SAFE_INTEGER
        const bIndex = b.queueIndex ?? Number.MAX_SAFE_INTEGER
        if (aIndex !== bIndex) return aIndex - bIndex

        const aCreated = a.created ?? Number.MAX_SAFE_INTEGER
        const bCreated = b.created ?? Number.MAX_SAFE_INTEGER
        if (aCreated !== bCreated) return aCreated - bCreated

        return a.handlerId.localeCompare(b.handlerId)
      })
  }

  private presentRequest(req: AnyAccountRequest, summon: boolean) {
    requireStoreAction('setSignerView')('default')
    requireStoreAction('setPanelView')('default')

    const accountOpen = store('selected.current') === req.account
    if (accountOpen) {
      if (req.type === 'addChain') {
        requireStoreAction('navDash')({
          view: 'chains',
          data: {
            newChain: req.chain,
            requestReference: {
              account: req.account,
              handlerId: req.handlerId,
              origin: store('main.origins', req.origin, 'name') || req.origin
            }
          }
        })
      } else {
        const panelNav: Breadcrumb[] = store('windows.panel.nav') || []
        const currentRequestData = panelNav.find((crumb) => crumb.view === 'requestView')?.data
        const currentRequestId = isRecord(currentRequestData) ? currentRequestData['requestId'] : undefined
        const currentAccountId = isRecord(currentRequestData) ? currentRequestData['accountId'] : undefined

        if (currentRequestId !== req.handlerId || currentAccountId !== req.account) {
          nav.forward('panel', {
            view: 'expandedModule',
            data: {
              id: 'requests',
              account: req.account
            }
          })
          nav.forward('panel', {
            view: 'requestView',
            data: {
              step: 'confirm',
              accountId: req.account,
              requestId: req.handlerId
            }
          })
        }
      }
    }

    if (summon) {
      const summonTimer = setTimeout(() => {
        windows.showTray()
      }, 100)
      summonTimer.unref?.()
    }
  }

  private presentNextRequest(summon: boolean) {
    const knownActive = this.activeReviewHandlerId ? this.requests[this.activeReviewHandlerId] : undefined
    if (knownActive) return knownActive

    const next = this.orderedRequests()[0]
    this.activeReviewHandlerId = next?.handlerId
    if (next) this.presentRequest(next, summon)
    return next
  }

  presentActiveRequest() {
    const active = this.activeReviewHandlerId ? this.requests[this.activeReviewHandlerId] : undefined
    if (active) this.presentRequest(active, false)
    else {
      this.presentNextRequest(false)
      this.update()
    }
  }

  releaseRequestReview(handlerId: string) {
    if (this.activeReviewHandlerId !== handlerId) return false

    this.activeReviewHandlerId = undefined
    try {
      requireStoreAction('navClearReq')(this.id, handlerId, Object.keys(this.requests).length > 0)
      this.presentNextRequest(false)
    } catch (error) {
      log.warn('Unable to advance request review queue', {
        handlerId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.update()
    }
    return true
  }

  addRequest(req: AnyAccountRequest, res: RPCRequestCallback | WalletCallsResponder = () => {}) {
    if (typeof req.account !== 'string' || req.account.toLowerCase() !== this.address) {
      if (req?.type === 'walletCalls') throw new Error('Wallet-call request is not owned by this account')
      if (req?.type === 'eip7702Revoke') {
        throw new Error('EIP-7702 revocation request is not owned by this account')
      }
    }

    const signal = getRequestSignal(res)
    if (signal?.aborted) {
      throw new Error('Requesting client disconnected')
    }

    req.mode = RequestMode.Normal
    req.created = Date.now()
    req.activityId = req.activityId || randomUUID()
    req.queueIndex = this.nextRequestQueueIndex++
    req.res = res
    this.requests[req.handlerId] = req

    if (signal) {
      const abort = () => {
        const request = this.requests[req.handlerId]
        if (request !== req) return
        this.accounts.cancelUnapprovedRequestForAccount(this.id, req.handlerId, {
          code: 4900,
          message: 'Requesting client disconnected'
        })
      }
      signal.addEventListener('abort', abort, { once: true })
      this.requestAbortCleanup[req.handlerId] = () => signal.removeEventListener('abort', abort)
    }

    if (req.type === 'sign' || req.type === 'signTypedData' || req.type === 'signErc20Permit') {
      req.approvals = req.approvals || []
      this.syncSignatureApprovalRisk(req)
    }
    if (req.type === 'signErc20Permit') {
      this.syncPermitApprovalRisk(req)
    }

    this.revealDetails(req)
    this.presentNextRequest(true)
    this.update()
    return true
  }

  getSigner() {
    return this.signer ? signers.get(this.signer) : undefined
  }

  verifyAddress(display: boolean, cb: Callback<boolean>) {
    const signer = signers.get(this.signer)

    if (signer?.verifyAddress && isSignerReady(signer)) {
      const index = signer.addresses.map((a) => a.toLowerCase()).indexOf(this.address)
      if (index > -1) {
        signer.verifyAddress(index, this.address, display, cb)
      } else {
        log.info('Could not find address in signer')
        cb(new Error('Could not find address in signer'))
      }
    } else {
      log.info('Signer not accessible to verify address')
      cb(new Error('Signer not accessible to verify address'))
    }
  }

  getSelectedAddresses() {
    return [this.address]
  }

  getSelectedAddress() {
    return this.address
  }

  summary() {
    const update = JSON.parse(
      JSON.stringify({
        id: this.id,
        name: this.name,
        lastSignerType: this.lastSignerType,
        address: this.address,
        status: this.status,
        active: this.active,
        signer: this.signer,
        requests: this.requests,
        activeRequestId: this.activeReviewHandlerId || null,
        ensName: this.ensName,
        created: this.created
      })
    ) as Account

    return update
  }

  update() {
    this.accounts.update(this.summary())
  }

  rename(name: string) {
    this.name = name
    this.update()
  }

  getCoinbase(cb: Callback<Array<Address>>) {
    cb(null, [this.address])
  }

  getAccounts(cb?: Callback<Array<Address>>) {
    const account = this.address
    if (cb) cb(null, account ? [account] : [])
    return account ? [account] : []
  }

  close() {
    this.ensLookupClosed = true
    Object.keys(this.requests).forEach((handlerId) =>
      this.accounts.cancelEip7702Operation?.(this.id, handlerId)
    )
    provider.off('status:ethereum:1', this.ensStatusHandler)
    Object.values(this.requestAbortCleanup).forEach((cleanup) => cleanup())
    this.requestAbortCleanup = {}
    Object.values(this.simulationTimers).forEach(clearTimeout)
    this.simulationTimers = {}
    Object.keys(this.simulationVersions).forEach((handlerId) => {
      const version = this.simulationVersions[handlerId]
      if (version !== undefined) this.simulationVersions[handlerId] = version + 1
    })
    Object.values(this.preparationTimers).forEach(clearTimeout)
    this.preparationTimers = {}
    Object.keys(this.preparationVersions).forEach((handlerId) => {
      const version = this.preparationVersions[handlerId]
      if (version !== undefined) this.preparationVersions[handlerId] = version + 1
    })
    this.accountObserver.remove()
  }

  signMessage(message: string, cb: Callback<string>) {
    if (!message) return cb(new Error('No message to sign'))
    if (this.signer) {
      const s = signers.get(this.signer)
      if (!s) return cb(new Error(`Cannot find signer for this account`))
      const index = s.addresses.map((a) => a.toLowerCase()).indexOf(this.address)
      if (index === -1) return cb(new Error(`Signer cannot sign for this address`))
      s.signMessage(index, message, cb)
    } else {
      cb(new Error('No signer found for this account'))
    }
  }

  signTypedData(typedMessage: TypedMessage, cb: Callback<string>) {
    if (!typedMessage.data) return cb(new Error('No data to sign'))
    if (typeof typedMessage.data !== 'object') return cb(new Error('Data to sign has the wrong format'))
    if (this.signer) {
      const s = signers.get(this.signer)
      if (!s) return cb(new Error(`Cannot find signer for this account`))
      const index = s.addresses.map((a) => a.toLowerCase()).indexOf(this.address)
      if (index === -1) return cb(new Error(`Signer cannot sign for this address`))
      s.signTypedData(index, typedMessage, cb)
    } else {
      cb(new Error('No signer found for this account'))
    }
  }

  signTransaction(rawTx: TransactionData, cb: Callback<string>) {
    // if(index === typeof 'object' && cb === typeof 'undefined' && typeof rawTx === 'function') cb = rawTx; rawTx = index; index = 0;
    this.validateTransaction(rawTx, (err) => {
      if (err) return cb(err)
      const reviewed = this.reviewedAccountCodeEvidence(rawTx)
      inspectTransactionAccountCode(rawTx, {
        send: (payload, callback, targetChain) => provider.connection.send(payload, callback, targetChain)
      })
        .then((actual) => {
          assertAccountCodeEvidenceStable(reviewed?.evidence, actual, reviewed?.callIndex ?? 0)
          if (!this.signer) return cb(new Error('No signer found for this account'))

          const s = signers.get(this.signer)
          if (!s) return cb(new Error(`Cannot find signer for this account`))
          const index = s.addresses.map((a) => a.toLowerCase()).indexOf(this.address)
          if (index === -1) return cb(new Error(`Signer cannot sign for this address`))
          s.signTransaction(index, rawTx, cb)
        })
        .catch((error) => {
          const failure = error instanceof Error ? error : new Error('account-code-check-failed')
          cb(failure)
        })
    })
  }

  private reviewedAccountCodeEvidence(
    rawTx: TransactionData
  ): Readonly<{ evidence?: TransactionAccountCodeEvidence; callIndex: number }> | undefined {
    const transactionRequest = Object.values(this.requests).find(
      (request) => request.type === 'transaction' && request.data === rawTx
    ) as TransactionRequest | undefined
    if (transactionRequest) {
      const evidence = transactionRequest.simulation?.accountCodeEvidence
      return Object.freeze({
        ...(evidence ? { evidence } : {}),
        callIndex: 0
      })
    }

    const matchingFields: Array<keyof TransactionData> = [
      'from',
      'chainId',
      'nonce',
      'to',
      'data',
      'value',
      'type',
      'gasLimit',
      'gasPrice',
      'maxFeePerGas',
      'maxPriorityFeePerGas'
    ]
    for (const request of Object.values(this.requests)) {
      if (request.type !== 'walletCalls' || !request.locked || request.preparation.status !== 'succeeded') {
        continue
      }
      const callIndex = request.preparation.calls.findIndex((prepared) =>
        matchingFields.every((field) => prepared.transaction[field] === rawTx[field])
      )
      if (callIndex >= 0) {
        const evidence =
          request.simulation.status === 'pending' ? undefined : request.simulation.accountCodeEvidence
        return Object.freeze({
          ...(evidence ? { evidence } : {}),
          callIndex
        })
      }
    }
    return undefined
  }

  private validateTransaction(rawTx: TransactionData, cb: Callback<void>) {
    // Validate 'from' address
    if (!rawTx.from) return cb(new Error("Missing 'from' address"))
    if (!isValidAddress(rawTx.from)) return cb(new Error("Invalid 'from' address"))

    // Ensure that transaction params are valid hex strings
    const enforcedKeys: Array<keyof TransactionData> = [
      'value',
      'data',
      'to',
      'from',
      'gas',
      'gasPrice',
      'gasLimit',
      'nonce'
    ]
    const keys = Object.keys(rawTx) as Array<keyof TransactionData>

    for (const key of keys) {
      if (enforcedKeys.indexOf(key) > -1 && !this.isValidHexString(rawTx[key] as string)) {
        return cb(new Error(`Transaction parameter '${key}' is not a valid hex string`))
      }
    }
    return cb(null)
  }

  private isValidHexString(str: string) {
    const pattern = /^0x[0-9a-fA-F]*$/
    return pattern.test(str)
  }
}

export default FrameAccount
