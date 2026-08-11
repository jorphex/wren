import { generateKeyPairSync } from 'crypto'

import store from '../../../main/store'
import {
  authorizeExtension,
  respondToExtensionPairing,
  revokeExtensionCredential
} from '../../../main/api/extensionPairing'

import type { ExtensionPairingCandidate } from '../../../main/api/extensionAuth'
import { extensionKeyFingerprint } from '../../../main/api/extensionAuth'
import { registerAuthenticatedExtension } from '../../../main/api/extensionConnections'
import { transitionNotification } from '../../../resources/store/notifications'

jest.mock('../../../main/store')

const publicKeys = new Map<string, ExtensionPairingCandidate['publicKey']>()
const installationId = '7a86842f-7c01-4d0d-b0f7-fc04e0acfd8f'

function publicKey(marker: string) {
  const existing = publicKeys.get(marker)
  if (existing) return existing
  const exported = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' })
  const key: ExtensionPairingCandidate['publicKey'] = {
    kty: 'EC',
    crv: 'P-256',
    x: exported.x || '',
    y: exported.y || '',
    ext: true,
    key_ops: ['verify']
  }
  publicKeys.set(marker, key)
  return key
}

function candidate(marker: string, overrides = {}): ExtensionPairingCandidate {
  const key = publicKey(marker)
  const fingerprint = extensionKeyFingerprint(key)
  return {
    protocolVersion: 2,
    installationId,
    browser: 'chrome',
    extensionId: marker.repeat(32),
    publicKey: key,
    fingerprint,
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
  store.setExtensionCredential = jest.fn()
  store.removeExtensionCredential = jest.fn()
})

it('accepts only an exact persisted browser identity and public key', async () => {
  const paired = candidate('a')
  const { pairingCode: _pairingCode, ...credential } = paired
  store.set('main.extensionCredentials', paired.fingerprint, credential)

  await expect(authorizeExtension(paired)).resolves.toBe(true)
  expect(store.notify).not.toHaveBeenCalled()

  const changedIdentity = candidate('a', { extensionId: 'b'.repeat(32) })
  const pending = authorizeExtension(changedIdentity)
  expect(store.notify).toHaveBeenCalledTimes(1)
  const request = store.notify.mock.calls[0][1]
  expect(respondToExtensionPairing(request.requestId, false)).toBe(true)
  await expect(pending).resolves.toBe(false)
})

it('deduplicates concurrent consent and persists the approved credential', async () => {
  const pairing = candidate('c')
  const first = authorizeExtension(pairing)
  const second = authorizeExtension(pairing)

  expect(store.notify).toHaveBeenCalledTimes(1)
  const request = store.notify.mock.calls[0][1]
  expect(request).toMatchObject({
    requestId: expect.any(String),
    fingerprint: pairing.fingerprint,
    pairingCode: pairing.pairingCode
  })
  expect(respondToExtensionPairing(request.requestId, true)).toBe(true)
  await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  expect(store.setExtensionCredential).toHaveBeenCalledWith({
    protocolVersion: 2,
    installationId: pairing.installationId,
    browser: pairing.browser,
    extensionId: pairing.extensionId,
    publicKey: pairing.publicKey,
    fingerprint: pairing.fingerprint,
    pairedAt: pairing.pairedAt
  })
  expect(respondToExtensionPairing(request.requestId, true)).toBe(false)
})

it('never reuses an active prompt for a different challenge code', async () => {
  const pairing = candidate('q')
  const first = authorizeExtension(pairing)

  await expect(authorizeExtension({ ...pairing, pairingCode: '654321' })).resolves.toBe(false)
  expect(store.notify).toHaveBeenCalledTimes(1)
  expect(store.notify.mock.calls[0][1].pairingCode).toBe(pairing.pairingCode)

  respondToExtensionPairing(store.notify.mock.calls[0][1].requestId, false)
  await expect(first).resolves.toBe(false)
})

it('rejects a competing key for an extension identity with an active prompt', async () => {
  const firstCandidate = candidate('g')
  const competingCandidate = candidate('h', { extensionId: firstCandidate.extensionId })
  const first = authorizeExtension(firstCandidate)

  await expect(authorizeExtension(competingCandidate)).resolves.toBe(false)
  expect(store.notify).toHaveBeenCalledTimes(1)

  const request = store.notify.mock.calls[0][1]
  respondToExtensionPairing(request.requestId, false)
  await expect(first).resolves.toBe(false)
})

it('revokes a previous key when the same extension identity approves a replacement', async () => {
  const previous = candidate('l')
  const { pairingCode: _pairingCode, ...previousCredential } = previous
  store.set('main.extensionCredentials', previous.fingerprint, previousCredential)
  const staleSocket = {
    close: jest.fn(),
    disposeSession: jest.fn(),
    extensionFingerprint: undefined
  }
  registerAuthenticatedExtension(staleSocket, previous.fingerprint)

  const replacement = candidate('m', { extensionId: previous.extensionId })
  const waiting = authorizeExtension(replacement)
  const request = store.notify.mock.calls[0][1]
  expect(respondToExtensionPairing(request.requestId, true)).toBe(true)

  await expect(waiting).resolves.toBe(true)
  expect(store.removeExtensionCredential).toHaveBeenCalledWith(previous.fingerprint)
  expect(staleSocket.disposeSession).toHaveBeenCalledTimes(1)
  expect(staleSocket.close).toHaveBeenCalledWith(1008, 'Extension credential revoked')
  expect(store.setExtensionCredential).toHaveBeenCalledWith(
    expect.objectContaining({ fingerprint: replacement.fingerprint })
  )
})

it('keeps credentials for another browser profile with the same extension id', async () => {
  const firstProfile = candidate('o')
  const { pairingCode: _pairingCode, ...credential } = firstProfile
  store.set('main.extensionCredentials', firstProfile.fingerprint, credential)

  const secondProfile = candidate('p', {
    extensionId: firstProfile.extensionId,
    installationId: '9c2853ac-706f-4d6b-ae25-297fc5e5dc48'
  })
  const waiting = authorizeExtension(secondProfile)
  const request = store.notify.mock.calls[0][1]
  respondToExtensionPairing(request.requestId, true)

  await expect(waiting).resolves.toBe(true)
  expect(store.removeExtensionCredential).not.toHaveBeenCalled()
})

it('allows only one visible pairing candidate at a time', async () => {
  const firstCandidate = candidate('i')
  const first = authorizeExtension(firstCandidate)

  await expect(authorizeExtension(candidate('j'))).resolves.toBe(false)
  expect(store.notify).toHaveBeenCalledTimes(1)

  respondToExtensionPairing(store.notify.mock.calls[0][1].requestId, false)
  await expect(first).resolves.toBe(false)
})

it('allows page sessions to reuse trust but never create a pairing prompt', async () => {
  const unknown = candidate('n')
  await expect(authorizeExtension(unknown, undefined, false)).resolves.toBe(false)
  expect(store.notify).not.toHaveBeenCalled()

  const { pairingCode: _pairingCode, ...credential } = unknown
  store.set('main.extensionCredentials', unknown.fingerprint, credential)
  await expect(authorizeExtension(unknown, undefined, false)).resolves.toBe(true)
  expect(store.notify).not.toHaveBeenCalled()
})

it('caches a rejection for the process lifetime and cancels abandoned consent', async () => {
  const rejected = candidate('d')
  const first = authorizeExtension(rejected)
  const rejectionRequest = store.notify.mock.calls[0][1]
  respondToExtensionPairing(rejectionRequest.requestId, false)
  await expect(first).resolves.toBe(false)
  await expect(authorizeExtension(rejected)).resolves.toBe(false)
  expect(store.notify).toHaveBeenCalledTimes(2)

  const abandoned = candidate('e')
  const controller = new AbortController()
  const waiting = authorizeExtension(abandoned, controller.signal)
  const abandonedRequest = store.notify.mock.calls.at(-1)[1]
  store.set('view.notify', 'extensionConnect')
  store.set('view.notifyData', abandonedRequest)
  controller.abort()
  await expect(waiting).resolves.toBe(false)
  expect(store.notify).toHaveBeenLastCalledWith('', {}, { expectedId: expect.any(String) })
})

it('keeps a queued pairing active while another notification is visible', async () => {
  store.notify('gasFeeWarning', { message: 'Review this fee' }, { id: 'fee-warning' })
  const waiting = authorizeExtension(candidate('k'))
  const request = store.notify.mock.calls[1][1]
  store.notify.mockClear()

  store.getObserver(`extension-pairing:${request.requestId}`).fire()

  expect(store('view.notify')).toBe('gasFeeWarning')
  expect(store('view.notifyQueue')).toHaveLength(2)
  expect(store.notify).not.toHaveBeenCalled()

  respondToExtensionPairing(request.requestId, false)
  await expect(waiting).resolves.toBe(false)
  expect(store('view.notifyQueue')).toHaveLength(1)
  expect(store('view.notifyId')).toBe('fee-warning')
})

it('rejects without clearing another workflow when its queued pairing is removed', async () => {
  store.notify('gasFeeWarning', { message: 'Review this fee' }, { id: 'fee-warning' })
  const waiting = authorizeExtension(candidate('r'))
  const request = store.notify.mock.calls[1][1]
  const pairing = store('view.notifyQueue')[1]
  store.notify('', {}, { expectedId: pairing.id })
  store.notify.mockClear()

  store.getObserver(`extension-pairing:${request.requestId}`).fire()

  await expect(waiting).resolves.toBe(false)
  expect(store.notify).not.toHaveBeenCalled()
  expect(store('view.notifyId')).toBe('fee-warning')
})

it('exposes explicit credential revocation', () => {
  const fingerprint = candidate('f').fingerprint
  revokeExtensionCredential(fingerprint)
  expect(store.removeExtensionCredential).toHaveBeenCalledWith(fingerprint)
})
