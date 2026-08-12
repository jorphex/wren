import signatureTypes from './types'
import { SignTypedDataVersion, MessageTypeProperty } from '@metamask/eth-sig-util'

import type { TypedMessage, TypedSignatureRequestType } from '../accounts/types'

const matchesMsgType = (properties: MessageTypeProperty[], required: MessageTypeProperty[]) =>
  properties.length === required.length &&
  required.every(
    ({ name, type }, index) => properties[index]?.name === name && properties[index]?.type === type
  )

const matchesMessage = (message: Record<string, unknown>, required: MessageTypeProperty[]) =>
  required.every(({ name }) => message[name] !== undefined)

const matchesDomainFilter = (
  domain: object,
  properties: MessageTypeProperty[] | undefined,
  domainFilter: MessageTypeProperty[]
) =>
  Boolean(properties) &&
  domainFilter.every(
    ({ name, type }) =>
      name in domain && properties?.some((property) => property.name === name && property.type === type)
  )

export const identify = ({ data }: TypedMessage<SignTypedDataVersion>): TypedSignatureRequestType => {
  const identified = Object.entries(signatureTypes).find(
    ([, { domainFilter, primaryType, types: requiredTypes }]) => {
      if (!('types' in data && 'message' in data)) return
      if (data.primaryType !== primaryType) return

      return Object.entries(requiredTypes).every(
        ([name, properties]) =>
          data.types[name] &&
          matchesMsgType(data.types[name], properties) &&
          matchesMessage(data.message, properties) &&
          matchesDomainFilter(data.domain, data.types.EIP712Domain, domainFilter)
      )
    }
  )

  return identified ? (identified[0] as TypedSignatureRequestType) : 'signTypedData'
}

export { isSignatureRequest } from '../../resources/domain/request'
export { validateErc1271Signature } from './erc1271'
export type { Erc1271Validation } from './erc1271'
