import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import { getSignerCapabilities } from '../../../main/signers/capabilities'
import Signer from '../../../main/signers/Signer'

const version = (major: number, minor: number, patch: number) => ({ major, minor, patch })

it('describes complete software signing paths', () => {
  expect(getSignerCapabilities({ type: 'seed' })).toEqual({
    hardware: false,
    transport: 'software',
    transactionEnvelopes: ['legacy', 'eip2930', 'eip1559'],
    nativeEip1559: true,
    eip1559LegacyFallback: false,
    typedDataVersions: [SignTypedDataVersion.V1, SignTypedDataVersion.V3, SignTypedDataVersion.V4],
    typedDataHashOnly: false,
    personalMessage: true,
    deviceAddressDisplay: false
  })
})

it.each([
  ['ledger before 1.9', { type: 'ledger', appVersion: version(1, 8, 9) }, false],
  ['ledger 1.9', { type: 'ledger', appVersion: version(1, 9, 0) }, true],
  ['lattice before 0.11', { type: 'lattice', appVersion: version(0, 10, 9) }, false],
  ['lattice 0.11', { type: 'lattice', appVersion: version(0, 11, 0) }, true],
  ['trezor one before 1.10.4', { type: 'trezor', model: 'Trezor One', appVersion: version(1, 10, 3) }, false],
  ['trezor one 1.10.4', { type: 'trezor', model: 'Trezor One', appVersion: version(1, 10, 4) }, true],
  ['trezor model t before 2.4.2', { type: 'trezor', model: 'Trezor T', appVersion: version(2, 4, 1) }, false],
  ['trezor model t 2.4.2', { type: 'trezor', model: 'Trezor T', appVersion: version(2, 4, 2) }, true]
])('preserves the %s native EIP-1559 threshold', (_label, signer, supported) => {
  expect(getSignerCapabilities(signer).nativeEip1559).toBe(supported)
})

it('distinguishes hardware transports, envelopes, and typed-data versions', () => {
  const ledger = getSignerCapabilities({ type: 'ledger' })
  const lattice = getSignerCapabilities({ type: 'lattice' })
  const trezor = getSignerCapabilities({ type: 'trezor' })

  expect(ledger).toMatchObject({
    hardware: true,
    transport: 'usb',
    transactionEnvelopes: ['legacy', 'eip2930', 'eip1559'],
    typedDataVersions: [SignTypedDataVersion.V4]
  })
  expect(lattice).toMatchObject({
    transport: 'network',
    typedDataVersions: [SignTypedDataVersion.V3, SignTypedDataVersion.V4]
  })
  expect(trezor).toMatchObject({
    transport: 'network',
    transactionEnvelopes: ['legacy', 'eip1559'],
    typedDataVersions: [SignTypedDataVersion.V4]
  })
})

it('marks only Trezor One as hash-only for EIP-712 device review', () => {
  expect(getSignerCapabilities({ type: 'trezor', model: 'Trezor One' }).typedDataHashOnly).toBe(true)
  expect(getSignerCapabilities({ type: 'trezor', model: 'Trezor Safe 7' }).typedDataHashOnly).toBe(false)
  expect(getSignerCapabilities({ type: 'trezor', model: 'Trezor T' }).typedDataHashOnly).toBe(false)
  expect(getSignerCapabilities({ type: 'ledger' }).typedDataHashOnly).toBe(false)
})

it('returns deeply immutable detached profiles and fails closed for unknown types', () => {
  const capabilities = getSignerCapabilities({ type: 'address' })

  expect(capabilities).toMatchObject({
    hardware: false,
    transport: 'unknown',
    transactionEnvelopes: [],
    nativeEip1559: false,
    typedDataVersions: [],
    typedDataHashOnly: false,
    personalMessage: false,
    deviceAddressDisplay: false
  })
  expect(Object.isFrozen(capabilities)).toBe(true)
  expect(Object.isFrozen(capabilities.transactionEnvelopes)).toBe(true)
  expect(Object.isFrozen(capabilities.typedDataVersions)).toBe(true)
})

it('publishes a detached capability profile in every signer summary', () => {
  const signer = new Signer()
  signer.type = 'seed'

  const first = signer.summary()
  const second = signer.summary()

  expect(first.signingCapabilities).toEqual(getSignerCapabilities({ type: 'seed' }))
  expect(first.signingCapabilities).not.toBe(second.signingCapabilities)
  expect(first.signingCapabilities.transactionEnvelopes).not.toBe(
    second.signingCapabilities.transactionEnvelopes
  )
})
