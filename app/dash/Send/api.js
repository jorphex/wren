import link from '../../../resources/link'

export const resolveSendRecipient = (value) => link.invoke('send:resolveRecipient', value)
export const maxSendAmount = (chainId, assetAddress, recipient) =>
  link.invoke('send:maxAmount', chainId, assetAddress, recipient)
export const queueSend = (draft) => link.invoke('send:queue', draft)
