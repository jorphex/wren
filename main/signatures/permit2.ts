import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import type { MessageTypeProperty } from '@metamask/eth-sig-util'
import type { Permit2Authority, Permit2Permission, TypedMessage } from '../../resources/domain/typedData'

export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'

const DOMAIN = [
  { name: 'name', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]
const PERMIT_DETAILS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' }
]
const TOKEN_PERMISSIONS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' }
]
const PRIMARY_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' }
  ],
  PermitBatch: [
    { name: 'details', type: 'PermitDetails[]' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' }
  ],
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  PermitBatchTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions[]' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
} as const

const MAX_UINT160 = (1n << 160n) - 1n
const MAX_UINT256 = (1n << 256n) - 1n

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const matchesType = (actual: MessageTypeProperty[] | undefined, expected: readonly MessageTypeProperty[]) =>
  actual?.length === expected.length &&
  expected.every(({ name, type }, index) => actual[index]?.name === name && actual[index]?.type === type)

const numericString = (value: unknown) => {
  if (!['bigint', 'number', 'string'].includes(typeof value)) return
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return

  try {
    const parsed = BigInt(value as bigint | number | string)
    if (parsed < 0n) return
    return parsed.toString(10)
  } catch {
    return
  }
}

const addressString = (value: unknown) =>
  typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) ? value : undefined

const allowancePermission = (value: unknown): Permit2Permission | undefined => {
  if (!isRecord(value)) return
  const token = addressString(value['token'])
  const amount = numericString(value['amount'])
  const expiration = numericString(value['expiration'])
  if (!token || amount === undefined || expiration === undefined) return
  return { token, amount, expiration }
}

const transferPermission = (value: unknown): Permit2Permission | undefined => {
  if (!isRecord(value)) return
  const token = addressString(value['token'])
  const amount = numericString(value['amount'])
  if (!token || amount === undefined) return
  return { token, amount }
}

const permissions = (
  value: unknown,
  batch: boolean,
  parse: (permission: unknown) => Permit2Permission | undefined
) => {
  const values = batch ? (Array.isArray(value) ? value : undefined) : [value]
  if (!values) return

  const parsed = values.map(parse)
  return parsed.every((permission): permission is Permit2Permission => permission !== undefined)
    ? parsed
    : undefined
}

const witnessPrimaryType = (primaryType: string) =>
  primaryType === 'PermitWitnessTransferFrom' || primaryType === 'PermitBatchWitnessTransferFrom'

const matchesWitnessType = (
  primaryType: string,
  primary: MessageTypeProperty[] | undefined,
  types: Record<string, MessageTypeProperty[]>
) => {
  if (!witnessPrimaryType(primaryType) || primary?.length !== 5) return false

  const batch = primaryType === 'PermitBatchWitnessTransferFrom'
  const base = batch ? PRIMARY_TYPES.PermitBatchTransferFrom : PRIMARY_TYPES.PermitTransferFrom
  const witness = primary[4]
  return (
    matchesType(primary.slice(0, 4), base) &&
    witness?.name === 'witness' &&
    typeof witness.type === 'string' &&
    witness.type !== 'TokenPermissions' &&
    types[witness.type] !== undefined
  )
}

export function getPermit2Authority(typedMessage: TypedMessage): Permit2Authority | undefined {
  if (typedMessage.version !== SignTypedDataVersion.V4 || Array.isArray(typedMessage.data)) return

  const { domain, message, primaryType: rawPrimaryType, types } = typedMessage.data
  if (typeof rawPrimaryType !== 'string') return
  const primaryType = rawPrimaryType
  if (domain.name !== 'Permit2' || !matchesType(types.EIP712Domain, DOMAIN)) return

  const verifyingContract = addressString(domain.verifyingContract)
  const spender = addressString(message['spender'])
  if (!verifyingContract || !spender) return

  const allowance = primaryType === 'PermitSingle' || primaryType === 'PermitBatch'
  const transfer =
    primaryType === 'PermitTransferFrom' ||
    primaryType === 'PermitBatchTransferFrom' ||
    witnessPrimaryType(primaryType)
  if (!allowance && !transfer) return

  const batch = primaryType === 'PermitBatch' || primaryType.startsWith('PermitBatch')
  const witness = witnessPrimaryType(primaryType)
  if (
    allowance &&
    (!matchesType(types[primaryType], PRIMARY_TYPES[primaryType]) ||
      !matchesType(types['PermitDetails'], PERMIT_DETAILS))
  ) {
    return
  }
  if (
    transfer &&
    (!matchesType(types['TokenPermissions'], TOKEN_PERMISSIONS) ||
      (!witness &&
        !matchesType(types[primaryType], PRIMARY_TYPES[primaryType as keyof typeof PRIMARY_TYPES])) ||
      (witness && !matchesWitnessType(primaryType, types[primaryType], types)))
  ) {
    return
  }

  const authorityPermissions = allowance
    ? permissions(message['details'], batch, allowancePermission)
    : permissions(message['permitted'], batch, transferPermission)
  const deadline = numericString(allowance ? message['sigDeadline'] : message['deadline'])
  if (!authorityPermissions || deadline === undefined) return

  const maximum = allowance ? MAX_UINT160 : MAX_UINT256
  return {
    kind: allowance ? 'allowance' : 'transfer',
    primaryType: primaryType as Permit2Authority['primaryType'],
    verifyingContract,
    canonicalContract: verifyingContract.toLowerCase() === PERMIT2_ADDRESS,
    spender,
    deadline,
    permissions: authorityPermissions,
    batch,
    witness,
    grantsAuthority: authorityPermissions.some(({ amount }) => BigInt(amount) > 0n),
    maximumAmount: authorityPermissions.some(({ amount }) => BigInt(amount) === maximum)
  }
}
