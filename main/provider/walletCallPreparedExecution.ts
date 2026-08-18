import { Capability, TransactionFactory } from '@ethereumjs/tx'

import { GasFeesSource, type TransactionData } from '../../resources/domain/transaction'
import { snapshotSweepEvidence, type SweepEvidence } from '../../resources/domain/sweep'
import { MAX_UINT256, parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import chainConfig from '../chains/config'
import { maxFee } from '../transaction'
import { executeWalletCallBatch, hashSignedTransaction, snapshotWalletCalls } from './walletCallExecution'
import type { PreparedWalletCallBatch } from './walletCallPreparation'
import type { WalletCall } from './walletCalls'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER)

interface PreparedExecutionLedger {
  reserveTransaction(origin: string, account: string, id: string, hash: string): void
  markTransactionSubmitted(origin: string, account: string, id: string, hash: string): void
  complete(origin: string, account: string, id: string): void
  fail(origin: string, account: string, id: string): void
}

export interface PreparedWalletCallExecutionInput {
  id: string
  origin: string
  account: string
  chainId: string
  calls: readonly WalletCall[]
  preparation: PreparedWalletCallBatch
  managedSweep?: SweepEvidence
}

export interface PreparedWalletCallExecutionSnapshot {
  readonly id: string
  readonly origin: string
  readonly account: string
  readonly chainId: string
  readonly calls: readonly Readonly<WalletCall>[]
  readonly preparation: PreparedWalletCallBatch
  readonly managedSweep?: SweepEvidence
}

interface PreparedWalletCallExecutionDependencies {
  ledger: PreparedExecutionLedger
  beforeCall?(transaction: Readonly<TransactionData>, index: number): Promise<void>
  signTransaction(transaction: Readonly<TransactionData>, index: number): Promise<{ rawTransaction: string }>
  broadcast(rawTransaction: string, index: number): Promise<string>
}

function snapshotTransaction(
  transaction: Readonly<TransactionData>,
  input: PreparedWalletCallExecutionInput
) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new Error('Invalid prepared wallet call transaction')
  }

  const from =
    typeof transaction.from === 'string' && ADDRESS.test(transaction.from)
      ? transaction.from.toLowerCase()
      : ''
  const chainId = parseRpcQuantity(transaction.chainId)
  const nonce = parseRpcQuantity(transaction.nonce)
  const type = parseRpcQuantity(transaction.type)
  const gasLimit = parseRpcQuantity(transaction.gasLimit)
  const value = parseRpcQuantity(transaction.value)
  const to =
    transaction.to === undefined
      ? undefined
      : typeof transaction.to === 'string' && ADDRESS.test(transaction.to)
        ? transaction.to.toLowerCase()
        : null
  const baseFee = type === 2n
  const feePerGas = parseRpcQuantity(baseFee ? transaction.maxFeePerGas : transaction.gasPrice)
  const priorityFee = baseFee ? parseRpcQuantity(transaction.maxPriorityFeePerGas) : 0n

  if (
    from !== input.account.toLowerCase() ||
    chainId === undefined ||
    toRpcQuantity(chainId) !== input.chainId ||
    nonce === undefined ||
    type === undefined ||
    type > 2n ||
    gasLimit === undefined ||
    gasLimit === 0n ||
    value === undefined ||
    to === null ||
    typeof transaction.data !== 'string' ||
    !DATA.test(transaction.data) ||
    feePerGas === undefined ||
    priorityFee === undefined ||
    priorityFee > feePerGas ||
    (baseFee
      ? transaction.gasPrice !== undefined
      : transaction.maxFeePerGas !== undefined || transaction.maxPriorityFeePerGas !== undefined) ||
    (transaction.gasFeesSource !== GasFeesSource.Frame && transaction.gasFeesSource !== GasFeesSource.Dapp) ||
    transaction.accessList !== undefined ||
    transaction.v !== undefined ||
    transaction.r !== undefined ||
    transaction.s !== undefined
  ) {
    throw new Error('Invalid prepared wallet call transaction')
  }

  return Object.freeze({
    from,
    chainId: input.chainId,
    nonce: toRpcQuantity(nonce),
    type: toRpcQuantity(type),
    gasLimit: toRpcQuantity(gasLimit),
    ...(to === undefined ? {} : { to }),
    data: transaction.data.toLowerCase(),
    value: toRpcQuantity(value),
    ...(baseFee
      ? {
          maxFeePerGas: toRpcQuantity(feePerGas),
          maxPriorityFeePerGas: toRpcQuantity(priorityFee)
        }
      : { gasPrice: toRpcQuantity(feePerGas) }),
    gasFeesSource: transaction.gasFeesSource
  }) as Readonly<TransactionData>
}

function verifySignedTransaction(rawTransaction: unknown, expected: Readonly<TransactionData>) {
  hashSignedTransaction(rawTransaction)

  try {
    const type = parseRpcQuantity(expected.type) as bigint
    const common = chainConfig(Number(parseRpcQuantity(expected.chainId)), type === 2n ? 'london' : 'berlin')
    const signed = TransactionFactory.fromSerializedData(
      Buffer.from((rawTransaction as string).slice(2), 'hex'),
      { common }
    )
    const decoded = signed.toJSON()
    const decodedChainId = signed.common.chainId()
    const expectedTo = expected.to?.toLowerCase()
    const decodedTo = decoded.to?.toLowerCase()
    const sameFees =
      type === 2n
        ? decoded.maxFeePerGas === expected.maxFeePerGas &&
          decoded.maxPriorityFeePerGas === expected.maxPriorityFeePerGas
        : decoded.gasPrice === expected.gasPrice

    if (
      !signed.isSigned() ||
      signed.type !== Number(type) ||
      (type === 0n && !signed.supports(Capability.EIP155ReplayProtection)) ||
      signed.getSenderAddress().toString().toLowerCase() !== expected.from ||
      decodedChainId !== parseRpcQuantity(expected.chainId) ||
      decoded.nonce !== expected.nonce ||
      decoded.gasLimit !== expected.gasLimit ||
      decodedTo !== expectedTo ||
      decoded.data !== expected.data ||
      decoded.value !== expected.value ||
      ('accessList' in decoded && (!Array.isArray(decoded.accessList) || decoded.accessList.length > 0)) ||
      !sameFees
    ) {
      throw new Error('mismatch')
    }
  } catch {
    throw new Error('Signed wallet call transaction does not match prepared transaction')
  }

  return { rawTransaction: rawTransaction as string }
}

export function snapshotPreparedWalletCallExecutionInput(
  input: PreparedWalletCallExecutionInput
): Readonly<PreparedWalletCallExecutionSnapshot> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid prepared wallet call execution input')
  }
  if (
    typeof input.id !== 'string' ||
    !input.id ||
    typeof input.origin !== 'string' ||
    !input.origin ||
    typeof input.chainId !== 'string'
  ) {
    throw new Error('Invalid prepared wallet call parent identity')
  }

  const chainId = parseRpcQuantity(input.chainId)
  if (chainId === undefined || chainId === 0n || chainId > MAX_SAFE_CHAIN_ID) {
    throw new Error('Invalid prepared wallet call chain')
  }

  const calls = Object.freeze(snapshotWalletCalls(input.calls))
  const managedSweep = input.managedSweep ? snapshotSweepEvidence(input.managedSweep) : undefined
  const preparedCalls = input.preparation?.calls
  if (
    typeof input.account !== 'string' ||
    !ADDRESS.test(input.account) ||
    !Array.isArray(preparedCalls) ||
    preparedCalls.length !== calls.length
  ) {
    throw new Error('Prepared wallet call batch does not match request')
  }
  if (
    managedSweep &&
    (managedSweep.account !== input.account.toLowerCase() ||
      managedSweep.chainId !== toRpcQuantity(chainId) ||
      JSON.stringify(managedSweep.calls) !== JSON.stringify(calls))
  ) {
    throw new Error('Managed sweep evidence does not match wallet calls')
  }

  let firstNonce: bigint | undefined
  let aggregateFee = 0n
  const preparedSnapshot = preparedCalls.map((prepared, index) => {
    if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
      throw new Error('Invalid prepared wallet call')
    }
    const transaction = snapshotTransaction(prepared.transaction, input)
    const call = calls[index]
    if (!call) throw new Error('Prepared wallet call has no matching request call')
    const nonce = parseRpcQuantity(transaction.nonce) as bigint
    const gasLimit = parseRpcQuantity(transaction.gasLimit) as bigint
    const feePerGas = parseRpcQuantity(
      transaction.type === '0x2' ? transaction.maxFeePerGas : transaction.gasPrice
    ) as bigint
    const reportedFee = parseRpcQuantity(prepared.maxFee)

    if (
      (call.to ? transaction.to !== call.to : transaction.to !== undefined) ||
      transaction.data !== call.data ||
      transaction.value !== call.value ||
      reportedFee === undefined ||
      reportedFee !== gasLimit * feePerGas
    ) {
      throw new Error('Prepared wallet call transaction does not match request')
    }
    if (reportedFee > maxFee(transaction)) {
      throw new Error('Prepared wallet call transaction fee exceeds Wren hard limit')
    }

    if (firstNonce === undefined) firstNonce = nonce
    if (nonce !== firstNonce + BigInt(index) || nonce > MAX_UINT256) {
      throw new Error('Prepared wallet call nonces are not contiguous')
    }
    aggregateFee += reportedFee
    if (aggregateFee > maxFee(transaction)) {
      throw new Error('Prepared wallet call batch fee exceeds Wren hard limit')
    }
    return Object.freeze({ transaction, maxFee: toRpcQuantity(reportedFee) })
  })

  if (parseRpcQuantity(input.preparation.maxFee) !== aggregateFee) {
    throw new Error('Prepared wallet call batch fee does not match transactions')
  }

  return Object.freeze({
    id: input.id,
    origin: input.origin,
    account: input.account.toLowerCase(),
    chainId: toRpcQuantity(chainId),
    calls,
    preparation: Object.freeze({
      calls: Object.freeze(preparedSnapshot),
      maxFee: toRpcQuantity(aggregateFee)
    }),
    ...(managedSweep ? { managedSweep } : {})
  })
}

export async function executePreparedWalletCallBatch(
  input: PreparedWalletCallExecutionInput,
  dependencies: PreparedWalletCallExecutionDependencies
) {
  const snapshot = snapshotPreparedWalletCallExecutionInput(input)

  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    typeof dependencies.signTransaction !== 'function' ||
    typeof dependencies.broadcast !== 'function' ||
    !dependencies.ledger ||
    typeof dependencies.ledger.reserveTransaction !== 'function' ||
    typeof dependencies.ledger.markTransactionSubmitted !== 'function' ||
    typeof dependencies.ledger.complete !== 'function' ||
    typeof dependencies.ledger.fail !== 'function' ||
    (dependencies.beforeCall !== undefined && typeof dependencies.beforeCall !== 'function')
  ) {
    throw new Error('Invalid prepared wallet call execution dependencies')
  }

  const signTransaction = dependencies.signTransaction.bind(dependencies)
  const broadcast = dependencies.broadcast.bind(dependencies)
  const beforeCall = dependencies.beforeCall?.bind(dependencies)
  const ledger = Object.freeze({
    reserveTransaction: dependencies.ledger.reserveTransaction.bind(dependencies.ledger),
    markTransactionSubmitted: dependencies.ledger.markTransactionSubmitted.bind(dependencies.ledger),
    complete: dependencies.ledger.complete.bind(dependencies.ledger),
    fail: dependencies.ledger.fail.bind(dependencies.ledger)
  })

  return executeWalletCallBatch(
    {
      id: snapshot.id,
      origin: snapshot.origin,
      account: snapshot.account,
      calls: snapshot.calls
    },
    {
      ledger,
      signCall: async (_call, index) => {
        const preparedCall = snapshot.preparation.calls[index]
        if (!preparedCall) throw new Error('Prepared wallet call is missing during execution')
        const transaction = preparedCall.transaction
        await beforeCall?.(transaction, index)
        const signed = await signTransaction(transaction, index)
        return verifySignedTransaction(signed?.rawTransaction, transaction)
      },
      broadcast
    }
  )
}
