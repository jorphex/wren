import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import type { MessageTypeProperty } from '@metamask/eth-sig-util'
import type { Eip3009Authorization, TypedMessage } from '../../resources/domain/typedData'

const TRANSFER_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' }
]
const CANCEL_FIELDS = [
  { name: 'authorizer', type: 'address' },
  { name: 'nonce', type: 'bytes32' }
]
const MAX_UINT256 = (1n << 256n) - 1n

const matchesType = (actual: MessageTypeProperty[] | undefined, expected: readonly MessageTypeProperty[]) =>
  actual?.length === expected.length &&
  expected.every(({ name, type }, index) => actual[index]?.name === name && actual[index]?.type === type)

const hasDomainField = (
  domain: Record<string, unknown>,
  fields: MessageTypeProperty[] | undefined,
  name: string,
  type: string
) =>
  domain[name] !== undefined && fields?.some((field) => field.name === name && field.type === type) === true

const address = (value: unknown) =>
  typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) ? value : undefined

const quantity = (value: unknown) => {
  if (!['bigint', 'number', 'string'].includes(typeof value)) return
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return
  try {
    const parsed = BigInt(value as bigint | number | string)
    return parsed >= 0n && parsed <= MAX_UINT256 ? parsed.toString(10) : undefined
  } catch {
    return
  }
}

const nonce = (value: unknown) =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value : undefined

export function getEip3009Authorization(typedMessage: TypedMessage): Eip3009Authorization | undefined {
  if (typedMessage.version !== SignTypedDataVersion.V4 || Array.isArray(typedMessage.data)) return

  const { domain, message, primaryType, types } = typedMessage.data
  if (
    !hasDomainField(domain, types.EIP712Domain, 'chainId', 'uint256') ||
    !hasDomainField(domain, types.EIP712Domain, 'verifyingContract', 'address')
  ) {
    return
  }

  const verifyingContract = address(domain.verifyingContract)
  const authorizationNonce = nonce(message['nonce'])
  if (!verifyingContract || !authorizationNonce) return

  if (primaryType === 'CancelAuthorization') {
    const authorizer = address(message['authorizer'])
    if (!authorizer || !matchesType(types[primaryType], CANCEL_FIELDS)) return
    return {
      kind: 'cancel',
      primaryType,
      verifyingContract,
      authorizer,
      nonce: authorizationNonce,
      grantsAuthority: false,
      maximumAmount: false
    }
  }

  if (primaryType !== 'TransferWithAuthorization' && primaryType !== 'ReceiveWithAuthorization') {
    return
  }
  if (!matchesType(types[primaryType], TRANSFER_FIELDS)) return

  const from = address(message['from'])
  const to = address(message['to'])
  const value = quantity(message['value'])
  const validAfter = quantity(message['validAfter'])
  const validBefore = quantity(message['validBefore'])
  if (!from || !to || value === undefined || validAfter === undefined || validBefore === undefined) return

  return {
    kind: primaryType === 'TransferWithAuthorization' ? 'transfer' : 'receive',
    primaryType,
    verifyingContract,
    authorizer: from,
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce: authorizationNonce,
    grantsAuthority: BigInt(value) > 0n,
    maximumAmount: BigInt(value) === MAX_UINT256
  }
}
