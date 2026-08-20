import { getAddress, getCreateAddress, keccak256 } from 'ethers'

import { MAX_TOKEN_AMOUNT_INPUT_LENGTH, MAX_TOKEN_DECIMALS } from '../token/amount'
import { MAX_UINT256, toRpcQuantity } from '../transaction/quantity'

export const MAX_DEPLOYMENT_INITCODE_BYTES = 49_152
export const MAX_DEPLOYMENT_INITCODE_HEX_LENGTH = 2 + MAX_DEPLOYMENT_INITCODE_BYTES * 2
export const MAX_DEPLOYMENT_VALUE_INPUT_LENGTH = MAX_TOKEN_AMOUNT_INPUT_LENGTH
export const MAX_DEPLOYMENT_DECIMALS = MAX_TOKEN_DECIMALS
export const MAX_DEPLOYMENT_PENDING_NONCE = (1n << 64n) - 2n

export const DEPLOYMENT_DOMAIN_ERROR_CODES = Object.freeze([
  'invalid-draft',
  'invalid-account',
  'invalid-chain-id',
  'invalid-initcode',
  'initcode-too-large',
  'invalid-decimals',
  'invalid-value',
  'value-precision',
  'value-overflow',
  'invalid-pending-nonce'
] as const)

export type DeploymentDomainErrorCode = (typeof DEPLOYMENT_DOMAIN_ERROR_CODES)[number]

const DEPLOYMENT_DOMAIN_ERROR_MESSAGES: Readonly<Record<DeploymentDomainErrorCode, string>> = Object.freeze({
  'invalid-draft': 'Deployment draft is invalid',
  'invalid-account': 'Deployment account is invalid',
  'invalid-chain-id': 'Deployment chain is invalid',
  'invalid-initcode': 'Deployment creation data is invalid',
  'initcode-too-large': 'Deployment creation data is too large',
  'invalid-decimals': 'Deployment network decimals are invalid',
  'invalid-value': 'Deployment value is invalid',
  'value-precision': 'Deployment value has too many decimal places',
  'value-overflow': 'Deployment value exceeds uint256',
  'invalid-pending-nonce': 'Deployment pending nonce is invalid'
})

export class DeploymentDomainError extends Error {
  readonly code: DeploymentDomainErrorCode

  constructor(code: DeploymentDomainErrorCode) {
    super(DEPLOYMENT_DOMAIN_ERROR_MESSAGES[code])
    this.name = 'DeploymentDomainError'
    this.code = code
  }
}

/** The renderer-owned deployment fields. Constructor data is already part of initcode. */
export interface DeploymentDraft {
  readonly account: string
  readonly chainId: number
  readonly initcode: string
  readonly value: string
}

/** A validated snapshot suitable for binding to preparation evidence. */
export interface PreparedDeploymentDraft {
  readonly account: string
  readonly chainId: string
  readonly initcode: string
  readonly value: string
}

export interface DeploymentInitcodeEvidence {
  readonly bytes: number
  readonly hash: string
}

export interface DeploymentTransaction {
  readonly from: string
  readonly chainId: string
  readonly data: string
  readonly value: string
}

const DEPLOYMENT_DRAFT_KEYS = ['account', 'chainId', 'initcode', 'value'] as const
const DECIMAL_VALUE = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u
const CANONICAL_PENDING_NONCE = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u

function fail(code: DeploymentDomainErrorCode): never {
  throw new DeploymentDomainError(code)
}

function canonicalDeploymentAccount(value: unknown): string {
  if (typeof value !== 'string') fail('invalid-account')
  try {
    return getAddress(value).toLowerCase()
  } catch {
    return fail('invalid-account')
  }
}

function canonicalDeploymentChainId(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail('invalid-chain-id')
  return toRpcQuantity(BigInt(value as number))
}

function assertExactDraft(input: unknown): asserts input is DeploymentDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-draft')

  const keys = Object.keys(input)
  if (
    keys.length !== DEPLOYMENT_DRAFT_KEYS.length ||
    DEPLOYMENT_DRAFT_KEYS.some((key) => !keys.includes(key))
  ) {
    fail('invalid-draft')
  }
}

export function normalizeDeploymentInitcode(value: unknown): string {
  if (typeof value !== 'string') fail('invalid-initcode')
  if (value.length > MAX_DEPLOYMENT_INITCODE_HEX_LENGTH) fail('initcode-too-large')
  if (!/^0x(?:[0-9a-fA-F]{2})+$/u.test(value)) {
    fail('invalid-initcode')
  }
  return value.toLowerCase()
}

export function inspectDeploymentInitcode(value: unknown): DeploymentInitcodeEvidence {
  const initcode = normalizeDeploymentInitcode(value)
  return Object.freeze({
    bytes: (initcode.length - 2) / 2,
    hash: keccak256(initcode)
  })
}

/** Parse a human decimal value using only the trusted network decimal count. */
export function parseDeploymentValue(value: unknown, decimals: unknown): string {
  if (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > MAX_TOKEN_DECIMALS) {
    fail('invalid-decimals')
  }
  if (value === '') return '0x0'
  if (
    typeof value !== 'string' ||
    value.length > MAX_DEPLOYMENT_VALUE_INPUT_LENGTH ||
    !DECIMAL_VALUE.test(value)
  ) {
    fail('invalid-value')
  }

  const [whole = '0', fraction = ''] = value.split('.')
  if (fraction.length > (decimals as number)) fail('value-precision')

  const baseUnitDigits = `${whole || '0'}${fraction.padEnd(decimals as number, '0')}`.replace(
    /^0+(?=[0-9])/u,
    ''
  )
  const amount = BigInt(baseUnitDigits)
  if (amount > MAX_UINT256) fail('value-overflow')
  return toRpcQuantity(amount)
}

export function snapshotDeploymentDraft(input: unknown, decimals: unknown): PreparedDeploymentDraft {
  assertExactDraft(input)
  return Object.freeze({
    account: canonicalDeploymentAccount(input.account),
    chainId: canonicalDeploymentChainId(input.chainId),
    initcode: normalizeDeploymentInitcode(input.initcode),
    value: parseDeploymentValue(input.value, decimals)
  })
}

export function buildDeploymentTransaction(input: unknown, decimals: unknown): DeploymentTransaction {
  const draft = snapshotDeploymentDraft(input, decimals)
  return Object.freeze({
    from: draft.account,
    chainId: draft.chainId,
    data: draft.initcode,
    value: draft.value
  })
}

export function parseDeploymentPendingNonce(value: unknown): bigint {
  if (typeof value !== 'string' || !CANONICAL_PENDING_NONCE.test(value)) fail('invalid-pending-nonce')
  const nonce = BigInt(value)
  if (nonce > MAX_DEPLOYMENT_PENDING_NONCE) fail('invalid-pending-nonce')
  return nonce
}

export function deriveProvisionalDeploymentAddress(account: unknown, pendingNonce: unknown): string {
  const from = canonicalDeploymentAccount(account)
  const nonce = parseDeploymentPendingNonce(pendingNonce)
  return getCreateAddress({ from, nonce }).toLowerCase()
}
