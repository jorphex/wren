import {
  generatePeerAuthKeyPair,
  peerAuthClientBundleFingerprint,
  peerAuthFingerprint
} from '../../../main/api/peerAuth'

import store from '../../../main/store'
import {
  authorizeExtension,
  commitExtensionPairing,
  respondToExtensionPairing,
  revokeExtensionCredential
} from '../../../main/api/extensionPairing'
import type { ExtensionPairingCandidate } from '../../../main/api/extensionAuth'
import { revokeCompanionAccess } from '../../../main/api/companionAccess'
import { registerAuthenticatedExtension } from '../../../main/api/extensionConnections'
import { transitionNotification } from '../../../resources/store/notifications'

jest.mock('../../../main/store')
jest.mock('../../../main/accounts', () => ({
  __esModule: true,
  default: {
    getSelectedAddresses: jest.fn(() => ['0x1111111111111111111111111111111111111111']),
    rejectUnapprovedRequestsForOrigins: jest.fn()
  }
}))
jest.mock('../../../main/provider', () => ({
  __esModule: true,
  default: { accountsChanged: jest.fn() }
}))

const accounts = require('../../../main/accounts').default
const provider = require('../../../main/provider').default

const installationId = '7a86842f-7c01-4d0d-b0f7-fc04e0acfd8f'

function candidate(marker: string, overrides = {}): ExtensionPairingCandidate {
  const control = generatePeerAuthKeyPair()
  const page = generatePeerAuthKeyPair()
  const publicKeys = { control: control.publicKey, page: page.publicKey }
  return {
    protocolVersion: 3,
    installationId,
    browser: 'chrome',
    extensionId: marker.repeat(32),
    publicKeys,
    fingerprint: peerAuthClientBundleFingerprint(publicKeys),
    pairingCode: '123456',
    pairedAt: 1000,
    ...overrides
  }
}

beforeEach(() => {
  store.clear()
  store.set('main.extensionCredentials', {})
  store.set('view', {
    notify: '',
    notifyData: {},
    notifyId: '',
    notifyOwner: '',
    notifyQueue: []
  })
  store.notify = jest.fn((type = '', data = {}, options = {}) => {
    store.set('view', transitionNotification(store('view'), type, data, options))
  })
  store.setExtensionCredential = jest.fn((credential) => {
    store.set('main.extensionCredentials', credential.fingerprint, credential)
  })
  store.removeExtensionCredential = jest.fn((fingerprint) => {
    const credentials = { ...(store('main.extensionCredentials') || {}) }
    delete credentials[fingerprint]
    store.set('main.extensionCredentials', credentials)
  })
  store.toggleAccess = jest.fn((account, originId) => {
    const grants = { ...(store('main.permissions', account) || {}) }
    delete grants[originId]
    store.set('main.permissions', account, grants)
  })
  accounts.getSelectedAddresses.mockClear()
  accounts.rejectUnapprovedRequestsForOrigins.mockClear()
  provider.accountsChanged.mockClear()
})

it('stores one atomic control and page key bundle only after consent and final acknowledgement', async () => {
  const pairing = candidate('a')
  const waiting = authorizeExtension(pairing)
  const request = store.notify.mock.calls[0][1]
  expect(request).toMatchObject({ fingerprint: pairing.fingerprint, pairingCode: pairing.pairingCode })

  expect(respondToExtensionPairing(request.requestId, true)).toBe(true)
  await expect(waiting).resolves.toBe(true)
  expect(store.setExtensionCredential).not.toHaveBeenCalled()
  expect(store('main.extensionCredentials')).toEqual({})

  expect(commitExtensionPairing(pairing)).toBe(true)
  expect(store.setExtensionCredential).toHaveBeenCalledWith(
    expect.objectContaining({ protocolVersion: 3, publicKeys: pairing.publicKeys })
  )
  expect(store('main.extensionCredentials', pairing.fingerprint)).toEqual(
    expect.objectContaining({ fingerprint: pairing.fingerprint })
  )
})

it('reuses only an exact bundle silently and never allows a page to open pairing', async () => {
  const paired = candidate('b')
  expect(commitExtensionPairing(paired)).toBe(true)
  await expect(authorizeExtension(paired)).resolves.toBe(true)
  expect(store.notify).not.toHaveBeenCalled()

  const unknown = candidate('c')
  await expect(authorizeExtension(unknown, undefined, false)).resolves.toBe(false)
  expect(store.notify).not.toHaveBeenCalled()
})

it('deduplicates concurrent consent and an aborted waiter does not cancel another session', async () => {
  const pairing = candidate('c')
  const firstController = new AbortController()
  const first = authorizeExtension(pairing, firstController.signal)
  const second = authorizeExtension(pairing)
  const request = store.notify.mock.calls[0][1]

  expect(store.notify).toHaveBeenCalledTimes(1)
  firstController.abort()
  await expect(first).resolves.toBe(false)
  expect(store('view.notify')).toBe('extensionConnect')

  expect(respondToExtensionPairing(request.requestId, true)).toBe(true)
  await expect(second).resolves.toBe(true)
})

it('retains the old principal until an exact reconnect confirms the replacement survived its final acknowledgement', async () => {
  const previous = candidate('d')
  expect(commitExtensionPairing(previous)).toBe(true)
  const replacement = candidate('e', { extensionId: previous.extensionId })
  const waiting = authorizeExtension(replacement)
  const request = store.notify.mock.calls[0][1]

  expect(respondToExtensionPairing(request.requestId, true)).toBe(true)
  await expect(waiting).resolves.toBe(true)
  expect(store.removeExtensionCredential).not.toHaveBeenCalled()
  expect(store('main.extensionCredentials', previous.fingerprint)).toBeDefined()

  expect(commitExtensionPairing(replacement)).toBe(true)
  expect(store.removeExtensionCredential).not.toHaveBeenCalled()
  expect(store('main.extensionCredentials', previous.fingerprint)).toBeDefined()
  expect(store('main.extensionCredentials', replacement.fingerprint)).toBeDefined()

  expect(commitExtensionPairing(replacement)).toBe(true)
  expect(store.removeExtensionCredential).toHaveBeenCalledWith(previous.fingerprint)
  expect(store('main.extensionCredentials', previous.fingerprint)).toBeUndefined()
})

it('uses full Companion cleanup when an acknowledged replacement retires the old principal', () => {
  const previous = candidate('e')
  const replacement = candidate('f', { extensionId: previous.extensionId })
  const account = '0x1111111111111111111111111111111111111111'
  commitExtensionPairing(previous)
  commitExtensionPairing(replacement)
  store.set('main.origins', { old: { provenance: 'companion', sourceId: previous.fingerprint } })
  store.set('main.permissions', account, { old: { handlerId: 'old' } })

  // The exact-new reconnect is the safe-rotation confirmation point.
  expect(commitExtensionPairing(replacement, revokeCompanionAccess)).toBe(true)
  expect(accounts.getSelectedAddresses).toHaveBeenCalledTimes(1)
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(account, ['old'])
  expect(provider.accountsChanged).toHaveBeenCalledWith([account], ['old'])
  expect(store('main.permissions', account)).toEqual({})
})

it('rejects a modified bundle during an active challenge instead of reusing consent', async () => {
  const first = candidate('f')
  const waiting = authorizeExtension(first)
  const replacement = candidate('g', { extensionId: first.extensionId })
  await expect(authorizeExtension(replacement)).resolves.toBe(false)
  expect(store.notify).toHaveBeenCalledTimes(1)
  respondToExtensionPairing(store.notify.mock.calls[0][1].requestId, false)
  await expect(waiting).resolves.toBe(false)
})

it('does not reuse an active prompt for another challenge code or competing bundle', async () => {
  const first = candidate('g')
  const waiting = authorizeExtension(first)
  await expect(authorizeExtension({ ...first, pairingCode: '654321' })).resolves.toBe(false)
  await expect(authorizeExtension(candidate('h', { extensionId: first.extensionId }))).resolves.toBe(false)
  expect(store.notify).toHaveBeenCalledTimes(1)

  respondToExtensionPairing(store.notify.mock.calls[0][1].requestId, false)
  await expect(waiting).resolves.toBe(false)
})

it('keeps a queued pairing active without clearing another notification workflow', async () => {
  store.notify('gasFeeWarning', { message: 'Review this fee' }, { id: 'fee-warning' })
  const waiting = authorizeExtension(candidate('i'))
  const request = store.notify.mock.calls[1][1]
  store.notify.mockClear()

  store.getObserver(`extension-pairing:${request.requestId}`).fire()
  expect(store('view.notify')).toBe('gasFeeWarning')
  expect(store('view.notifyQueue')).toHaveLength(2)
  expect(store.notify).not.toHaveBeenCalled()

  respondToExtensionPairing(request.requestId, false)
  await expect(waiting).resolves.toBe(false)
  expect(store('view.notifyId')).toBe('fee-warning')
  expect(store('view.notifyQueue')).toHaveLength(1)
})

it('rejects a removed queued pairing without clearing another workflow', async () => {
  store.notify('gasFeeWarning', { message: 'Review this fee' }, { id: 'fee-warning' })
  const waiting = authorizeExtension(candidate('j'))
  const request = store.notify.mock.calls[1][1]
  const pairing = store('view.notifyQueue')[1]
  store.notify('', {}, { expectedId: pairing.id })
  store.notify.mockClear()

  store.getObserver(`extension-pairing:${request.requestId}`).fire()
  await expect(waiting).resolves.toBe(false)
  expect(store.notify).not.toHaveBeenCalled()
  expect(store('view.notifyId')).toBe('fee-warning')
})

it('revokes the exact credential connection and every grant bound to its source fingerprint', () => {
  const pairing = candidate('k')
  commitExtensionPairing(pairing)
  const socket = { close: jest.fn(), disposeSession: jest.fn(), extensionFingerprint: undefined }
  registerAuthenticatedExtension(socket, pairing.fingerprint)
  const account = '0x1111111111111111111111111111111111111111'
  store.set('main.origins', {
    companion: { provenance: 'companion', sourceId: pairing.fingerprint },
    direct: { provenance: 'direct' }
  })
  store.set('main.permissions', account, {
    companion: { handlerId: 'companion' },
    direct: { handlerId: 'direct' }
  })

  expect(revokeExtensionCredential(pairing.fingerprint)).toEqual([{ account, originIds: ['companion'] }])
  expect(store.removeExtensionCredential).toHaveBeenCalledWith(pairing.fingerprint)
  expect(socket.disposeSession).toHaveBeenCalledTimes(1)
  expect(socket.close).toHaveBeenCalledWith(1008, 'Extension credential revoked')
  expect(store.toggleAccess).toHaveBeenCalledWith(account, 'companion', false)
  expect(store('main.permissions', account)).toEqual({ direct: { handlerId: 'direct' } })
})

it('rejects ungranted first-access requests when Companion access is revoked', () => {
  const pairing = candidate('q')
  commitExtensionPairing(pairing)
  const granted = '0x1111111111111111111111111111111111111111'
  const pendingOnly = '0x2222222222222222222222222222222222222222'
  store.set('main.accounts', { [granted]: {}, [pendingOnly]: {} })
  store.set('main.origins', {
    companion: { provenance: 'companion', sourceId: pairing.fingerprint },
    other: { provenance: 'companion', sourceId: 'another-fingerprint' }
  })
  store.set('main.permissions', {
    [granted]: { companion: { handlerId: 'companion' } }
  })

  revokeCompanionAccess(pairing.fingerprint)

  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(granted, ['companion'])
  expect(accounts.rejectUnapprovedRequestsForOrigins).toHaveBeenCalledWith(pendingOnly, ['companion'])
  expect(accounts.rejectUnapprovedRequestsForOrigins).not.toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['other'])
  )
})

it('binds a role proof to its role key rather than the stable bundle principal', () => {
  const pairing = candidate('h')
  expect(peerAuthFingerprint(pairing.publicKeys.control)).not.toBe(
    peerAuthFingerprint(pairing.publicKeys.page)
  )
  expect(pairing.fingerprint).toBe(peerAuthClientBundleFingerprint(pairing.publicKeys))
})
