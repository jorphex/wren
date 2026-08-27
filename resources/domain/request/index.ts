import type {
  AccountRequest,
  RequestType,
  SignatureRequest,
  SignTypedDataRequest,
  TransactionRequest
} from '../../../main/accounts/types'
export const isCancelableRequest = (status: string): boolean => {
  return !['sent', 'sending', 'verifying', 'confirming', 'confirmed', 'error', 'declined'].includes(status)
}

const requestStatusClasses: Record<string, string> = {
  success: 'signerRequestSuccess',
  pending: 'signerRequestPending',
  error: 'signerRequestError',
  declined: 'signerRequestDeclined'
}

export const getSignatureRequestClass = ({ status = '' }) =>
  ['signerRequest', requestStatusClasses[status]].filter(Boolean).join(' ')

type FeeDraftListener = (handlerId: string) => void

const unsafeTransactionFeeDrafts = new Set<string>()
const feeDraftListeners = new Set<FeeDraftListener>()

export const isTransactionFeeDraftSafe = (handlerId?: string): boolean =>
  !handlerId || !unsafeTransactionFeeDrafts.has(handlerId)

export const setTransactionFeeDraftSafety = (handlerId: string | undefined, safe: boolean): void => {
  if (!handlerId) return

  const wasSafe = isTransactionFeeDraftSafe(handlerId)
  if (safe) unsafeTransactionFeeDrafts.delete(handlerId)
  else unsafeTransactionFeeDrafts.add(handlerId)

  if (wasSafe !== safe) feeDraftListeners.forEach((listener) => listener(handlerId))
}

export const clearTransactionFeeDraftSafety = (handlerId?: string): void => {
  setTransactionFeeDraftSafety(handlerId, true)
}

export const subscribeToTransactionFeeDraftSafety = (listener: FeeDraftListener): (() => void) => {
  feeDraftListeners.add(listener)
  return () => feeDraftListeners.delete(listener)
}

export const isRequestInteractionLocked = (request: AccountRequest): boolean =>
  Boolean(
    ('locked' in request && request.locked) || request.mode === 'monitor' || request.status !== undefined
  )

export const isSignatureRequest = (request: AccountRequest): request is SignatureRequest => {
  return ['sign', 'signTypedData', 'signErc20Permit'].includes(request.type)
}

export const isTransactionRequest = (request: AccountRequest): request is TransactionRequest =>
  request.type === 'transaction'

export const isTypedMessageSignatureRequest = (request: AccountRequest): request is SignTypedDataRequest =>
  ['signTypedData', 'signErc20Permit'].includes(request.type)

const signingRequestTypes = new Set<RequestType>([
  'transaction',
  'sign',
  'signTypedData',
  'signErc20Permit',
  'walletCalls',
  'eip7702Revoke'
])

export const isSigningRequest = (request: AccountRequest): boolean => signingRequestTypes.has(request.type)

export const isPendingSigningRequest = (request: AccountRequest): boolean =>
  request.status !== 'sending' && isSigningRequest(request)

export const accountViewTitles: Record<RequestType, string> = {
  sign: 'Sign Message',
  signTypedData: 'Sign Data',
  signErc20Permit: 'Review request',
  transaction: 'Review transaction',
  access: 'Review Account Access',
  addChain: 'Review Network Request',
  switchChain: 'Review Network Change',
  addToken: 'Review Token Request',
  walletCalls: 'Review Call Batch',
  eip7702Revoke: 'Review request'
}
