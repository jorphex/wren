import {
  getAccountSignerType,
  getSignerStatusMeta,
  isHardwareSigner,
  isSignerReady,
  isWatchOnlyAccountType
} from '../../../../resources/domain/signer'

describe('watch-only account types', () => {
  it.each([
    ['address', 'address'],
    ['Address', 'address'],
    ['ledger', 'ledger'],
    ['TREZOR', 'trezor']
  ])('normalizes %s to %s', (input, expected) => {
    expect(getAccountSignerType(input)).toBe(expected)
  })

  it.each([undefined, null, '', 'future-signer'])('fails closed for %p', (input) => {
    expect(getAccountSignerType(input)).toBe('address')
    expect(isWatchOnlyAccountType(input)).toBe(true)
  })

  it('does not classify real signer types as watch-only', () => {
    expect(isWatchOnlyAccountType('seed')).toBe(false)
    expect(isWatchOnlyAccountType('ledger')).toBe(false)
  })
})

describe('#isHardwareSigner', () => {
  const hardwareSigners = ['lattice', 'trezor', 'ledger']

  hardwareSigners.forEach((signerType) => {
    it(`considers a string type of ${signerType} to be a hardware signer`, () => {
      expect(isHardwareSigner(signerType)).toBe(true)
    })
  })

  it('determines the hardware type of a signer object', () => {
    const signer = { type: 'ledger' }
    expect(isHardwareSigner(signer)).toBe(true)
  })

  it('handles signer types regardless of case', () => {
    expect(isHardwareSigner('tReZoR')).toBe(true)
  })

  it('does not consider an unexpected type to be a hardware signer', () => {
    expect(isHardwareSigner('seed')).toBe(false)
  })
})

describe('#getSignerStatusMeta', () => {
  it.each([
    ['ledger', 'ready', 'ready', 'Signer ready', undefined],
    ['seed', 'locked', 'locked', 'Software signer locked', undefined],
    ['ledger', 'locked', 'locked', 'Hardware wallet locked', undefined],
    ['ledger', 'loading-addresses', 'busy', 'Loading addresses…', undefined],
    ['trezor', 'pin-required', 'input', 'PIN required', 'pin'],
    ['trezor', 'passphrase-required', 'input', 'Passphrase required', 'passphrase'],
    ['lattice', 'pairing-code-required', 'input', 'Confirm pairing code', 'pairingCode'],
    ['lattice', 'pairing', 'busy', 'Pairing device…', undefined],
    ['trezor', 'passphrase-on-device', 'busy', 'Confirm on device', undefined],
    ['seed', 'error', 'error', 'Software signer stopped', undefined],
    ['ledger', 'disconnected', 'disconnected', 'Device disconnected', undefined],
    ['ledger', 'wrong-app', 'error', 'Open the correct app', undefined],
    [
      'trezor',
      'derivation path failed strict safety checks on trezor device',
      'error',
      'Address path not supported',
      undefined
    ],
    ['lattice', 'pairing-failed', 'error', 'Pairing failed', undefined],
    ['lattice', 'device-error', 'error', 'Device error', undefined]
  ])('%s %s has semantic state %s', (type, status, phase, label, input) => {
    expect(getSignerStatusMeta({ type, status })).toMatchObject({
      phase,
      label,
      ...(input ? { input } : {})
    })
  })

  it('fails closed for an unknown state', () => {
    expect(getSignerStatusMeta({ type: 'future', status: '' })).toEqual({
      phase: 'unknown',
      label: 'Signer unavailable',
      ready: false,
      busy: false,
      reloadable: false,
      tone: 'danger'
    })
  })

  it('uses the semantic state for readiness', () => {
    expect(isSignerReady({ type: 'ledger', status: 'ready' })).toBe(true)
    expect(isSignerReady({ type: 'ledger', status: 'loading' })).toBe(false)
  })
})
