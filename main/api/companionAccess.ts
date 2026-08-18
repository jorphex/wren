import accounts from '../accounts'
import provider from '../provider'
import store from '../store'
import { requireStoreAction } from '../store/action'
import { revokeExtensionCredential } from './extensionPairing'

/**
 * Fully revokes Companion access, including work already queued under a
 * source-bound origin. This is shared by explicit revocation and safe bundle
 * rotation retirement.
 */
export function revokeCompanionAccess(fingerprint: string) {
  const revoked = revokeExtensionCredential(fingerprint)
  const origins = (store('main.origins') || {}) as Record<string, { provenance?: string; sourceId?: string }>
  const sourceOriginIds = Object.entries(origins)
    .filter(([, origin]) => origin.provenance === 'companion' && origin.sourceId === fingerprint)
    .map(([originId]) => originId)
  requireStoreAction('removeDappGuardrailsForPrincipalOrigins')(sourceOriginIds)
  const accountIds = new Set([
    ...Object.keys((store('main.accounts') || {}) as Record<string, unknown>),
    ...Object.keys((store('main.permissions') || {}) as Record<string, unknown>)
  ])
  accountIds.forEach((account) => accounts.rejectUnapprovedRequestsForOrigins(account, sourceOriginIds))

  const selected = accounts.getSelectedAddresses()
  revoked.forEach(({ account, originIds }) => {
    if (selected.some((address) => address.toLowerCase() === account.toLowerCase())) {
      provider.accountsChanged(selected, originIds)
    }
  })
  return revoked
}
