import link from '../../../resources/link'

export const resolveSendRecipient = (value) => link.invoke('send:resolveRecipient', value)
export const maxSendAmount = (request) => link.invoke('send:maxAmount', request)
export const queueSend = (draft) => link.invoke('send:queue', draft)
export const quoteSweep = (request) => link.invoke('send:quoteSweep', request)
export const queueSweep = (request) => link.invoke('send:queueSweep', request)
