import { getAddress } from 'ethers'

import { parseAccountCode } from '../../resources/domain/account/code'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import {
  createEip7702RevokeRequest,
  inspectSignedEip7702RevokeTransaction,
  parseEip7702RevokeRequest,
  type CreateEip7702RevokeRequest,
  type Eip7702RevokeRequest,
  type InspectedEip7702RevokeTransaction
} from '../transaction/eip7702'

type SoftwareSignerCallback = (error: unknown, rawTransaction?: unknown) => void

export type SoftwareEip7702RevokeSigner = Readonly<{
  type: unknown
  status: unknown
  addresses: unknown
  signEip7702Revoke: (index: number, request: Eip7702RevokeRequest, callback: SoftwareSignerCallback) => void
}>

export type SignedEip7702Revoke = Readonly<{
  rawTransaction: string
  evidence: InspectedEip7702RevokeTransaction
}>

export type Eip7702RevokePreflight = Readonly<{
  authorityCode: unknown
  latestNonce: unknown
  pendingNonce: unknown
}>

export type Eip7702RevocationResult = Readonly<{
  receiptStatus: 'success' | 'failed' | 'unavailable'
  revocationStatus: 'cleared' | 'skipped' | 'unavailable'
  reason: 'code-cleared' | 'code-remains' | 'receipt-unavailable' | 'code-unavailable'
}>

function normalizeAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  try {
    return getAddress(value)
  } catch {
    return
  }
}

export function assertSoftwareEip7702RevokeSigner(
  signer: SoftwareEip7702RevokeSigner,
  index: number,
  authority: string
) {
  if (signer.type !== 'ring' && signer.type !== 'seed') {
    throw new Error('EIP-7702 revocation requires a Ring or Seed signer')
  }
  if (typeof signer.signEip7702Revoke !== 'function') {
    throw new Error('Software signer cannot sign EIP-7702 revocation')
  }
  if (signer.status !== 'ok') throw new Error('Software signer must be unlocked')
  if (!Number.isSafeInteger(index) || index < 0 || !Array.isArray(signer.addresses)) {
    throw new Error('Invalid software signer address index')
  }

  const selectedAddress = normalizeAddress(signer.addresses[index])
  const expectedAuthority = normalizeAddress(authority)
  if (!selectedAddress || !expectedAuthority || selectedAddress !== expectedAuthority) {
    throw new Error('Software signer does not control the EIP-7702 authority')
  }
}

export function assertEip7702RevokePreflight(nonce: bigint, preflight: Eip7702RevokePreflight) {
  const accountCode = parseAccountCode(preflight.authorityCode)
  if (accountCode?.status !== 'delegated') {
    throw new Error('EIP-7702 authority is not delegated')
  }

  const latestNonce = parseRpcQuantity(preflight.latestNonce)
  const pendingNonce = parseRpcQuantity(preflight.pendingNonce)
  if (
    latestNonce === undefined ||
    pendingNonce === undefined ||
    toRpcQuantity(latestNonce) !== preflight.latestNonce ||
    toRpcQuantity(pendingNonce) !== preflight.pendingNonce
  ) {
    throw new Error('Invalid EIP-7702 authority nonce')
  }
  if (latestNonce !== nonce || pendingNonce !== nonce) {
    throw new Error('EIP-7702 revocation requires a stable account nonce')
  }
}

export function prepareSoftwareEip7702Revoke(
  signer: SoftwareEip7702RevokeSigner,
  index: number,
  input: CreateEip7702RevokeRequest,
  preflight: Eip7702RevokePreflight
): Eip7702RevokeRequest {
  const request = createEip7702RevokeRequest(input)
  assertSoftwareEip7702RevokeSigner(signer, index, request.authority)
  assertEip7702RevokePreflight(input.nonce, preflight)
  return request
}

export async function signSoftwareEip7702Revoke(
  signer: SoftwareEip7702RevokeSigner,
  index: number,
  request: Eip7702RevokeRequest,
  preflight: Eip7702RevokePreflight
): Promise<SignedEip7702Revoke> {
  const safeRequest = parseEip7702RevokeRequest(request)
  assertSoftwareEip7702RevokeSigner(signer, index, safeRequest.authority)
  assertEip7702RevokePreflight(BigInt(safeRequest.nonce), preflight)

  const rawTransaction = await new Promise<unknown>((resolve, reject) => {
    try {
      signer.signEip7702Revoke(index, safeRequest, (error, result) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)))
        else resolve(result)
      })
    } catch (error) {
      reject(error)
    }
  })
  if (typeof rawTransaction !== 'string') {
    throw new Error('Software signer returned an invalid EIP-7702 transaction')
  }

  return Object.freeze({
    rawTransaction,
    evidence: inspectSignedEip7702RevokeTransaction(rawTransaction, safeRequest)
  })
}

function parseReceiptStatus(receipt: unknown): 'success' | 'failed' | 'unavailable' {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return 'unavailable'
  const status = (receipt as Record<string, unknown>)['status']
  if (status === '0x1' || status === 1 || status === 1n) return 'success'
  if (status === '0x0' || status === 0 || status === 0n) return 'failed'
  return 'unavailable'
}

export async function verifyEip7702RevocationResult(
  receipt: unknown,
  readAuthorityCode: () => Promise<unknown>
): Promise<Eip7702RevocationResult> {
  const receiptStatus = parseReceiptStatus(receipt)
  if (receiptStatus === 'unavailable') {
    return Object.freeze({
      receiptStatus,
      revocationStatus: 'unavailable',
      reason: 'receipt-unavailable'
    })
  }

  try {
    const code = parseAccountCode(await readAuthorityCode())
    if (!code) {
      return Object.freeze({
        receiptStatus,
        revocationStatus: 'unavailable',
        reason: 'code-unavailable'
      })
    }
    if (code.status === 'no-code') {
      return Object.freeze({
        receiptStatus,
        revocationStatus: 'cleared',
        reason: 'code-cleared'
      })
    }
    return Object.freeze({
      receiptStatus,
      revocationStatus: 'skipped',
      reason: 'code-remains'
    })
  } catch {
    return Object.freeze({
      receiptStatus,
      revocationStatus: 'unavailable',
      reason: 'code-unavailable'
    })
  }
}
