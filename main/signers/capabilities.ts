import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import type { AppVersion, SignerSummary } from './Signer'

export type SignerTransport = 'software' | 'usb' | 'network' | 'unknown'
export type TransactionEnvelope = 'legacy' | 'eip2930' | 'eip1559'

export interface SignerCapabilities {
  hardware: boolean
  transport: SignerTransport
  transactionEnvelopes: readonly TransactionEnvelope[]
  nativeEip1559: boolean
  eip1559LegacyFallback: boolean
  typedDataVersions: readonly SignTypedDataVersion[]
  typedDataHashOnly: boolean
  personalMessage: boolean
  deviceAddressDisplay: boolean
}

type CapabilityInput = Pick<SignerSummary, 'type'> & Partial<Pick<SignerSummary, 'model' | 'appVersion'>>

const zeroVersion: AppVersion = { major: 0, minor: 0, patch: 0 }

function supportsTrezorEip1559(version: AppVersion, model: string) {
  if (model.toLowerCase() === 'trezor one') {
    return (
      version.major >= 2 ||
      (version.major === 1 && (version.minor > 10 || (version.minor === 10 && version.patch >= 4)))
    )
  }

  return (
    version.major >= 3 ||
    (version.major === 2 && version.minor >= 5) ||
    (version.major === 2 && version.minor === 4 && version.patch >= 2)
  )
}

function supportsNativeEip1559(type: string, version: AppVersion, model: string) {
  if (type === 'ring' || type === 'seed') return true
  if (type === 'ledger') return version.major >= 2 || (version.major === 1 && version.minor >= 9)
  if (type === 'lattice') return version.major >= 1 || version.minor >= 11
  if (type === 'trezor') return supportsTrezorEip1559(version, model)
  return false
}

const freeze = (capabilities: Omit<SignerCapabilities, 'nativeEip1559'>, nativeEip1559: boolean) =>
  Object.freeze({
    ...capabilities,
    transactionEnvelopes: Object.freeze([...capabilities.transactionEnvelopes]),
    typedDataVersions: Object.freeze([...capabilities.typedDataVersions]),
    nativeEip1559
  })

export function getSignerCapabilities(signer: CapabilityInput): SignerCapabilities {
  const type = signer.type.toLowerCase()
  const version = signer.appVersion || zeroVersion
  const model = signer.model || ''
  const nativeEip1559 = supportsNativeEip1559(type, version, model)

  if (type === 'ring' || type === 'seed') {
    return freeze(
      {
        hardware: false,
        transport: 'software',
        transactionEnvelopes: ['legacy', 'eip2930', 'eip1559'],
        eip1559LegacyFallback: false,
        typedDataVersions: [SignTypedDataVersion.V1, SignTypedDataVersion.V3, SignTypedDataVersion.V4],
        typedDataHashOnly: false,
        personalMessage: true,
        deviceAddressDisplay: false
      },
      nativeEip1559
    )
  }

  if (type === 'ledger' || type === 'lattice') {
    return freeze(
      {
        hardware: true,
        transport: type === 'ledger' ? 'usb' : 'network',
        transactionEnvelopes: ['legacy', 'eip2930', 'eip1559'],
        eip1559LegacyFallback: true,
        typedDataVersions:
          type === 'ledger' ? [SignTypedDataVersion.V4] : [SignTypedDataVersion.V3, SignTypedDataVersion.V4],
        typedDataHashOnly: false,
        personalMessage: true,
        deviceAddressDisplay: true
      },
      nativeEip1559
    )
  }

  if (type === 'trezor') {
    return freeze(
      {
        hardware: true,
        transport: 'network',
        transactionEnvelopes: ['legacy', 'eip1559'],
        eip1559LegacyFallback: true,
        typedDataVersions: [SignTypedDataVersion.V4],
        typedDataHashOnly: model.toLowerCase() === 'trezor one',
        personalMessage: true,
        deviceAddressDisplay: true
      },
      nativeEip1559
    )
  }

  return freeze(
    {
      hardware: false,
      transport: 'unknown',
      transactionEnvelopes: [],
      eip1559LegacyFallback: false,
      typedDataVersions: [],
      typedDataHashOnly: false,
      personalMessage: false,
      deviceAddressDisplay: false
    },
    false
  )
}
