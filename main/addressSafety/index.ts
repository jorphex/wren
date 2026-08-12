import { createHash } from 'crypto'

import type { TransactionRequest, WalletCallsRequest } from '../accounts/types'
import {
  MAX_OUTBOUND_ADDRESS_MEMORY,
  pruneOutboundAddressMemory
} from '../store/state/types/outboundAddressMemory'
import type { AddressSafetyAssessment } from './types'

const ADDRESS = /^0x[0-9a-f]{40}$/iu
const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const validProfileId = (value: unknown): value is string =>
  typeof value === 'string' && PROFILE_ID.test(value)

const normalizeAddress = (value: unknown) =>
  typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : undefined

const addressDigest = (instanceId: string, address: string) => {
  if (!validProfileId(instanceId)) throw new Error('Address safety requires a valid profile identity')
  return createHash('sha256').update(`wren-address-safety-v1:${instanceId}:${address}`, 'utf8').digest('hex')
}

const ends = (address: string) => ({ prefix: address.slice(2, 6), suffix: address.slice(-4) })

export const transactionOutboundTargets = (
  request: Pick<TransactionRequest, 'data' | 'recognizedActions'>
) => {
  const targets: unknown[] = [request.data?.to]
  for (const action of request.recognizedActions || []) {
    const data = action?.data as Record<string, unknown> | undefined
    if (!data) continue
    if (action.id === 'erc20:transfer') {
      targets.push((data['recipient'] as Record<string, unknown> | undefined)?.['address'])
    } else if (action.id === 'erc20:approve' || action.id === 'erc20:revoke') {
      targets.push((data['spender'] as Record<string, unknown> | undefined)?.['address'])
    }
  }
  return [...new Set(targets.flatMap((target) => normalizeAddress(target) || []))].slice(
    0,
    MAX_OUTBOUND_ADDRESS_MEMORY
  )
}

export const walletCallsOutboundTargets = (request: Pick<WalletCallsRequest, 'calls'>) =>
  [...new Set((request.calls || []).flatMap((call) => normalizeAddress(call?.to) || []))].slice(
    0,
    MAX_OUTBOUND_ADDRESS_MEMORY
  )

export const recordOutboundAddresses = (
  value: unknown,
  instanceId: string,
  addresses: readonly unknown[],
  now = Date.now()
) => {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid address-safety timestamp')
  const memory = pruneOutboundAddressMemory(value, now)
  for (const candidate of addresses.slice(0, MAX_OUTBOUND_ADDRESS_MEMORY)) {
    const address = normalizeAddress(candidate)
    if (!address) continue
    const digest = addressDigest(instanceId, address)
    memory[digest] = { digest, ...ends(address), lastSubmittedAt: now }
  }
  return pruneOutboundAddressMemory(memory, now)
}

export const assessOutboundAddresses = (
  value: unknown,
  instanceId: string,
  addresses: readonly unknown[],
  assessedAt = Date.now()
): AddressSafetyAssessment => {
  if (!Number.isSafeInteger(assessedAt) || assessedAt < 0) {
    throw new Error('Invalid address-safety timestamp')
  }
  const memory = pruneOutboundAddressMemory(value, assessedAt)
  const entries = Object.values(memory)
  const profileAvailable = validProfileId(instanceId)
  const targets = [...new Set(addresses.flatMap((candidate) => normalizeAddress(candidate) || []))]
    .slice(0, MAX_OUTBOUND_ADDRESS_MEMORY)
    .map((address) => {
      const exact = profileAvailable ? memory[addressDigest(instanceId, address)] : undefined
      if (exact) return { address, state: 'previous' as const, lastSubmittedAt: exact.lastSubmittedAt }
      const fingerprint = ends(address)
      const lookalike = entries.some(
        (entry) => entry.prefix === fingerprint.prefix && entry.suffix === fingerprint.suffix
      )
      return { address, state: lookalike ? ('lookalike' as const) : ('new' as const) }
    })
  const fingerprint = createHash('sha256')
    .update(targets.map(({ address, state }) => `${address}:${state}`).join('|'), 'utf8')
    .digest('hex')
  return Object.freeze({ assessedAt, fingerprint, targets: Object.freeze(targets) })
}
