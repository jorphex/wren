import accounts from '../accounts'
import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { disconnectPeer } from './peerConnections'
import { PeerAuthFingerprintSchema } from './peerAuth'

export interface RevokedNativeAccess {
  account: string
  originIds: string[]
}

export function revokeNativePeerAccess(
  fingerprintInput: string,
  reason = 'Native credential revoked'
): RevokedNativeAccess[] {
  const fingerprint = PeerAuthFingerprintSchema.parse(fingerprintInput)
  requireStoreAction('removeNativePeerCredential')(fingerprint)
  disconnectPeer(fingerprint, reason)

  const origins = (store('main.origins') || {}) as Record<string, { provenance?: string; sourceId?: string }>
  const nativeOriginIds = Object.entries(origins)
    .filter(([, origin]) => origin.provenance === 'native' && origin.sourceId === fingerprint)
    .map(([originId]) => originId)
  requireStoreAction('removeDappGuardrailsForPrincipalOrigins')(nativeOriginIds)
  if (nativeOriginIds.length === 0) return []

  const nativeOrigins = new Set(nativeOriginIds)
  const permissions = (store('main.permissions') || {}) as Record<string, Record<string, unknown>>
  const accountIds = new Set([
    ...Object.keys((store('main.accounts') || {}) as Record<string, unknown>),
    ...Object.keys(permissions)
  ])
  const selected = accounts.getSelectedAddresses()
  const revoked = [...accountIds].flatMap((account) => {
    const grants = permissions[account] || {}
    const originIds = Object.keys(grants).filter((originId) => nativeOrigins.has(originId))
    originIds.forEach((originId) => requireStoreAction('toggleAccess')(account, originId, false))
    accounts.rejectUnapprovedRequestsForOrigins(account, nativeOriginIds)
    if (originIds.length === 0) return []
    return [{ account, originIds }]
  })
  revoked.forEach(({ account, originIds }) => {
    if (selected.some((address) => address.toLowerCase() === account.toLowerCase())) {
      provider.accountsChanged(selected, originIds)
    }
  })
  return revoked
}
