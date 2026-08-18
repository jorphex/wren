import type { WalletCallsClaimEvidence, WalletCallsRequest, WalletCallsResponder } from '../accounts/types'
import type { PreparedWalletCallExecutionSnapshot } from './walletCallPreparedExecution'
import {
  admitWalletCallBatch,
  type WalletCallAdmissionInput,
  type WalletCallAdmissionLedger
} from './walletCallAdmission'
import { getRequestSignal, bindRequestSignal } from './requestSignal'

interface WalletCallLifecycleLedger extends WalletCallAdmissionLedger {
  fail(origin: string, account: string, id: string): void
}

interface WalletCallLifecycleAccounts {
  addRequestForAccount(
    accountId: string,
    request: WalletCallsRequest,
    responder: WalletCallsResponder
  ): boolean | void
  claimWalletCallsRequestWithResponse(
    accountId: string,
    handlerId: string,
    expectedEvidence: Readonly<WalletCallsClaimEvidence>,
    simulationAcknowledged?: boolean
  ): Readonly<{
    snapshot: Readonly<PreparedWalletCallExecutionSnapshot>
    responder: WalletCallsResponder
  }>
  settleWalletCallsRequest(accountId: string, handlerId: string, error?: Error): boolean
}

export interface WalletCallLifecycleDependencies {
  ledger: WalletCallLifecycleLedger
  accounts: WalletCallLifecycleAccounts
  execute(input: Readonly<PreparedWalletCallExecutionSnapshot>, handlerId: string): Promise<readonly string[]>
  reportError?(error: Error): void
}

function lifecycleError(error: unknown, fallback: string) {
  if (error instanceof Error) return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return new Error(error.message)
  }
  if (typeof error === 'string' && error) return new Error(error)
  return new Error(fallback)
}

function createResponder(
  request: WalletCallsRequest,
  respond: RPCRequestCallback,
  fail: (origin: string, account: string, id: string) => void,
  reportError: (error: Error) => void
) {
  const identity = Object.freeze({
    id: request.batchId,
    origin: request.origin,
    account: request.account,
    rpcId: request.payload.id,
    jsonrpc: request.payload.jsonrpc
  })
  let open = true

  const report = (error: unknown, fallback: string) => {
    try {
      reportError(lifecycleError(error, fallback))
    } catch (_) {
      return
    }
  }
  const deliver = (response: RPCResponsePayload) => {
    try {
      respond(response)
    } catch (error) {
      report(error, 'Wallet-call RPC response failed')
    }
  }
  const reject = (response: RPCResponsePayload) => {
    if (!open) return
    open = false
    try {
      fail(identity.origin, identity.account, identity.id)
    } catch (error) {
      report(error, 'Wallet-call rejection could not be persisted')
    }
    deliver(response)
  }

  const responder = ((response?: RPCResponsePayload) => {
    if (response?.error) {
      const error = response.error
      return reject({
        id: identity.rpcId,
        jsonrpc: identity.jsonrpc,
        error: {
          code: typeof error.code === 'number' ? error.code : -32603,
          message: typeof error.message === 'string' && error.message ? error.message : 'Wallet-call rejected'
        }
      })
    }
    reject({
      id: identity.rpcId,
      jsonrpc: identity.jsonrpc,
      error: { code: -32603, message: 'Wallet-call approval bypassed its lifecycle controller' }
    })
  }) as WalletCallsResponder

  Object.defineProperties(responder, {
    walletCallsLifecycle: { value: true, enumerable: false },
    accept: {
      value: (id: string) => {
        if (!open) throw new Error('Wallet-call RPC response is already closed')
        if (id !== identity.id) throw new Error('Wallet-call response ID does not match admitted batch')
        open = false
        deliver({
          id: identity.rpcId,
          jsonrpc: identity.jsonrpc,
          result: { id: identity.id }
        })
      },
      enumerable: false
    }
  })

  return Object.freeze(bindRequestSignal(responder, getRequestSignal(respond)))
}

export class WalletCallLifecycleController {
  private readonly admissionLedger: WalletCallAdmissionLedger
  private readonly fail: WalletCallLifecycleLedger['fail']
  private readonly addRequestForAccount: WalletCallLifecycleAccounts['addRequestForAccount']
  private readonly claimWalletCallsRequestWithResponse: WalletCallLifecycleAccounts['claimWalletCallsRequestWithResponse']
  private readonly settleWalletCallsRequest: WalletCallLifecycleAccounts['settleWalletCallsRequest']
  private readonly execute: WalletCallLifecycleDependencies['execute']
  private readonly reportError: (error: Error) => void

  constructor(dependencies: WalletCallLifecycleDependencies) {
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      !dependencies.ledger ||
      typeof dependencies.ledger.create !== 'function' ||
      typeof dependencies.ledger.fail !== 'function' ||
      !dependencies.accounts ||
      typeof dependencies.accounts.addRequestForAccount !== 'function' ||
      typeof dependencies.accounts.claimWalletCallsRequestWithResponse !== 'function' ||
      typeof dependencies.accounts.settleWalletCallsRequest !== 'function' ||
      typeof dependencies.execute !== 'function' ||
      (dependencies.reportError !== undefined && typeof dependencies.reportError !== 'function')
    ) {
      throw new Error('Invalid wallet-call lifecycle dependencies')
    }

    this.admissionLedger = Object.freeze({
      create: dependencies.ledger.create.bind(dependencies.ledger)
    })
    this.fail = dependencies.ledger.fail.bind(dependencies.ledger)
    this.addRequestForAccount = dependencies.accounts.addRequestForAccount.bind(dependencies.accounts)
    this.claimWalletCallsRequestWithResponse = dependencies.accounts.claimWalletCallsRequestWithResponse.bind(
      dependencies.accounts
    )
    this.settleWalletCallsRequest = dependencies.accounts.settleWalletCallsRequest.bind(dependencies.accounts)
    this.execute = dependencies.execute.bind(dependencies)
    this.reportError = dependencies.reportError?.bind(dependencies) || (() => {})
  }

  admit(input: WalletCallAdmissionInput, respond: RPCRequestCallback) {
    if (typeof respond !== 'function') throw new Error('Invalid wallet-call response callback')
    const addRequestForAccount = this.addRequestForAccount
    const ledger = this.admissionLedger
    const fail = this.fail
    const reportError = this.reportError

    return admitWalletCallBatch(input, {
      ledger,
      addRequest(request) {
        const responder = createResponder(request, respond, fail, reportError)
        return addRequestForAccount(request.account, request, responder)
      }
    })
  }

  async approve(
    accountId: string,
    handlerId: string,
    expectedEvidence: Readonly<WalletCallsClaimEvidence>,
    simulationAcknowledged = false
  ) {
    const approved = this.claimWalletCallsRequestWithResponse(
      accountId,
      handlerId,
      expectedEvidence,
      simulationAcknowledged
    )
    const { snapshot, responder } = approved

    try {
      responder.accept(snapshot.id)
    } catch (error) {
      const approvalError = lifecycleError(error, 'Wallet-call approval response failed')
      try {
        this.fail(snapshot.origin, snapshot.account, snapshot.id)
      } catch (closeError) {
        this.safeReport(closeError, 'Wallet-call approval failure could not be persisted')
      }
      this.safeSettle(snapshot.account, handlerId, approvalError)
      throw approvalError
    }

    try {
      const hashes = await this.execute(snapshot, handlerId)
      this.safeSettle(snapshot.account, handlerId)
      return hashes
    } catch (error) {
      const executionError = lifecycleError(error, 'Wallet-call execution failed')
      this.safeSettle(snapshot.account, handlerId, executionError)
      throw executionError
    }
  }

  private safeSettle(accountId: string, handlerId: string, error?: Error) {
    try {
      this.settleWalletCallsRequest(accountId, handlerId, error)
    } catch (settlementError) {
      this.safeReport(settlementError, 'Wallet-call review outcome could not be published')
    }
  }

  private safeReport(error: unknown, fallback: string) {
    try {
      this.reportError(lifecycleError(error, fallback))
    } catch (_) {
      return
    }
  }
}
