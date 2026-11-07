import { MAX_UINT256 } from './quantity'

const MAX_UINT256_DECIMAL = MAX_UINT256.toString(10)

export function hasSimulationEffects(simulation?: {
  status?: string
  source?: string
  effectsEvidence?: { source?: string }
}) {
  return (
    simulation?.status === 'succeeded' &&
    (simulation.source === 'eth_simulateV1' ||
      (simulation.source === 'eth_call' && simulation.effectsEvidence?.source === 'debug_traceCall'))
  )
}

interface EffectCandidate extends Record<string, unknown> {
  owner?: unknown
  type?: unknown
  standard?: unknown
  amount?: unknown
  approved?: unknown
}

function isRecord(value: unknown): value is EffectCandidate {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isBroadTokenAuthorityEffect(effect: unknown, account: unknown) {
  if (!isRecord(effect) || typeof account !== 'string' || typeof effect.owner !== 'string') return false
  if (effect.owner.toLowerCase() !== account.toLowerCase()) return false

  return (
    (effect.type === 'approval' && effect.standard === 'erc20' && effect.amount === MAX_UINT256_DECIMAL) ||
    (effect.type === 'operator-approval' && effect.approved === true)
  )
}
