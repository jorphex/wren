import { keccak256 } from 'ethereum-cryptography/keccak'
import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils'

import type { WalletCall } from './walletCalls'

const MAX_WALLET_CALLS = 16
const MAX_WALLET_CALL_DATA_BYTES = 128 * 1024
const MAX_SIGNED_TRANSACTION_BYTES = 256 * 1024
const MAX_ERROR_MESSAGE_LENGTH = 240
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const MAX_UINT256 = (1n << 256n) - 1n

export interface WalletCallExecutionInput {
  id: string
  origin: string
  account: string
  calls: readonly WalletCall[]
}

export interface SignedWalletCall {
  rawTransaction: string
}

interface WalletCallExecutionLedger {
  reserveTransaction(origin: string, account: string, id: string, hash: string): void
  markTransactionSubmitted(origin: string, account: string, id: string, hash: string): void
  complete(origin: string, account: string, id: string): void
  fail(origin: string, account: string, id: string): void
}

interface WalletCallExecutionDependencies {
  ledger: WalletCallExecutionLedger
  signCall(call: Readonly<WalletCall>, index: number): Promise<SignedWalletCall>
  broadcast(rawTransaction: string, index: number): Promise<string>
}

function boundedError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
  const bounded = new Error((message.trim() || fallback).slice(0, MAX_ERROR_MESSAGE_LENGTH))
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number') {
    Object.assign(bounded, { code: error.code })
  }
  return bounded
}

export function snapshotWalletCalls(calls: readonly WalletCall[]) {
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > MAX_WALLET_CALLS) {
    throw new Error('Wallet call execution requires between 1 and 16 calls')
  }

  let dataBytes = 0
  return calls.map((call) => {
    if (!call || typeof call !== 'object' || Array.isArray(call)) throw new Error('Invalid wallet call')
    if (call.to !== undefined && (typeof call.to !== 'string' || !ADDRESS.test(call.to))) {
      throw new Error('Invalid wallet call destination')
    }
    if (typeof call.data !== 'string' || !DATA.test(call.data)) throw new Error('Invalid wallet call data')
    if (
      typeof call.value !== 'string' ||
      call.value.length > 66 ||
      !QUANTITY.test(call.value) ||
      BigInt(call.value) > MAX_UINT256
    ) {
      throw new Error('Invalid wallet call value')
    }

    dataBytes += (call.data.length - 2) / 2
    if (dataBytes > MAX_WALLET_CALL_DATA_BYTES) throw new Error('Wallet call data exceeds execution limit')
    return Object.freeze({
      ...(call.to ? { to: call.to.toLowerCase() } : {}),
      data: call.data.toLowerCase(),
      value: call.value.toLowerCase()
    })
  })
}

export function hashSignedTransaction(rawTransaction: unknown) {
  if (
    typeof rawTransaction !== 'string' ||
    rawTransaction.length > MAX_SIGNED_TRANSACTION_BYTES * 2 + 2 ||
    !DATA.test(rawTransaction) ||
    rawTransaction === '0x'
  ) {
    throw new Error('Invalid signed transaction bytes')
  }

  return `0x${bytesToHex(keccak256(hexToBytes(rawTransaction.slice(2))))}`
}

export async function executeWalletCallBatch(
  input: WalletCallExecutionInput,
  dependencies: WalletCallExecutionDependencies
) {
  const calls = snapshotWalletCalls(input.calls)
  const hashes: string[] = []
  let broadcastNeedsReconciliation = false

  try {
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index]
      if (!call) throw new Error('Wallet call is missing during execution')
      const signed = await dependencies.signCall(call, index)
      const rawTransaction = signed?.rawTransaction
      const hash = hashSignedTransaction(rawTransaction)
      dependencies.ledger.reserveTransaction(input.origin, input.account, input.id, hash)

      broadcastNeedsReconciliation = true
      const returnedHash = await dependencies.broadcast(rawTransaction, index)
      if (
        typeof returnedHash !== 'string' ||
        !HASH.test(returnedHash) ||
        returnedHash.toLowerCase() !== hash
      ) {
        throw new Error('Broadcast returned a mismatched transaction hash')
      }

      dependencies.ledger.markTransactionSubmitted(input.origin, input.account, input.id, hash)
      broadcastNeedsReconciliation = false
      hashes.push(hash)
    }

    dependencies.ledger.complete(input.origin, input.account, input.id)
    return hashes
  } catch (error) {
    const executionError = boundedError(error, 'Wallet call execution failed')
    if (broadcastNeedsReconciliation) throw executionError

    try {
      dependencies.ledger.fail(input.origin, input.account, input.id)
    } catch (closeError) {
      const closeMessage = boundedError(closeError, 'ledger close failed').message
      throw new Error(
        `${executionError.message.slice(0, 160)}; ledger close failed: ${closeMessage.slice(0, 48)}`
      )
    }
    throw executionError
  }
}
