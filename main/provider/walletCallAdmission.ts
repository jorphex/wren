import type { WalletCallsRequest } from '../accounts/types'
import { WalletCallBatchSchema, type WalletCallBatch } from '../store/state/types/walletCallBatch'
import { snapshotWalletCalls } from './walletCallExecution'
import { parseSendCalls, type SendCallsRequest } from './walletCalls'

export interface WalletCallAdmissionCapability {
  batch: WalletCallBatch
  commit(): void
  rollback(): void
}

export interface WalletCallAdmissionLedger {
  create(input: {
    id?: string
    origin: string
    account: string
    chainId: string
    callCount: number
  }): WalletCallAdmissionCapability
}

export interface WalletCallAdmissionDependencies {
  ledger: WalletCallAdmissionLedger
  addRequest(request: WalletCallsRequest): boolean | void
}

export interface WalletCallAdmissionInput {
  handlerId: string
  origin: string
  account: string
  payload: JSONRPCRequestPayload
}

function admissionError(code: number, message: string): EVMError {
  return { code, message }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error || 'unknown error')
}

function canonicalPayload(payload: JSONRPCRequestPayload, parsed: SendCallsRequest, account: string) {
  return {
    id: payload.id,
    jsonrpc: payload.jsonrpc,
    method: 'wallet_sendCalls',
    params: [
      {
        version: parsed.version,
        ...(parsed.id !== undefined ? { id: parsed.id } : {}),
        from: account,
        chainId: parsed.chainId,
        atomicRequired: false,
        calls: snapshotWalletCalls(parsed.calls)
      }
    ]
  } as JSONRPCRequestPayload
}

export function admitWalletCallBatch(
  input: WalletCallAdmissionInput,
  dependencies: WalletCallAdmissionDependencies
) {
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.handlerId !== 'string' ||
    !input.handlerId ||
    typeof input.origin !== 'string' ||
    !input.origin ||
    typeof input.account !== 'string' ||
    !input.account ||
    !input.payload ||
    input.payload.method !== 'wallet_sendCalls'
  ) {
    throw admissionError(-32602, 'Invalid wallet-call admission input')
  }
  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    !dependencies.ledger ||
    typeof dependencies.ledger.create !== 'function' ||
    typeof dependencies.addRequest !== 'function'
  ) {
    throw new Error('Invalid wallet-call admission dependencies')
  }

  const parsed = parseSendCalls(input.payload.params)
  const account = input.account.toLowerCase()
  if (parsed.from && parsed.from !== account) {
    throw admissionError(4100, 'Wallet-call sender is not the selected account')
  }

  const create = dependencies.ledger.create.bind(dependencies.ledger)
  const addRequest = dependencies.addRequest.bind(dependencies)
  const admission = create({
    ...(parsed.id !== undefined ? { id: parsed.id } : {}),
    origin: input.origin,
    account,
    chainId: parsed.chainId,
    callCount: parsed.calls.length
  })

  try {
    if (
      !admission ||
      typeof admission !== 'object' ||
      typeof admission.commit !== 'function' ||
      typeof admission.rollback !== 'function'
    ) {
      throw new Error('Wallet-call ledger returned no admission capability')
    }
    const batch = WalletCallBatchSchema.safeParse(admission.batch)
    if (
      !batch.success ||
      batch.data.origin !== input.origin ||
      batch.data.account !== account ||
      batch.data.chainId !== parsed.chainId ||
      batch.data.callCount !== parsed.calls.length ||
      batch.data.execution !== 'pending' ||
      batch.data.transactions.length !== 0 ||
      !batch.data.operationId ||
      (parsed.id !== undefined && batch.data.id !== parsed.id)
    ) {
      throw new Error('Wallet-call ledger returned mismatched batch metadata')
    }

    const calls = snapshotWalletCalls(parsed.calls)
    const request: WalletCallsRequest = {
      handlerId: input.handlerId,
      type: 'walletCalls',
      account: batch.data.account,
      origin: batch.data.origin,
      activityId: batch.data.operationId,
      payload: canonicalPayload(input.payload, parsed, batch.data.account),
      version: '2.0.0',
      batchId: batch.data.id,
      chainId: batch.data.chainId,
      atomic: false,
      calls: calls.map((call) => ({ ...call })),
      approvals: [],
      preparation: { status: 'pending' },
      simulation: { status: 'pending', calls: [] }
    }

    if (addRequest(request) === false) throw new Error('Wallet-call review request was not admitted')
    admission.commit()

    return Object.freeze({
      id: batch.data.id,
      handlerId: input.handlerId,
      origin: batch.data.origin,
      account: batch.data.account,
      chainId: batch.data.chainId
    })
  } catch (error) {
    try {
      if (admission && typeof admission.rollback === 'function') admission.rollback()
      else throw new Error('wallet-call ledger returned no rollback capability')
    } catch (rollbackError) {
      throw new Error(
        `Wallet-call admission failed: ${errorMessage(error)}; rollback failed: ${errorMessage(
          rollbackError
        )}`
      )
    }
    throw error
  }
}
