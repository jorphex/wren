import { randomUUID } from 'crypto'

import type { AnyAccountRequest } from '../accounts/types'
import { RequestStatus } from '../accounts/types'
import { requireStoreAction } from '../store/action'
import { ActivityEntrySchema, type ActivityEntry } from '../store/state/types/activity'
import { parseRpcQuantity } from '../../resources/domain/transaction/quantity'

type CanonicalActivityOutcome = ActivityEntry['outcome']
export type ActivityOutcome = CanonicalActivityOutcome | 'dropped'

const normalizedOutcome = (outcome: ActivityOutcome): CanonicalActivityOutcome =>
  outcome === 'dropped' ? 'replaced' : outcome

const chainIdFor = (request: AnyAccountRequest) => {
  const valueAt = (source: unknown, ...keys: string[]) => {
    let value = source
    for (const key of keys) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
      value = Reflect.get(value, key)
    }
    return value
  }

  let value: unknown
  if (request.type === 'transaction') value = valueAt(request, 'data', 'chainId')
  else if (request.type === 'sign') value = valueAt(request, 'data', 'context', 'requestChainId')
  else if (request.type === 'signTypedData' || request.type === 'signErc20Permit') {
    value = valueAt(request, 'context', 'requestChainId')
  } else if (request.type === 'addToken') value = valueAt(request, 'token', 'chainId')
  else if (request.type === 'walletCalls' || request.type === 'eip7702Revoke') {
    value = valueAt(request, 'chainId')
  } else if (request.type === 'addChain') value = valueAt(request, 'chain', 'id')
  else value = valueAt(request, 'permission', 'caveats', '0', 'value', 'chains', '0')

  const parsed =
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? BigInt(value)
      : parseRpcQuantity(value)
  return parsed !== undefined && parsed > 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(parsed)
    : undefined
}

const inferredOutcome = (request: AnyAccountRequest): CanonicalActivityOutcome | undefined => {
  if (request.status === RequestStatus.Declined) return 'declined'
  if (request.status === RequestStatus.Error) return 'failed'
  if (request.status === RequestStatus.Confirmed) return 'confirmed'
  if (request.status === RequestStatus.Success) return 'completed'
  if (
    request.status === RequestStatus.Sent ||
    request.status === RequestStatus.Verifying ||
    request.status === RequestStatus.Confirming
  ) {
    return 'submitted'
  }
  return undefined
}

export const requestActivityEntry = (
  request: AnyAccountRequest,
  outcome: ActivityOutcome | undefined = inferredOutcome(request),
  completedAt = Date.now()
): ActivityEntry | undefined => {
  try {
    if (!outcome) return

    const chainId = chainIdFor(request)
    const candidate = {
      id: request.activityId || randomUUID(),
      account: request.account.toLowerCase(),
      origin: request.origin.slice(0, 256),
      type: request.type,
      outcome: normalizedOutcome(outcome),
      createdAt: Math.min(request.created ?? completedAt, completedAt),
      completedAt,
      ...(chainId === undefined ? {} : { chainId })
    }
    const parsed = ActivityEntrySchema.safeParse(candidate)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const recordRequestActivity = (request: AnyAccountRequest, outcome?: ActivityOutcome) => {
  const entry = requestActivityEntry(request, outcome)
  if (!entry) return
  try {
    requireStoreAction('recordActivity')(entry)
    return entry
  } catch {
    // History is secondary: persistence failure must never alter the request response lifecycle.
    return
  }
}
