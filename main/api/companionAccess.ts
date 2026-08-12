import accounts from '../accounts'
import provider from '../provider'
import { revokeExtensionCredential } from './extensionPairing'

/**
 * Fully revokes Companion access, including work already queued under a
 * source-bound origin. This is shared by explicit revocation and safe bundle
 * rotation retirement.
 */
export function revokeCompanionAccess(fingerprint: string) {
  const revoked = revokeExtensionCredential(fingerprint)
  const selected = accounts.getSelectedAddresses()
  revoked.forEach(({ account, originIds }) => {
    accounts.rejectUnapprovedRequestsForOrigins(account, originIds)
    if (selected.some((address) => address.toLowerCase() === account.toLowerCase())) {
      provider.accountsChanged(selected, originIds)
    }
  })
  return revoked
}
