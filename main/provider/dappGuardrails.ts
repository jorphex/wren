import crypto from 'crypto'

import store from '../store'
import type { AnyAccountRequest } from '../accounts/types'
import {
  evaluateDappGuardrail,
  lookupDappGuardrail,
  type DappGuardrail,
  type DappGuardrailIntent,
  type DappGuardrailViolation
} from '../../resources/domain/dappGuardrails'
import { parseRpcQuantity, toRpcQuantity } from '../../resources/domain/transaction/quantity'
import { requestDappGuardrailIntent } from './dappGuardrailIntents'

export class DappGuardrailError extends Error {
  readonly code = 4100
  readonly violations: readonly DappGuardrailViolation[]

  constructor(message: string, violations: readonly DappGuardrailViolation[] = []) {
    super(message)
    this.name = 'DappGuardrailError'
    this.violations = violations
  }
}

export type DappGuardrailReview = Readonly<{
  fingerprint: string
  mode: 'clear' | 'warn'
  violations: readonly DappGuardrailViolation[]
  policy?: DappGuardrail
  intent: DappGuardrailIntent
}>

function requestChainId(request: AnyAccountRequest) {
  const value =
    request.type === 'transaction'
      ? request.data.chainId
      : request.type === 'walletCalls'
        ? request.chainId
        : request.type === 'sign'
          ? request.data.context.requestChainId
          : request.type === 'signTypedData' || request.type === 'signErc20Permit'
            ? request.context.requestChainId
            : undefined
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? toRpcQuantity(BigInt(value)) : undefined
  }
  const parsed = parseRpcQuantity(value)
  return parsed !== undefined && parsed > 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
    ? toRpcQuantity(parsed)
    : undefined
}

const fingerprint = (value: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function reviewDappGuardrail(
  request: AnyAccountRequest,
  guardrails: unknown = store('main.dappGuardrails'),
  now = Date.now()
): DappGuardrailReview | undefined {
  const intent = requestDappGuardrailIntent(request)
  if (!intent) return undefined
  const chainId = requestChainId(request)
  if (!chainId) throw new DappGuardrailError('Request chain cannot be verified against dapp guardrails')

  if (request.type === 'transaction' && request.replacement?.kind === 'cancel') {
    return Object.freeze({
      fingerprint: fingerprint({
        version: 1,
        principal: { account: request.account.toLowerCase(), originId: request.origin, chainId },
        recovery: 'cancel',
        intent
      }),
      mode: 'clear' as const,
      violations: Object.freeze([]),
      intent
    })
  }

  let policy: DappGuardrail | undefined
  try {
    policy = lookupDappGuardrail(guardrails || {}, {
      account: request.account.toLowerCase(),
      originId: request.origin,
      chainId
    })
  } catch {
    throw new DappGuardrailError('Dapp guardrail state is invalid; request blocked')
  }

  const violations = policy ? evaluateDappGuardrail(policy, intent, now) : []
  if (policy?.mode === 'block' && violations.length) {
    throw new DappGuardrailError(
      `Dapp guardrail blocked this request: ${violations.map(({ message }) => message).join('; ')}`,
      violations
    )
  }
  const mode = policy?.mode === 'warn' && violations.length ? 'warn' : 'clear'
  return Object.freeze({
    fingerprint: fingerprint({
      version: 1,
      principal: { account: request.account.toLowerCase(), originId: request.origin, chainId },
      policy: policy || null,
      intent,
      violations
    }),
    mode,
    violations: Object.freeze(violations.map((violation) => Object.freeze({ ...violation }))),
    ...(policy ? { policy: Object.freeze({ ...policy }) } : {}),
    intent
  })
}

export function guardrailWarningData(review: DappGuardrailReview) {
  if (review.mode !== 'warn') return undefined
  return {
    fingerprint: review.fingerprint,
    title: 'Outside this dapp guardrail',
    confirmLabel: 'Review and proceed',
    message: review.violations.map(({ message }) => message).join('. ')
  }
}

export function assertDappGuardrailReviewStable(request: AnyAccountRequest) {
  const expected = request.guardrail
  if (!expected) throw new DappGuardrailError('Dapp guardrail review evidence is missing')
  const current = reviewDappGuardrail(request)
  if (!current || current.fingerprint !== expected.fingerprint || current.mode !== expected.mode) {
    throw new DappGuardrailError('Dapp guardrail changed before signing; review the request again')
  }
  if (current.mode === 'warn') {
    const approvals = 'approvals' in request && Array.isArray(request.approvals) ? request.approvals : []
    const approval = approvals.find(({ type }) => type === 'approveDappGuardrailWarning')
    if (!approval?.approved || approval.data?.['fingerprint'] !== current.fingerprint) {
      throw new DappGuardrailError('Dapp guardrail warning requires explicit approval')
    }
  }
  return current
}
