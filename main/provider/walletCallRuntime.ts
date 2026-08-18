import type { TransactionData } from '../../resources/domain/transaction'
import type { Chain } from '../chains'
import {
  executePreparedWalletCallBatch,
  snapshotPreparedWalletCallExecutionInput,
  type PreparedWalletCallExecutionInput
} from './walletCallPreparedExecution'

interface WalletCallRuntimeLedger {
  reserveTransaction(origin: string, account: string, id: string, hash: string): void
  markTransactionSubmitted(origin: string, account: string, id: string, hash: string): void
  complete(origin: string, account: string, id: string): void
  fail(origin: string, account: string, id: string): void
}

interface WalletCallRuntimeAccounts {
  signTransactionForAccount(
    accountId: string,
    transaction: TransactionData,
    callback: Callback<string>,
    beforeSign?: () => void
  ): void
}

interface WalletCallRuntimeConnection {
  send(payload: JSONRPCRequestPayload, callback: RPCRequestCallback, targetChain: Chain): void
}

export interface WalletCallRuntimeDependencies {
  accounts: WalletCallRuntimeAccounts
  connection: WalletCallRuntimeConnection
  ledger: WalletCallRuntimeLedger
  evidenceAvailable?(): void
  recordSubmittedTarget?(address: string, submittedAt: number): void
  assertBeforeSign?(): void
}

function runtimeError(error: unknown, fallback: string) {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error) return new Error(error)
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  ) {
    return new Error(error.message)
  }
  return new Error(fallback)
}

export async function executeWalletCallRuntime(
  input: PreparedWalletCallExecutionInput,
  dependencies: WalletCallRuntimeDependencies
) {
  const snapshot = snapshotPreparedWalletCallExecutionInput(input)
  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    !dependencies.accounts ||
    typeof dependencies.accounts.signTransactionForAccount !== 'function' ||
    !dependencies.connection ||
    typeof dependencies.connection.send !== 'function' ||
    !dependencies.ledger ||
    typeof dependencies.ledger.reserveTransaction !== 'function' ||
    typeof dependencies.ledger.markTransactionSubmitted !== 'function' ||
    typeof dependencies.ledger.complete !== 'function' ||
    typeof dependencies.ledger.fail !== 'function' ||
    (dependencies.evidenceAvailable !== undefined && typeof dependencies.evidenceAvailable !== 'function') ||
    (dependencies.recordSubmittedTarget !== undefined &&
      typeof dependencies.recordSubmittedTarget !== 'function') ||
    (dependencies.assertBeforeSign !== undefined && typeof dependencies.assertBeforeSign !== 'function')
  ) {
    throw new Error('Invalid wallet-call runtime dependencies')
  }

  const signTransactionForAccount = dependencies.accounts.signTransactionForAccount.bind(
    dependencies.accounts
  )
  const send = dependencies.connection.send.bind(dependencies.connection)
  const reserveTransaction = dependencies.ledger.reserveTransaction.bind(dependencies.ledger)
  const markTransactionSubmitted = dependencies.ledger.markTransactionSubmitted.bind(dependencies.ledger)
  const completeBatch = dependencies.ledger.complete.bind(dependencies.ledger)
  const failBatch = dependencies.ledger.fail.bind(dependencies.ledger)
  const evidenceAvailable = dependencies.evidenceAvailable?.bind(dependencies)
  const recordSubmittedTarget = dependencies.recordSubmittedTarget?.bind(dependencies)
  const assertBeforeSign = dependencies.assertBeforeSign?.bind(dependencies)
  const notifyEvidenceAvailable = () => {
    try {
      evidenceAvailable?.()
    } catch (_) {
      return
    }
  }
  const account = snapshot.account
  const targetChain = Object.freeze({ type: 'ethereum', id: Number(BigInt(snapshot.chainId)) })

  return executePreparedWalletCallBatch(snapshot, {
    ledger: Object.freeze({
      reserveTransaction(origin: string, account: string, id: string, hash: string) {
        reserveTransaction(origin, account, id, hash)
        notifyEvidenceAvailable()
      },
      markTransactionSubmitted(origin: string, account: string, id: string, hash: string) {
        markTransactionSubmitted(origin, account, id, hash)
        notifyEvidenceAvailable()
      },
      complete: completeBatch,
      fail: failBatch
    }),
    signTransaction: (transaction) =>
      new Promise((resolve, reject) => {
        let settled = false
        const complete = (error?: Error | null, signedTransaction?: string) => {
          if (settled) return
          settled = true
          if (error) return reject(runtimeError(error, 'Wallet-call signing failed'))
          if (typeof signedTransaction !== 'string' || !signedTransaction) {
            return reject(new Error('Wallet-call signer returned no signed transaction'))
          }
          resolve({ rawTransaction: signedTransaction })
        }

        try {
          signTransactionForAccount(account, { ...transaction }, complete, assertBeforeSign)
        } catch (error) {
          complete(runtimeError(error, 'Wallet-call signing failed'))
        }
      }),
    broadcast: (rawTransaction, index) =>
      new Promise<string>((resolve, reject) => {
        let settled = false
        const complete = (response: RPCResponsePayload) => {
          if (settled) return
          settled = true
          if (response?.error) {
            return reject(runtimeError(response.error, 'Wallet-call broadcast failed'))
          }
          if (typeof response?.result !== 'string' || !response.result) {
            return reject(new Error('Wallet-call broadcast returned no transaction hash'))
          }
          resolve(response.result)
        }

        try {
          send(
            {
              id: index + 1,
              jsonrpc: '2.0',
              method: 'eth_sendRawTransaction',
              params: [rawTransaction]
            },
            complete,
            targetChain
          )
        } catch (error) {
          if (!settled) {
            settled = true
            reject(runtimeError(error, 'Wallet-call broadcast failed'))
          }
        }
      }).then((hash) => {
        const target = snapshot.calls[index]?.to
        if (target) {
          try {
            recordSubmittedTarget?.(target, Date.now())
          } catch {
            // Address memory is observational and must never change broadcast settlement.
          }
        }
        return hash
      })
  })
}
