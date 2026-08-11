import log from 'electron-log'
import { padToEven, stripHexPrefix, addHexPrefix } from '@ethereumjs/util'
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'
import type { Device as TrezorDevice } from '@trezor/connect'

import { v5 as uuid } from 'uuid'

import Signer from '../../Signer'
import { TransactionData } from '../../../../resources/domain/transaction'
import { sign, londonToLegacy, signerCompatibility } from '../../../transaction'
import { Derivation, getDerivationPath } from '../../Signer/derive'
import TrezorBridge, { DeviceError } from '../bridge'
import type { TypedMessage } from '../../../accounts/types'
import { normalizeTrezorTransaction } from '../transaction'
import { SignerUserRejectedError } from '../../errors'

const ns = '3bbcee75-cecc-5b56-8031-b6641c1ed1f1'

const defaultTrezorTVersion = { major_version: 2, minor_version: 3, patch_version: 0 }
const defaultTrezorOneVersion = { major_version: 1, minor_version: 9, patch_version: 2 }

export const Status = {
  INITIAL: 'connecting',
  OK: 'ready',
  LOADING: 'loading',
  DERIVING: 'loading-addresses',
  LOCKED: 'locked',
  DISCONNECTED: 'disconnected',
  NEEDS_RECONNECTION: 'reconnect-required',
  NEEDS_PIN: 'pin-required',
  NEEDS_PASSPHRASE: 'passphrase-required',
  NEEDS_PAIRING: 'pairing-code-required',
  ENTERING_PASSPHRASE: 'passphrase-on-device',
  DERIVATION_FAILED: 'derivation-failed',
  SAFETY_CHECKS: 'derivation-path-unsupported'
}

export type TrezorPairing = {
  availableMethods: Array<string | number>
  selectedMethod: string | number
  nfcData?: string
}

function createError(message: string, code: string, cause: string = '') {
  // the cause may need to be transformed into a more informative message
  return cause.toLowerCase().match(/forbidden key path/)
    ? new DeviceError('derivation path failed strict safety checks on trezor device', 'SAFETY_CHECKS')
    : new DeviceError(message, code)
}

function isUserRejection(error: DeviceError) {
  return Boolean(
    error.code &&
    ['Failure_ActionCancelled', 'Failure_PinCancelled', 'Failure_PassphraseCancelled'].includes(error.code)
  )
}

function toSignerError(error: DeviceError) {
  return isUserRejection(error) ? new SignerUserRejectedError() : new Error(error.message)
}

function once<T>(cb: Callback<T>) {
  let called = false

  return (error: Error | null, result?: T) => {
    if (called) return
    called = true
    cb(error, result)
  }
}

export function getTransactionErrorMessage(error: Error, derivation?: Derivation) {
  if (!error.message.toLowerCase().includes('forbidden key path')) return error.message

  const path = derivation || 'selected'
  return `Trezor strict safety checks rejected the ${path} derivation path for this chain. The request was not signed. Use an account derived for this network, or choose Prompt safety checks in Trezor Suite only if you understand the mismatched coin-key risk.`
}

export default class Trezor extends Signer {
  readonly path: string

  device: TrezorDevice | undefined
  derivation: Derivation | undefined
  pairing: TrezorPairing | undefined
  pinError: string | undefined

  private closed = false
  private lifecycleGeneration = 0
  private derivationGeneration = 0
  private verificationGeneration = 0
  private requestQueue: Promise<void> = Promise.resolve()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private pendingCallbacks = new Set<(error: Error) => void>()

  constructor(path: string) {
    super()

    this.path = path
    this.id = Trezor.generateId(path)
    this.type = 'trezor'
    this.status = Status.INITIAL
  }

  static generateId(path: string) {
    return uuid('Trezor' + path, ns)
  }

  override async open(device: TrezorDevice) {
    if (this.closed) throw new Error('Trezor signer is closed')

    const generation = ++this.lifecycleGeneration
    this.device = device
    this.pinError = undefined
    this.status = Status.INITIAL
    this.emit('update')

    try {
      const features = await this.runDeviceRequest(
        () => TrezorBridge.getFeatures(device),
        generation,
        Status.INITIAL
      )

      if (!this.isCurrent(generation, device)) return

      const defaultVersion = features?.model === 'T' ? defaultTrezorTVersion : defaultTrezorOneVersion
      const { major_version: major, minor_version: minor, patch_version: patch } = features || defaultVersion
      this.appVersion = { major, minor, patch }

      const model = (features?.model || '').toString() === '1' ? 'One' : features?.model
      this.model = ['Trezor', model].join(' ').trim()
    } catch (e) {
      if (!this.isCurrent(generation, device)) return
      this.handleUnrecoverableError()

      throw e
    }

    try {
      // Use a simple device-only Ethereum call to establish the session.
      // `getAccountInfo` routes through backend/discovery and is a poor fit as a login probe.
      await this.runDeviceRequest(
        () => TrezorBridge.getAddress(device, this.getPath(0), false),
        generation,
        Status.INITIAL
      )
    } catch (e) {
      if (!this.isCurrent(generation, device)) return
      log.error('could not establish Trezor session', e)

      const deviceError = createError(
        Status.NEEDS_RECONNECTION,
        'ACCOUNT_ACCESS_FAILURE',
        (e as DeviceError).message
      )
      this.handleError(deviceError)

      throw e
    }
  }

  override close() {
    if (this.closed) return

    this.closed = true
    ++this.lifecycleGeneration
    ++this.derivationGeneration
    ++this.verificationGeneration
    this.clearTimers()
    const cancellation = new Error('Trezor signer closed')
    const pendingCallbacks = [...this.pendingCallbacks]
    this.pendingCallbacks.clear()
    pendingCallbacks.forEach((cancel) => cancel(cancellation))
    this.device = undefined

    this.emit('close')
    this.removeAllListeners()

    super.close()
  }

  override summary() {
    const summary = super.summary()

    return {
      ...summary,
      capabilities: this.device?.features?.capabilities || [],
      pairing: this.pairing,
      pinError: this.pinError
    }
  }

  private getPath(index: number) {
    return this.basePath() + '/' + index.toString()
  }

  private basePath() {
    if (!this.derivation) {
      throw new Error('attempted to get base path with unknown derivation!')
    }

    return `m/${getDerivationPath(this.derivation)}`.replace(/\/+$/, '')
  }

  private handleUnrecoverableError() {
    this.handleError(new DeviceError('Unrecoverable error', 'UNRECOVERABLE'))
  }

  private handleError(error: DeviceError) {
    const errorStatusMap = {
      ADDRESS_NO_MATCH_DEVICE: Status.NEEDS_RECONNECTION,
      UNRECOVERABLE: Status.NEEDS_RECONNECTION,
      ADDRESS_VERIFICATION_FAILURE: Status.NEEDS_RECONNECTION,
      ACCOUNT_ACCESS_FAILURE: Status.NEEDS_RECONNECTION,
      DERIVATION_FAILURE: Status.DERIVATION_FAILED,
      SAFETY_CHECKS: Status.SAFETY_CHECKS
    }

    const newStatus = errorStatusMap[error.code as keyof typeof errorStatusMap]
    if (newStatus) {
      this.status = newStatus
    }

    this.emitUpdate()
  }

  override async verifyAddress(
    index: number,
    currentAddress: string = '',
    display = false,
    cb: Callback<boolean>
  ) {
    const done = this.trackCallback(cb)
    const lifecycleGeneration = this.lifecycleGeneration
    const verificationGeneration = ++this.verificationGeneration
    const device = this.device

    const waitForInput = this.setTimer(() => {
      if (!this.isVerificationCurrent(lifecycleGeneration, verificationGeneration, device)) return

      ++this.verificationGeneration
      log.error('Trezor address verification timed out')
      done(new Error('Address verification timed out'))
    }, 60_000)

    try {
      if (!device) {
        throw new Error('Trezor not connected')
      }

      const reportedAddress = await this.runDeviceRequest(
        () => TrezorBridge.getAddress(device, this.getPath(index), display),
        lifecycleGeneration,
        this.status,
        () => this.isVerificationCurrent(lifecycleGeneration, verificationGeneration, device)
      )

      this.clearTimer(waitForInput)

      if (!this.isVerificationCurrent(lifecycleGeneration, verificationGeneration, device)) return

      const current = currentAddress.toLowerCase()

      if (reportedAddress !== current) {
        log.error(
          `address from Wren (${current}) does not match address from Trezor device (${reportedAddress})`
        )

        this.handleError(
          new DeviceError('address does not match device, reconnect your Trezor', 'ADDRESS_NO_MATCH_DEVICE')
        )

        done(new Error('Address does not match device'), undefined)
      } else {
        log.verbose('Trezor address matches device')
        done(null, true)
      }
    } catch (e: unknown) {
      this.clearTimer(waitForInput)

      if (!this.isVerificationCurrent(lifecycleGeneration, verificationGeneration, device)) return

      const err = e as DeviceError

      log.error('error verifying Trezor address', err)

      if (!isUserRejection(err)) {
        const deviceError = createError(
          'could not verify address, reconnect your Trezor',
          'ADDRESS_VERIFICATION_FAILURE',
          err.message
        )
        this.handleError(deviceError)
      }

      done(toSignerError(err))
    }
  }

  async deriveAddresses() {
    if (this.closed) return

    const lifecycleGeneration = this.lifecycleGeneration
    const derivationGeneration = ++this.derivationGeneration
    const device = this.device

    this.status = Status.DERIVING
    this.emitUpdate()

    try {
      if (!device) {
        throw new Error('Trezor not connected')
      }

      const publicKey = await this.runDeviceRequest(
        () => TrezorBridge.getPublicKey(device, this.basePath()),
        lifecycleGeneration,
        Status.DERIVING,
        () => this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)
      )

      if (!this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)) return

      const accounts = await this.deriveAccounts(publicKey.publicKey, publicKey.chainCode)

      if (!this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)) return

      const firstAccount = accounts[0] || ''

      await this.verifyDerivedAddress(device, firstAccount, lifecycleGeneration, derivationGeneration)

      if (!this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)) return

      this.status = Status.OK
      this.addresses = accounts
      this.emitUpdate()
    } catch (e: unknown) {
      if (!this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)) return

      log.error('could not get public key from Trezor', e)
      const err = e as DeviceError
      const deviceError =
        err.code === 'ADDRESS_NO_MATCH_DEVICE'
          ? err
          : createError(
              'could not derive addresses, reconnect your Trezor',
              'DERIVATION_FAILURE',
              err.message
            )
      this.handleError(deviceError)
    }
  }

  override async signMessage(index: number, rawMessage: string, cb: Callback<string>) {
    const done = this.trackCallback(cb)

    try {
      if (!this.device) {
        throw new Error('Trezor is not connected')
      }

      const message = this.normalize(rawMessage)
      const signature = await this.runDeviceRequest(
        () => TrezorBridge.signMessage(this.device!, this.getPath(index), message),
        this.lifecycleGeneration,
        this.status
      )

      done(null, addHexPrefix(signature))
    } catch (e: unknown) {
      const err = e as DeviceError
      done(toSignerError(err))
    }
  }

  override async signTypedData(
    index: number,
    typedMessage: TypedMessage<SignTypedDataVersion.V4>,
    cb: Callback<string>
  ) {
    const done = this.trackCallback(cb)

    try {
      if (!this.device) {
        throw new Error('Trezor is not connected')
      }

      let signature
      const path = this.getPath(index)

      if (this.isTrezorOne()) {
        // Trezor One requires hashed input
        const { types, primaryType, domain, message } = TypedDataUtils.sanitizeData(typedMessage.data)
        if (typeof primaryType !== 'string' || !primaryType) {
          throw new Error('Typed data has no primary type')
        }

        const domainSeparatorHash = TypedDataUtils.hashStruct(
          'EIP712Domain',
          domain,
          types,
          SignTypedDataVersion.V4
        )

        const messageHash = TypedDataUtils.hashStruct(primaryType, message, types, SignTypedDataVersion.V4)

        signature = await this.runDeviceRequest(
          () =>
            TrezorBridge.signTypedHash(
              this.device!,
              path,
              typedMessage.data,
              domainSeparatorHash.toString('hex'),
              messageHash.toString('hex')
            ),
          this.lifecycleGeneration,
          this.status
        )
      } else {
        signature = await this.runDeviceRequest(
          () => TrezorBridge.signTypedData(this.device!, path, typedMessage.data),
          this.lifecycleGeneration,
          this.status
        )
      }

      done(null, addHexPrefix(signature))
    } catch (e: unknown) {
      const err = e as DeviceError
      done(toSignerError(err))
    }
  }

  override async signTransaction(index: number, rawTx: TransactionData, cb: Callback<string>) {
    const done = this.trackCallback(cb)

    try {
      const compatibility = signerCompatibility(rawTx, this.summary())
      const compatibleTx = compatibility.compatible ? { ...rawTx } : londonToLegacy(rawTx)

      const signedTx = await sign(compatibleTx, async (tx) => {
        if (!this.device) {
          throw new Error('Trezor is not connected')
        }

        const trezorTx = normalizeTrezorTransaction(rawTx.chainId, tx)
        const path = this.getPath(index)

        try {
          return await this.runDeviceRequest(
            () => TrezorBridge.signTransaction(this.device!, path, trezorTx),
            this.lifecycleGeneration,
            this.status
          )
        } catch (e: unknown) {
          const err = e as DeviceError
          if (isUserRejection(err)) throw new SignerUserRejectedError()
          throw new Error(getTransactionErrorMessage(err, this.derivation))
        }
      })

      done(null, addHexPrefix(signedTx.serialize().toString('hex')))
    } catch (e: unknown) {
      const err = e as DeviceError
      done(err)
    }
  }

  private async deriveAccounts(publicKey: string, chainCode: string) {
    return new Promise<string[]>((resolve, reject) => {
      const done = once<string[]>((error, accounts = []) => {
        if (error) reject(error)
        else resolve(accounts)
      })

      this.deriveHDAccounts(publicKey, chainCode, done)
    })
  }

  private async verifyDerivedAddress(
    device: TrezorDevice,
    currentAddress: string,
    lifecycleGeneration: number,
    derivationGeneration: number
  ) {
    const reportedAddress = await this.runDeviceRequest(
      () => TrezorBridge.getAddress(device, this.getPath(0), false),
      lifecycleGeneration,
      Status.DERIVING,
      () => this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)
    )

    if (!this.isDerivationCurrent(lifecycleGeneration, derivationGeneration, device)) return

    if (reportedAddress !== currentAddress.toLowerCase()) {
      throw new DeviceError('address does not match device, reconnect your Trezor', 'ADDRESS_NO_MATCH_DEVICE')
    }
  }

  private runDeviceRequest<T>(
    operation: () => Promise<T>,
    lifecycleGeneration: number,
    statusToRestore: string,
    isValid: () => boolean = () => true
  ) {
    const request = this.requestQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.isCurrent(lifecycleGeneration) || !isValid()) {
          throw new Error('Trezor operation cancelled')
        }

        try {
          const result = await operation()
          if (!this.isCurrent(lifecycleGeneration) || !isValid()) {
            throw new Error('Trezor operation cancelled')
          }
          return result
        } finally {
          if (this.isCurrent(lifecycleGeneration) && this.status === Status.ENTERING_PASSPHRASE) {
            this.status = statusToRestore
            this.emitUpdate()
          }
        }
      })

    this.requestQueue = request.then(
      () => undefined,
      () => undefined
    )

    return request
  }

  private isCurrent(generation: number, device: TrezorDevice | undefined = this.device) {
    const sameDevice =
      device === this.device || Boolean(device?.path && this.device?.path && device.path === this.device.path)

    return !this.closed && generation === this.lifecycleGeneration && sameDevice
  }

  private isDerivationCurrent(
    lifecycleGeneration: number,
    derivationGeneration: number,
    device: TrezorDevice | undefined
  ) {
    return this.isCurrent(lifecycleGeneration, device) && derivationGeneration === this.derivationGeneration
  }

  private isVerificationCurrent(
    lifecycleGeneration: number,
    verificationGeneration: number,
    device: TrezorDevice | undefined
  ) {
    return (
      this.isCurrent(lifecycleGeneration, device) && verificationGeneration === this.verificationGeneration
    )
  }

  private emitUpdate() {
    if (!this.closed) this.emit('update')
  }

  private setTimer(fn: () => void, timeout: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, timeout)

    this.timers.add(timer)
    return timer
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>) {
    clearTimeout(timer)
    this.timers.delete(timer)
  }

  private clearTimers() {
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
  }

  private trackCallback<T>(cb: Callback<T>) {
    let called = false

    const done = (error: Error | null, result?: T) => {
      if (called) return
      called = true
      this.pendingCallbacks.delete(cancel)
      cb(error, result)
    }
    const cancel = (error: Error) => done(error)

    this.pendingCallbacks.add(cancel)
    return done
  }

  private isTrezorOne() {
    return this.model.toLowerCase().includes('one')
  }

  private normalize(hex: string) {
    return (hex && padToEven(stripHexPrefix(hex))) || ''
  }
}
