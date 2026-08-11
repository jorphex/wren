import type Signer from '../../../main/signers/Signer'

// in order of increasing priority
export enum Type {
  Ring = 'ring',
  Seed = 'seed',
  Trezor = 'trezor',
  Ledger = 'ledger',
  Lattice = 'lattice'
}

export const WatchOnlyType = 'address' as const
export const WATCH_ONLY_SIGNING_ERROR = 'Watch-only accounts cannot sign'
export type AccountSignerType = Type | typeof WatchOnlyType

export type SignerStatusPhase = 'ready' | 'locked' | 'busy' | 'input' | 'disconnected' | 'error' | 'unknown'

export type SignerInput = 'pin' | 'passphrase' | 'pairingCode'
export type SignerStatusTone = 'positive' | 'neutral' | 'warning' | 'danger'

export interface SignerStatusMeta {
  phase: SignerStatusPhase
  label: string
  ready: boolean
  busy: boolean
  reloadable: boolean
  tone: SignerStatusTone
  input?: SignerInput
}

type SignerStatusInput = Pick<Signer, 'type' | 'status'>

const statusMeta = (
  phase: SignerStatusPhase,
  label: string,
  options: Partial<Omit<SignerStatusMeta, 'phase' | 'label'>> = {}
): SignerStatusMeta => ({
  phase,
  label,
  ready: false,
  busy: false,
  reloadable: false,
  tone: 'neutral',
  ...options
})

export function getSignerType(typeValue: string) {
  return Object.values(Type).find((type) => type === typeValue)
}

export function getAccountSignerType(typeValue: unknown): AccountSignerType {
  if (typeof typeValue !== 'string') return WatchOnlyType

  const normalized = typeValue.toLowerCase()
  return getSignerType(normalized) || WatchOnlyType
}

export function isWatchOnlyAccountType(typeValue: unknown) {
  return getAccountSignerType(typeValue) === WatchOnlyType
}

export function getSignerDisplayType(typeOrSigner: string | Signer = '') {
  const signerType = typeof typeOrSigner === 'string' ? typeOrSigner : (typeOrSigner as Signer)?.type || ''
  return ['ring', 'seed'].includes(signerType.toLowerCase()) ? 'hot' : signerType
}

export function isHardwareSigner(typeOrSigner: string | Signer = '') {
  const signerType = typeof typeOrSigner === 'string' ? typeOrSigner : (typeOrSigner as Signer)?.type || ''

  return ['ledger', 'trezor', 'lattice'].includes(signerType.toLowerCase())
}

export function getSignerStatusMeta(signer: SignerStatusInput): SignerStatusMeta {
  const rawStatus = typeof signer.status === 'string' ? signer.status.trim() : ''
  const status = rawStatus.toLowerCase()
  const hardware = isHardwareSigner(signer.type)

  if (status === 'ok' || status === 'ready') {
    return statusMeta('ready', 'Signer ready', { ready: true, tone: 'positive' })
  }

  if (status === 'locked') {
    return statusMeta('locked', hardware ? 'Hardware wallet locked' : 'Software signer locked', {
      reloadable: hardware,
      tone: 'warning'
    })
  }

  if (status === 'addresses' || status === 'loading-addresses') {
    return statusMeta('busy', 'Loading addresses…', { busy: true })
  }

  if (['connecting', 'initial', 'loading'].includes(status)) {
    return statusMeta('busy', 'Connecting device…', { busy: true })
  }

  if (status === 'reloading' || status === 'reconnecting') {
    return statusMeta('busy', status === 'reloading' ? 'Reloading…' : 'Reconnecting device…', {
      busy: true
    })
  }

  if (status === 'need pin' || status === 'pin-required') {
    return statusMeta('input', 'PIN required', { input: 'pin', tone: 'warning' })
  }

  if (status === 'enter passphrase' || status === 'passphrase-required') {
    return statusMeta('input', 'Passphrase required', { input: 'passphrase', tone: 'warning' })
  }

  if (status === 'need pairing code' || status === 'pair' || status === 'pairing-code-required') {
    return statusMeta('input', 'Confirm pairing code', { input: 'pairingCode', tone: 'warning' })
  }

  if (status === 'pairing' || status === 'waiting for input on device' || status === 'passphrase-on-device') {
    return statusMeta('busy', status === 'pairing' ? 'Pairing device…' : 'Confirm on device', {
      busy: true
    })
  }

  if (status === 'no active wallet' || status === 'no-active-wallet') {
    return statusMeta('error', 'No active wallet', { reloadable: true, tone: 'warning' })
  }

  if (!hardware && (status === 'error' || status === 'stopped')) {
    return statusMeta('error', 'Software signer stopped', { reloadable: true, tone: 'danger' })
  }

  if (
    status === 'derivation-failed' ||
    status === 'could not derive addresses. reconnect your trezor and try again'
  ) {
    return statusMeta('error', 'Device error', { reloadable: true, tone: 'danger' })
  }

  if (
    [
      'disconnected',
      'reconnect-required',
      'please reconnect this ledger device',
      'please reconnect this trezor device',
      'please reload this lattice1 device'
    ].includes(status)
  ) {
    return statusMeta('disconnected', 'Device disconnected', { reloadable: hardware, tone: 'danger' })
  }

  if (
    status === 'wrong-app' ||
    status === 'open your ledger and select the ethereum application' ||
    status === 'open the correct app'
  ) {
    return statusMeta('error', 'Open the correct app', { reloadable: true, tone: 'warning' })
  }

  if (
    status === 'derivation-path-unsupported' ||
    status === 'derivation path blocked by trezor safety checks' ||
    status === 'derivation path failed strict safety checks on trezor device'
  ) {
    return statusMeta('error', 'Address path not supported', { reloadable: true, tone: 'danger' })
  }

  if (status === 'pairing failed' || status === 'pairing-failed') {
    return statusMeta('error', 'Pairing failed', { reloadable: true, tone: 'danger' })
  }

  if (['device-error', 'error', 'unknown', 'unknown error', 'unknown device error'].includes(status)) {
    return statusMeta('error', 'Device error', { reloadable: hardware, tone: 'danger' })
  }

  return statusMeta('unknown', 'Signer unavailable', {
    reloadable: hardware,
    tone: rawStatus ? 'warning' : 'danger'
  })
}

export function isSignerReady(signer: SignerStatusInput) {
  return getSignerStatusMeta(signer).ready
}

export function findUnavailableSigners(signerTypeValue: string, signers: Signer[]): Signer[] {
  if (!isHardwareSigner(signerTypeValue)) return []

  return signers.filter((signer) => signer.type === signerTypeValue && !isSignerReady(signer))
}
