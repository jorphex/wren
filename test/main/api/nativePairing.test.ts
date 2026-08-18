import store from '../../../main/store'
import {
  authorizeNativePeer,
  respondToNativePairing,
  revokeNativePeerCredential,
  resetNativePairingForTests
} from '../../../main/api/nativePairing'
import { generatePeerAuthKeyPair, peerAuthFingerprint } from '../../../main/api/peerAuth'
import type { NativePeerCredential } from '../../../main/store/state/types/peerCredential'
import { transitionNotification } from '../../../resources/store/notifications'
import accounts from '../../../main/accounts'

jest.mock('../../../main/store')
jest.mock('../../../main/accounts', () => ({
  getSelectedAddresses: jest.fn(() => []),
  rejectUnapprovedRequestsForOrigins: jest.fn()
}))
jest.mock('../../../main/provider', () => ({ accountsChanged: jest.fn() }))

const keys = generatePeerAuthKeyPair()
const fingerprint = peerAuthFingerprint(keys.publicKey)
const credential: NativePeerCredential = {
  protocolVersion: 3,
  kind: 'native',
  installationId: '11111111-1111-4111-8111-111111111111',
  publicKey: keys.publicKey,
  fingerprint,
  pairedAt: 1_000
}

beforeEach(() => {
  store.clear()
  store.set('view', { notify: '', notifyData: {}, notifyQueue: [] })
  store.set('main.nativePeerCredentials', { [fingerprint]: credential })
  store.set('main.accounts', { account: {}, pendingOnly: {} })
  store.set('main.origins', {})
  store.set('main.permissions', {})
  store.notify = jest.fn((type = '', data = {}, options = {}) => {
    store.set('view', transitionNotification(store('view'), type, data, options))
  })
  store.removeNativePeerCredential = jest.fn()
  store.removeDappGuardrailsForPrincipalOrigins = jest.fn()
  store.toggleAccess = jest.fn()
})

afterEach(resetNativePairingForTests)

it('requires explicit matching-code consent and deduplicates the same identity', async () => {
  const first = authorizeNativePeer(credential, '123456')
  const second = authorizeNativePeer(credential, '123456')
  expect(store.notify).toHaveBeenCalledTimes(1)
  expect(store.notify.mock.calls[0]).toEqual([
    'nativeConnect',
    expect.objectContaining({ fingerprint, pairingCode: '123456', requestId: expect.any(String) })
  ])
  const requestId = store.notify.mock.calls[0][1].requestId
  expect(respondToNativePairing(requestId, true)).toBe(true)
  await expect(first).resolves.toBe(true)
  await expect(second).resolves.toBe(true)
  expect(respondToNativePairing(requestId, true)).toBe(false)
})

it('revokes native grants for exactly the authenticated fingerprint', () => {
  store.set('main.origins', {
    native: { provenance: 'native', sourceId: fingerprint },
    other: { provenance: 'native', sourceId: 'A'.repeat(43) }
  })
  store.set('main.permissions', {
    account: { native: {}, other: {} }
  })
  expect(revokeNativePeerCredential(fingerprint)).toEqual([{ account: 'account', originIds: ['native'] }])
  expect(store.removeNativePeerCredential).toHaveBeenCalledWith(fingerprint)
  expect(store.toggleAccess).toHaveBeenCalledWith('account', 'native', false)
  expect(store.toggleAccess).not.toHaveBeenCalledWith('account', 'other', false)
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith('account', ['native'])
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith('pendingOnly', ['native'])
})
