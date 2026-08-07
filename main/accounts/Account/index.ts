import log from 'electron-log'
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
import { simulateTransaction, simulateWalletCalls } from '../../transaction/simulation'
import { snapshotWalletCalls } from '../../provider/walletCallExecution'
import { prepareWalletCallBatch } from '../../provider/walletCallPreparation'
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
import type { Permission } from '../../store/state'
import type { TransactionSimulation, WalletCallsSimulationResult } from '../../transaction/simulation'
import type Signer from '../../signers/Signer'
import { parseErc20ApprovalIntent } from '../../../resources/domain/transaction/allowance'
import { getRequestSignal } from '../../provider/requestSignal'
import { applyPermissionAction } from '../../provider/permissionEvents'
import { FRAME_SEND_ORIGIN } from '../../../resources/domain/origin'

const nebula = nebulaApi()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const storeApi = {
  getPermissions: function (address: Address) {
    return (store('main.permissions', address) || {}) as Record<string, Permission>
  }
}

const SEND_DAPP_PERMISSION = {
  handlerId: 'send-dapp-native',
  origin: FRAME_SEND_ORIGIN
} as const

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
}>

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

  accountObserver: Observer

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

    const existingPermissions = storeApi.getPermissions(this.address)
    const currentSendDappPermission =
      existingPermissions[SEND_DAPP_PERMISSION.handlerId] ||
      Object.values(existingPermissions).find(
        (permission) => permission.origin === SEND_DAPP_PERMISSION.origin
      )

    if (currentSendDappPermission?.origin !== SEND_DAPP_PERMISSION.origin) {
      requireStoreAction('setPermission')(this.address, {
        ...SEND_DAPP_PERMISSION,
        provider: currentSendDappPermission?.provider ?? true
      })
    }

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

    if (nebula.ready()) {
      this.lookupAddress() // We need to recheck this on every network change...
    } else {
      nebula.once('ready', this.lookupAddress.bind(this))
    }

    this.update()
  }

  async lookupAddress() {
    try {
      this.ensName = (await nebula.ens.reverseLookup(this.address))[0] || ''
      this.update()
    } catch (e) {
      log.error('lookupAddress Error:', e)
      this.ensName = ''
      this.update()
    }
  }

  findSigner(address: Address) {
    const signers = store('main.signers') as Record<string, Signer>

    const signerOrdinal = (signer: Signer) => {
      const isOk = signer.status === 'ok' ? 2 : 1
      const signerIndex = Object.values(SignerType).findIndex((type) => type === signer.type)
      const typeIndex = Math.max(signerIndex, 0)

      return isOk * typeIndex
    }

    const availableSigners = Object.values(signers)
      .filter((signer) => signer.addresses.some((addr) => addr.toLowerCase() === address))
      .sort((a, b) => signerOrdinal(b) - signerOrdinal(a))

    return availableSigners[0]
  }

  setAccess(req: AccessRequest, access: boolean) {
    const { handlerId, origin, account } = req
    if (account.toLowerCase() === this.address) {
      // Permissions do no live inside the account summary
      const { name } = store('main.origins', origin)
      applyPermissionAction(
        this.address,
        () =>
          requireStoreAction('setPermission')(this.address, {
            handlerId,
            origin: name,
            provider: access
          }),
        this.accounts,
        provider,
        [origin]
      )
    }

    this.resolveRequest(req)
  }

  getRequest<T extends AccountRequest>(id: string) {
    return this.requests[id] as T
  }

  resolveRequest({ handlerId }: AccountRequest, result?: unknown) {
    const knownRequest = this.requests[handlerId]

    if (knownRequest) {
      const payload = knownRequest.payload
      if (knownRequest.res && payload) {
        const { id, jsonrpc } = payload
        knownRequest.res({ id, jsonrpc, result })
      }

      this.clearRequest(knownRequest.handlerId)
    }
  }

  rejectRequest({ handlerId }: AccountRequest, error: EVMError) {
    const knownRequest = this.requests[handlerId]

    if (knownRequest) {
      const payload = knownRequest.payload
      if (knownRequest.res && payload) {
        const { id, jsonrpc } = payload
        knownRequest.res({ id, jsonrpc, error })
      }

      this.clearRequest(knownRequest.handlerId)
    }
  }

  clearRequest(handlerId: string) {
    log.info(`clearRequest(${handlerId}) for account ${this.id}`)

    this.accounts.clearPendingNonceAdjustment?.(this, handlerId)
    this.requestAbortCleanup[handlerId]?.()
    delete this.requestAbortCleanup[handlerId]
    delete this.requests[handlerId]
    delete this.simulationVersions[handlerId]
    clearTimeout(this.simulationTimers[handlerId])
    delete this.simulationTimers[handlerId]
    delete this.preparationVersions[handlerId]
    clearTimeout(this.preparationTimers[handlerId])
    delete this.preparationTimers[handlerId]
    requireStoreAction('navClearReq')(handlerId, Object.keys(this.requests).length > 0)

    this.update()
  }

  clearRequestsByOrigin(origin: string) {
    Object.entries(this.requests).forEach(([_handlerId, req]) => {
      if (req.origin === origin) {
        const err = { code: 4001, message: 'User rejected the request' }
        this.rejectRequest(req, err)
      }
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

    Object.values(this.requests).forEach((request) => {
      if (request.origin === origin && request.status === undefined && requestChainId(request) === chainId) {
        this.rejectRequest(request, {
          code: 4901,
          message: `Request cancelled because the origin switched away from chain ${chainId}`
        })
      }
    })
  }

  addRequiredApproval(
    req: TransactionRequest,
    type: ApprovalType,
    data: ApprovalData = {},
    onApprove: (data?: ApprovalData) => void = () => {}
  ) {
    // TODO: turn TransactionRequest into its own class
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

    if (to && calldata && calldata !== '0x' && parseInt(calldata, 16) !== 0) {
      try {
        // Decode calldata
        const decodedData = await reveal.decode(to, parseInt(chainId, 16), calldata)

        const knownTxRequest = this.requests[req.handlerId] as TransactionRequest

        if (knownTxRequest && decodedData) {
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

    if (to && calldata && calldata !== '0x' && parseInt(calldata, 16) !== 0) {
      try {
        // Recognize actions
        const actions = await reveal.recog(calldata, {
          contractAddress: to,
          chainId: parseInt(chainId, 16),
          account: this.address,
          ...(req.data.value !== undefined && { value: req.data.value })
        })

        const knownTxRequest = this.requests[req.handlerId] as TransactionRequest

        if (knownTxRequest && actions) {
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
      message: `Your configured RPC reports that ${delegation.account} delegates execution to ${delegation.delegate}. Transactions from this account execute with the delegate's code and may behave differently from an ordinary account. Verify the delegate before proceeding.`,
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
    this.syncSimulationApproval(req, simulation)
    this.syncTokenApprovalRisk(req, simulation)
    this.syncTokenAllowanceChangeRisk(req, simulation)
    this.syncDelegatedAccountRisk(req, simulation)
    this.syncProxyImplementationChangeRisk(req, simulation)
    this.update()
  }

  refreshTransactionSimulation(req: TransactionRequest, publishPending = true, preserveApproval = false) {
    if (this.requests[req.handlerId] !== req) return

    const version = (this.simulationVersions[req.handlerId] || 0) + 1
    this.simulationVersions[req.handlerId] = version
    req.simulation = { status: 'pending' }
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
    if (req.account !== snapshot.account || req.chainId !== snapshot.chainId) return false

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
        calls: Object.freeze(snapshotWalletCalls(req.calls))
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

      this.walletCallsPendingNonce(snapshot.account, snapshot.chainId)
        .then((pendingNonce) =>
          prepareWalletCallBatch(
            { ...snapshot, pendingNonce },
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

  claimWalletCallsRequest(handlerId: string): Readonly<PreparedWalletCallExecutionSnapshot> {
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
    if (walletCalls.simulation.delegation?.status === 'delegated') {
      throw new Error('Wallet-call batches from delegated accounts are not supported')
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
      return
    }

    if (isTypedMessageSignatureRequest(req)) {
      this.decodeTypedMessage(req)
    }
  }

  addRequest(req: AnyAccountRequest, res: RPCRequestCallback | WalletCallsResponder = () => {}) {
    if (
      req?.type === 'walletCalls' &&
      (typeof req.account !== 'string' || req.account.toLowerCase() !== this.address)
    ) {
      const payload = req.payload || {}
      res({
        id: payload.id,
        jsonrpc: payload.jsonrpc,
        error: { code: 4100, message: 'Wallet-call request is not owned by this account' }
      })
      return
    }

    const signal = getRequestSignal(res)
    if (signal?.aborted) {
      const payload = req.payload || {}
      res({
        id: payload.id,
        jsonrpc: payload.jsonrpc,
        error: { code: 4900, message: 'Requesting client disconnected' }
      })
      return
    }

    const add = (r: AnyAccountRequest) => {
      r.mode = RequestMode.Normal
      r.created = Date.now()
      r.res = res
      this.requests[r.handlerId] = r

      if (signal) {
        const abort = () => {
          const request = this.requests[r.handlerId]
          if (request !== r) return
          this.accounts.cancelUnapprovedRequestForAccount(this.id, r.handlerId, {
            code: 4900,
            message: 'Requesting client disconnected'
          })
        }
        signal.addEventListener('abort', abort, { once: true })
        this.requestAbortCleanup[r.handlerId] = () => signal.removeEventListener('abort', abort)
      }

      if (req.type === 'sign' || req.type === 'signTypedData' || req.type === 'signErc20Permit') {
        req.approvals = req.approvals || []
        this.syncSignatureApprovalRisk(req)
      }
      if (req.type === 'signErc20Permit') {
        this.syncPermitApprovalRisk(req)
      }

      this.revealDetails(req)

      this.update()
      requireStoreAction('setSignerView')('default')
      requireStoreAction('setPanelView')('default')

      // Display request
      const { account } = req

      // Check if this account is open
      const accountOpen = store('selected.current') === account

      // Does the current panel nav include a 'requestView'
      const panelNav: Breadcrumb[] = store('windows.panel.nav') || []
      const firstPanelData = panelNav[0]?.data
      const inExpandedRequestsView =
        panelNav[0]?.view === 'expandedModule' &&
        isRecord(firstPanelData) &&
        firstPanelData['id'] === 'requests'
      const inRequestView = panelNav.map((crumb) => crumb.view).includes('requestView')

      if (accountOpen) {
        if (inRequestView) {
          nav.back('panel')
          nav.back('panel')
        } else if (inExpandedRequestsView) {
          nav.back('panel')
        }

        nav.forward('panel', {
          view: 'expandedModule',
          data: {
            id: 'requests',
            account: account
          }
        })

        if (!store('tray.open') || !inRequestView) {
          const crumb = {
            view: 'requestView',
            data: {
              step: 'confirm',
              accountId: account,
              requestId: req.handlerId
            }
          } as const
          nav.forward('panel', crumb)
        }
      }

      setTimeout(() => {
        windows.showTray()
      }, 100)
    }

    add(req)
  }

  getSigner() {
    return this.signer ? signers.get(this.signer) : undefined
  }

  verifyAddress(display: boolean, cb: Callback<boolean>) {
    const signer = signers.get(this.signer)

    if (signer?.verifyAddress && signer.status === 'ok') {
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
      if (this.signer) {
        const s = signers.get(this.signer)
        if (!s) return cb(new Error(`Cannot find signer for this account`))

        const index = s.addresses.map((a) => a.toLowerCase()).indexOf(this.address)
        if (index === -1) return cb(new Error(`Signer cannot sign for this address`))
        s.signTransaction(index, rawTx, cb)
      } else {
        cb(new Error('No signer found for this account'))
      }
    })
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
