import { getAddress } from 'ethers'

import {
  deriveProvisionalDeploymentAddress,
  inspectDeploymentInitcode,
  MAX_DEPLOYMENT_INITCODE_BYTES,
  parseDeploymentPendingNonce
} from '../../resources/domain/deployment'
import { MAX_UINT256, parseRpcQuantity } from '../../resources/domain/transaction/quantity'

import type { DeploymentTrustedMetadata } from './index'

type DeploymentTransactionBinding = Readonly<{
  chainId?: unknown
  data?: unknown
  from?: unknown
  to?: unknown
  value?: unknown
}>

const INSPECTION_ID = /^[0-9a-f]{32}$/u
const HASH = /^0x[0-9a-f]{64}$/u
const METADATA_KEYS = [
  'version',
  'inspectionId',
  'account',
  'chainId',
  'initcodeHash',
  'initcodeBytes',
  'value',
  'preparedAt',
  'expiresAt'
] as const
const OPTIONAL_METADATA_KEYS = ['provisionalAddress', 'pendingNonce'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function canonicalAddress(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid deployment account')
  try {
    return getAddress(value).toLowerCase()
  } catch {
    throw new Error('Invalid deployment account')
  }
}

function canonicalQuantity(value: unknown, label: string, maximum = MAX_UINT256): string {
  const parsed = parseRpcQuantity(value)
  if (parsed === undefined || parsed > maximum) throw new Error(`Invalid deployment ${label}`)
  return `0x${parsed.toString(16)}`
}

function assertExactMetadataKeys(metadata: Record<string, unknown>) {
  const keys = Object.keys(metadata)
  const allowed = new Set<string>([...METADATA_KEYS, ...OPTIONAL_METADATA_KEYS])
  if (
    METADATA_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(metadata, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new Error('Invalid deployment metadata')
  }
}

/**
 * Snapshot and bind deployment evidence to the exact creation transaction.
 * Fee, gas and nonce fields deliberately remain outside this binding because the
 * native review owns those adjustments.
 */
export function snapshotDeploymentMetadata(
  input: unknown,
  transaction: DeploymentTransactionBinding
): DeploymentTrustedMetadata {
  if (!isRecord(input) || !isRecord(transaction)) throw new Error('Invalid deployment metadata')
  assertExactMetadataKeys(input)

  if (input['version'] !== 1) throw new Error('Invalid deployment metadata version')
  if (typeof input['inspectionId'] !== 'string' || !INSPECTION_ID.test(input['inspectionId'])) {
    throw new Error('Invalid deployment inspection identity')
  }
  if (
    !Number.isSafeInteger(input['initcodeBytes']) ||
    (input['initcodeBytes'] as number) < 1 ||
    (input['initcodeBytes'] as number) > MAX_DEPLOYMENT_INITCODE_BYTES
  ) {
    throw new Error('Invalid deployment creation-data length')
  }
  if (typeof input['initcodeHash'] !== 'string' || !HASH.test(input['initcodeHash'])) {
    throw new Error('Invalid deployment creation-data hash')
  }
  if (
    !Number.isSafeInteger(input['preparedAt']) ||
    !Number.isSafeInteger(input['expiresAt']) ||
    (input['preparedAt'] as number) < 0 ||
    (input['expiresAt'] as number) <= (input['preparedAt'] as number)
  ) {
    throw new Error('Invalid deployment evidence time')
  }
  const preparedAt = input['preparedAt'] as number
  const expiresAt = input['expiresAt'] as number

  const account = canonicalAddress(input['account'])
  if (input['account'] !== account) throw new Error('Deployment account is not canonical')
  const chainId = canonicalQuantity(input['chainId'], 'chain')
  if (chainId === '0x0' || input['chainId'] !== chainId) throw new Error('Invalid deployment chain')
  const value = canonicalQuantity(input['value'], 'value')
  if (input['value'] !== value) throw new Error('Deployment value is not canonical')

  if (Object.prototype.hasOwnProperty.call(transaction, 'to') || transaction.to !== undefined) {
    throw new Error('Deployment transaction cannot have a destination')
  }
  const transactionAccount = canonicalAddress(transaction.from)
  const transactionChainId = canonicalQuantity(transaction.chainId, 'transaction chain')
  const transactionValue = canonicalQuantity(transaction.value, 'transaction value')
  if (transactionAccount !== account || transactionChainId !== chainId || transactionValue !== value) {
    throw new Error('Deployment transaction does not match its evidence')
  }

  const initcode = inspectDeploymentInitcode(transaction.data)
  if (initcode.bytes !== input['initcodeBytes'] || initcode.hash !== input['initcodeHash']) {
    throw new Error('Deployment creation data does not match its evidence')
  }

  const hasAddress = Object.prototype.hasOwnProperty.call(input, 'provisionalAddress')
  const hasNonce = Object.prototype.hasOwnProperty.call(input, 'pendingNonce')
  if (hasAddress !== hasNonce) throw new Error('Incomplete provisional deployment evidence')

  let provisionalAddress: string | undefined
  let pendingNonce: string | undefined
  if (hasAddress && hasNonce) {
    pendingNonce = canonicalQuantity(input['pendingNonce'], 'pending nonce', (1n << 64n) - 2n)
    parseDeploymentPendingNonce(pendingNonce)
    provisionalAddress = canonicalAddress(input['provisionalAddress'])
    if (
      input['pendingNonce'] !== pendingNonce ||
      input['provisionalAddress'] !== provisionalAddress ||
      deriveProvisionalDeploymentAddress(account, pendingNonce) !== provisionalAddress
    ) {
      throw new Error('Invalid provisional deployment evidence')
    }
  }

  return Object.freeze({
    version: 1,
    inspectionId: input['inspectionId'],
    account,
    chainId,
    initcodeHash: initcode.hash,
    initcodeBytes: initcode.bytes,
    value,
    preparedAt,
    expiresAt,
    ...(provisionalAddress && pendingNonce ? { provisionalAddress, pendingNonce } : {})
  })
}
