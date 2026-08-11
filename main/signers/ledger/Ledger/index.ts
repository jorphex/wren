import log from 'electron-log'
import { v5 as uuid } from 'uuid'
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid-noevents'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import { Request, RequestQueue } from './requestQueue'
import Signer from '../../Signer'
import LedgerEthereumApp from './eth'
import { Derivation, getDerivationPath } from '../../Signer/derive'
import { TransactionData } from '../../../../resources/domain/transaction'
import { signerCompatibility, londonToLegacy } from '../../../transaction'
import type { TypedMessage } from '../../../accounts/types'
import { SignerUserRejectedError } from '../../errors'

const ns = '3bbcee75-cecc-5b56-8031-b6641c1ed1f1'

export const Status = {
  INITIAL: 'connecting',
  OK: 'ready',
  LOADING: 'loading',
  DERIVING: 'loading-addresses',
  LOCKED: 'locked',
  WRONG_APP: 'wrong-app',
  DISCONNECTED: 'disconnected',
  NEEDS_RECONNECTION: 'reconnect-required'
} as const

type LedgerStatus = (typeof Status)[keyof typeof Status]

const validStatusTransitions: Record<LedgerStatus, ReadonlySet<LedgerStatus>> = {
  [Status.INITIAL]: new Set([
    Status.INITIAL,
    Status.LOADING,
    Status.DERIVING,
    Status.LOCKED,
    Status.WRONG_APP,
    Status.DISCONNECTED,
    Status.NEEDS_RECONNECTION
  ]),
  [Status.LOADING]: new Set([
    Status.LOADING,
    Status.INITIAL,
    Status.DERIVING,
    Status.LOCKED,
    Status.WRONG_APP,
    Status.DISCONNECTED,
    Status.NEEDS_RECONNECTION
  ]),
  [Status.DERIVING]: new Set([
    Status.DERIVING,
    Status.OK,
    Status.LOADING,
    Status.LOCKED,
    Status.WRONG_APP,
    Status.DISCONNECTED,
    Status.NEEDS_RECONNECTION
  ]),
  [Status.OK]: new Set([
    Status.OK,
    Status.DERIVING,
    Status.LOCKED,
    Status.WRONG_APP,
    Status.DISCONNECTED,
    Status.NEEDS_RECONNECTION
  ]),
  [Status.LOCKED]: new Set([
    Status.LOCKED,
    Status.INITIAL,
    Status.WRONG_APP,
    Status.DISCONNECTED,
    Status.NEEDS_RECONNECTION
  ]),
  [Status.WRONG_APP]: new Set([Status.WRONG_APP, Status.INITIAL, Status.DISCONNECTED]),
  [Status.DISCONNECTED]: new Set([Status.DISCONNECTED, Status.INITIAL]),
  [Status.NEEDS_RECONNECTION]: new Set([Status.NEEDS_RECONNECTION, Status.INITIAL, Status.DISCONNECTED])
}

interface Address {
  address: string
  publicKey: string
  chainCode?: string | undefined
}

function wasRequestRejected(err: DeviceError) {
  return [27013].includes(err.statusCode)
}

function isInvalidRequest(err: DeviceError) {
  return [99901].includes(err.statusCode)
}

function isDeviceAsleep(err: DeviceError) {
  return [27404, 26628].includes(err.statusCode)
}

function needToOpenEthApp(err: DeviceError) {
  return [27904, 27906, 25873, 25871].includes(err.statusCode)
}

// additional status codes
//   27264: 'INCORRECT_DATA'

function getStatusForError(err: DeviceError) {
  if (needToOpenEthApp(err)) {
    return Status.WRONG_APP
  }

  if (isDeviceAsleep(err)) {
    return Status.LOCKED
  }

  if (wasRequestRejected(err) || isInvalidRequest(err)) {
    return Status.OK
  }

  return Status.NEEDS_RECONNECTION
}

export class DeviceError extends Error {
  readonly statusCode

  constructor(msg: string, code = -1) {
    super(msg)
    this.statusCode = code
  }
}

export default class Ledger extends Signer {
  private eth: LedgerEthereumApp | undefined
  private closed = false
  private lifecycleVersion = 0
  private derivationVersion = 0
  private lifecycle = Promise.resolve()
  private closePromise: Promise<void> | undefined

  devicePath: string

  derivation: Derivation | undefined
  accountLimit = 5

  // the Ledger device can only handle one request at a time; the transport will reject
  // all incoming requests while its busy, so we need to make sure requests are only executed
  // when the device is ready
  private requestQueue = new RequestQueue()
  private statusPoller = setTimeout(() => {})

  constructor(devicePath: string, model: string) {
    super()

    this.devicePath = devicePath

    this.id = uuid('Ledger' + this.devicePath, ns)
    this.type = 'ledger'
    this.model = model
    this.status = Status.INITIAL
  }

  override async open() {
    const version = ++this.lifecycleVersion

    return this.serializeLifecycle(async () => {
      if (this.closed || version !== this.lifecycleVersion) return

      if (this.eth) {
        this.stopWork(new Error('Ledger transport reopened before request completed'))
      }
      await this.closeTransport()
      if (this.closed || version !== this.lifecycleVersion) return

      const transport = await TransportNodeHid.open(this.devicePath)

      if (this.closed || version !== this.lifecycleVersion) {
        await transport.close()
        return
      }

      this.eth = new LedgerEthereumApp(transport)

      this.requestQueue.start()
    })
  }

  override async close() {
    if (this.closePromise) return this.closePromise

    this.closed = true
    this.lifecycleVersion++
    this.derivationVersion++
    this.stopWork(new Error('Ledger closed before request completed'))
    this.updateStatus(Status.DISCONNECTED)

    this.closePromise = this.serializeLifecycle(async () => {
      await this.closeTransport()
    })

    this.emit('close')
    this.removeAllListeners()

    await this.closePromise
  }

  async connect() {
    const version = ++this.lifecycleVersion

    return this.serializeLifecycle(async () => {
      if (!this.isCurrent(version)) return

      try {
        // since the Ledger doesn't provide information about whether the eth app is open or if
        // the device is locked, the order of these checks is important in order to correctly determine
        // the exact status based on the returned error codes
        //  1. getAppConfiguration
        //  2. checkDeviceStatus
        //  3. deriveAddresses

        const config = await this.getAppConfiguration()
        if (!this.isCurrent(version)) return

        this.updateStatus(Status.INITIAL)
        this.emit('update')

        // during connection is the only time we can access the device without
        // enqueuing the request, since no other requests should be active before
        // the device is connected
        await this.checkDeviceStatus(version)
        if (!this.isCurrent(version)) return

        if (this.isReady()) {
          const [major = 0, minor = 0, patch = 0] = (config.version || '1.6.1')
            .split('.')
            .map((n) => parseInt(n))
          const appVersion = { major, minor, patch }

          this.appVersion = appVersion

          this.deriveAddresses()
        }
      } catch (err) {
        if (!this.isCurrent(version)) return

        this.handleError(err as DeviceError)

        if (this.status !== Status.LOCKED) {
          if (this.lifecycleVersion === version) {
            this.stopWork(new Error('Ledger connection failed before request completed'))
          }
          await this.disconnectTransport()
        }
      }
    })
  }

  async disconnect() {
    if (this.closed) {
      await this.closePromise
      return
    }

    this.lifecycleVersion++
    this.derivationVersion++
    this.stopWork(new Error('Ledger disconnected before request completed'))

    if (
      this.status === Status.INITIAL ||
      this.status === Status.DERIVING ||
      this.status === Status.OK ||
      this.status === Status.LOCKED
    ) {
      this.updateStatus(Status.DISCONNECTED)
      this.emit('update')
    }

    return this.serializeLifecycle(async () => {
      await this.disconnectTransport()
    })
  }

  private serializeLifecycle<T>(operation: () => Promise<T>) {
    const result = this.lifecycle.then(operation, operation)
    this.lifecycle = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private isCurrent(version: number) {
    return !this.closed && version === this.lifecycleVersion
  }

  private stopWork(error: Error) {
    clearTimeout(this.statusPoller)
    this.requestQueue.close(error)
  }

  private async closeTransport() {
    const eth = this.eth
    this.eth = undefined
    if (eth) await eth.close()
  }

  private async disconnectTransport() {
    await this.closeTransport()
  }

  private isReady() {
    return this.status === Status.INITIAL || this.status === Status.OK
  }

  private handleError(err: DeviceError) {
    if (this.closed) return

    const errorStatus = getStatusForError(err)

    if (errorStatus === Status.LOCKED && this.status !== Status.LOCKED) {
      if (this.updateStatus(Status.LOCKED)) {
        this.emit('lock')
      }
      return
    }

    if (errorStatus !== this.status && this.updateStatus(errorStatus)) {
      this.emit('update')

      if (this.status === Status.NEEDS_RECONNECTION) {
        void this.disconnect().catch((error) => log.warn('failed to disconnect Ledger transport', error))
      }
    }
  }

  private isValidStatusTransition(status: string): status is LedgerStatus {
    const current = validStatusTransitions[this.status as LedgerStatus]
    return !!current?.has(status as LedgerStatus)
  }

  updateStatus(status: string) {
    if (!this.isValidStatusTransition(status)) return false

    this.status = status

    if (this.status === Status.OK) {
      clearTimeout(this.statusPoller)
      this.pollDeviceStatus(5000)
    }

    if (this.status === Status.LOCKED) {
      clearTimeout(this.statusPoller)
      this.pollDeviceStatus(500)
    }

    return true
  }

  private async checkDeviceStatus(version = this.lifecycleVersion) {
    if (!this.isCurrent(version) || !this.eth) return -1

    const eth = this.eth
    const check = new Promise<DeviceError | undefined>((resolve) => {
      let settled = false
      const settle = (err: DeviceError | undefined) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(err)
      }
      const timeout = setTimeout(() => settle(new DeviceError('status check timed out')), 3000)

      Promise.resolve()
        .then(() => eth.getAddress("44'/60'/0'/0", false, false))
        .then(
          () => settle(undefined),
          (error) => settle(error as DeviceError)
        )
    })

    return check.then((err) => {
      if (!this.isCurrent(version)) return -1

      if (!err) {
        // success, handle different status state transitions

        if (this.status === Status.LOCKED) {
          // when the app is unlocked, stop checking status since we will respond
          // to the unlock event and start checking for status when that's complete
          clearTimeout(this.statusPoller)

          this.emit('unlock')
        }
      } else {
        this.handleError(err)
      }

      return err?.statusCode || 0
    })
  }

  private async pollDeviceStatus(frequency: number) {
    const lastStatus = this.status
    const version = this.lifecycleVersion

    this.statusPoller = setTimeout(() => {
      if (!this.isCurrent(version) || !this.eth) return

      const lastRequest = this.requestQueue.peekBack()

      // prevent spamming eth app checks
      if (!lastRequest || lastRequest.type !== 'checkDeviceStatus') {
        this.enqueueRequests({
          type: 'checkDeviceStatus',
          execute: async () => {
            if (!this.isCurrent(version) || lastStatus !== this.status) {
              // check if the status changed since this event was enqueued, this
              // will prevent unintended status transitions
              return true
            }

            return this.checkDeviceStatus(version)
          }
        })
      }

      if (this.isCurrent(version)) this.pollDeviceStatus(frequency)
    }, frequency)
  }

  private enqueueRequests(...requests: Request[]) {
    requests.forEach((req) => this.requestQueue.add(req))
  }

  private settleOnce<T>(cb: Callback<T>) {
    let settled = false

    return (err: Error | null, value: T | undefined) => {
      if (settled) return
      settled = true
      cb(err, value)
    }
  }

  private getPath(index: number) {
    if (!this.derivation) {
      throw new Error('attempted to get path with unknown derivation!')
    }

    return getDerivationPath(this.derivation, index)
  }

  // *** request enqueuing methods *** //

  deriveAddresses() {
    if (this.closed || !this.eth) return

    const version = ++this.derivationVersion
    this.requestQueue.cancelWhere(
      (request) => request.type === 'deriveAddresses',
      new Error('Ledger derivation changed before request completed'),
      true
    )
    this.addresses = []

    if (!this.updateStatus(Status.DERIVING)) return
    this.emit('update')

    if (this.derivation === Derivation.live) {
      this.deriveLiveAddresses(version)
    } else {
      this.deriveHardwareAddresses(version)
    }
  }

  private deriveLiveAddresses(version: number) {
    const requests = []
    const lifecycleVersion = this.lifecycleVersion
    const targetDerivation = this.derivation

    for (let i = 0; i < this.accountLimit; i++) {
      requests.push({
        type: 'deriveAddresses',
        execute: async () => {
          try {
            if (!this.eth) throw new Error('attempted to derive Live addresses but Eth app is not connected!')

            const path = this.getPath(i)
            const { address } = await this.eth.getAddress(path, false, false)

            if (
              !this.isCurrent(lifecycleVersion) ||
              version !== this.derivationVersion ||
              this.derivation !== targetDerivation
            )
              return

            log.verbose(`Found Ledger Live address #${i}: ${address}`)

            if (this.derivation === Derivation.live) {
              // don't update if the derivation was changed while this request was running
              if (this.status === Status.DERIVING) {
                this.updateStatus(Status.OK)
              }

              this.addresses = [...this.addresses, address]

              this.emit('update')
            }
          } catch (e) {
            if (this.isCurrent(lifecycleVersion) && version === this.derivationVersion) {
              this.handleError(e as DeviceError)
            }
          }
        }
      })
    }

    this.enqueueRequests(...requests)
  }

  private deriveHardwareAddresses(version: number) {
    const targetDerivation = this.derivation
    const lifecycleVersion = this.lifecycleVersion

    this.enqueueRequests({
      type: 'deriveAddresses',
      execute: async () => {
        try {
          if (!this.eth)
            throw new Error('attempted to derive hardware addresses but Eth app is not connected!')
          if (!this.derivation)
            throw new Error('attempted to derive hardware addresses for unknown derivation!')

          const addresses = await this.eth.deriveAddresses(this.derivation)

          if (
            this.isCurrent(lifecycleVersion) &&
            version === this.derivationVersion &&
            this.derivation === targetDerivation
          ) {
            // don't update if the derivation was changed while this request was running
            if (this.status === Status.DERIVING) {
              this.updateStatus(Status.OK)
            }

            this.addresses = [...addresses]

            this.emit('update')
          }
        } catch (e) {
          if (this.isCurrent(lifecycleVersion) && version === this.derivationVersion) {
            this.handleError(e as DeviceError)
          }
        }
      }
    })
  }

  override verifyAddress(index: number, currentAddress: string, display = false, cb: Callback<boolean>) {
    const lifecycleVersion = this.lifecycleVersion
    const settle = this.settleOnce(cb)

    this.enqueueRequests({
      type: 'verifyAddress',
      cancel: (error) => settle(error, undefined),
      execute: async () => {
        try {
          if (!this.isCurrent(lifecycleVersion)) return
          if (!this.eth) throw new Error('attempted to verify address but Eth app is not connected!')
          if (!this.derivation) throw new Error('attempted to verify address with unknown derivation!')

          const path = this.getPath(index)
          const result = await this.getAddress(path, display, true)
          if (!this.isCurrent(lifecycleVersion)) return
          const address = currentAddress.toLowerCase()

          if (result.address.toLowerCase() !== address) {
            const err = new Error('Address does not match device')
            log.error(err)

            settle(err, undefined)
            this.handleError(new DeviceError('failed to verify device address'))

            return
          }

          log.info(`address ${address} matches device`)

          settle(null, true)
        } catch (e) {
          if (!this.isCurrent(lifecycleVersion)) return

          const err = e as DeviceError
          const message = wasRequestRejected(err) ? 'Verify request rejected by user' : 'Verify address error'

          const error = wasRequestRejected(err) ? new SignerUserRejectedError(message) : new Error(message)
          settle(error, undefined)

          this.handleError(wasRequestRejected(err) ? err : new DeviceError(message))
          log.error('error verifying message on Ledger', err.toString())
        }
      }
    })
  }

  override signMessage(index: number, message: string, cb: Callback<string>) {
    const lifecycleVersion = this.lifecycleVersion
    const settle = this.settleOnce(cb)

    this.enqueueRequests({
      type: 'signMessage',
      cancel: (error) => settle(error, undefined),
      execute: async () => {
        try {
          if (!this.isCurrent(lifecycleVersion)) return
          if (!this.eth) throw new Error('attempted to sign message but Eth app is not connected!')
          if (!this.derivation) throw new Error('attempted to sign message with unknown derivation!')

          const path = this.getPath(index)
          const signedMessage = await this.eth.signMessage(path, message)
          if (!this.isCurrent(lifecycleVersion)) return

          log.info('successfully signed message on Ledger')

          settle(null, signedMessage)
        } catch (e) {
          if (!this.isCurrent(lifecycleVersion)) return

          const err = e as DeviceError
          const message = wasRequestRejected(err) ? 'Sign request rejected by user' : 'Sign message error'

          const error = wasRequestRejected(err) ? new SignerUserRejectedError(message) : new Error(message)
          settle(error, undefined)

          this.handleError(err)
          log.error('error signing message on Ledger', err.toString())
        }
      }
    })
  }

  override signTypedData(
    index: number,
    typedMessage: TypedMessage<SignTypedDataVersion.V4>,
    cb: Callback<string>
  ) {
    const lifecycleVersion = this.lifecycleVersion
    const settle = this.settleOnce(cb)

    this.enqueueRequests({
      type: 'signTypedData',
      cancel: (error) => settle(error, undefined),
      execute: async () => {
        try {
          if (!this.isCurrent(lifecycleVersion)) return
          if (!this.eth) throw new Error('attempted to sign typed data but Eth app is not connected!')
          if (!this.derivation) throw new Error('attempted to sign typed data with unknown derivation!')

          const path = this.getPath(index)
          const signedData = await this.eth.signTypedData(path, typedMessage.data)
          if (!this.isCurrent(lifecycleVersion)) return

          log.info('successfully signed typed data on Ledger')

          settle(null, signedData)
        } catch (e) {
          if (!this.isCurrent(lifecycleVersion)) return

          const err = e as DeviceError
          const message = wasRequestRejected(err)
            ? 'Sign request rejected by user'
            : `Sign message error: ${err.message}`

          const error = wasRequestRejected(err) ? new SignerUserRejectedError(message) : new Error(message)
          settle(error, undefined)

          this.handleError(err)
          log.error('error signing typed data on Ledger', message)
        }
      }
    })
  }

  override signTransaction(index: number, rawTx: TransactionData, cb: Callback<string>) {
    const compatibility = signerCompatibility(rawTx, this.summary())
    const ledgerTx = compatibility.compatible ? { ...rawTx } : londonToLegacy(rawTx)
    const lifecycleVersion = this.lifecycleVersion
    const settle = this.settleOnce(cb)

    this.enqueueRequests({
      type: 'signTransaction',
      cancel: (error) => settle(error, undefined),
      execute: async () => {
        try {
          if (!this.isCurrent(lifecycleVersion)) return
          if (!this.eth) throw new Error('attempted to sign transaction but Eth app is not connected!')
          if (!this.derivation) throw new Error('attempted to sign transaction with unknown derivation!')

          const path = this.getPath(index)
          const signedTx = await this.eth.signTransaction(path, ledgerTx)
          if (!this.isCurrent(lifecycleVersion)) return

          log.info('successfully signed transaction on Ledger')

          settle(null, signedTx)
        } catch (e) {
          if (!this.isCurrent(lifecycleVersion)) return

          const err = e as DeviceError
          const message = wasRequestRejected(err) ? 'Sign request rejected by user' : 'Sign transaction error'

          const error = wasRequestRejected(err) ? new SignerUserRejectedError(message) : new Error(message)
          settle(error, undefined)

          this.handleError(err)
          log.error('error signing transaction on Ledger', err.toString())
        }
      }
    })
  }

  // *** direct device access methods *** //

  private async getAddress(path: string, display = false, chainCode = false) {
    return new Promise((resolve: (address: Address) => void, reject) => {
      if (!this.eth) {
        return reject(new Error('tried to get address but Eth app is not connected!'))
      }

      let fallback = setTimeout(() => {})

      if (!display) {
        // if display is true, the Ledger waits for user input so never time out
        fallback = setTimeout(() => reject({ message: 'getAddress timed out', statusCode: -1 }), 3000)
      }

      this.eth
        .getAddress(path, display, chainCode)
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(fallback))
    })
  }

  private async getAppConfiguration() {
    // if this call blocks and we are not yet connected it means that the Ledger is locked and
    // the eth app is not open; if the Ledger is locked and eth app IS open, this should return successfully

    return new Promise((resolve: (config: { version: string }) => void, reject) => {
      if (!this.eth) {
        return reject(new Error('tried to get app configuration but Eth app is not connected!'))
      }

      const fallback = setTimeout(() => {
        const statusCode = this.status === Status.INITIAL ? 27904 : -1
        reject({ message: 'getAppConfiguration timed out', statusCode })
      }, 1000)

      this.eth
        .getAppConfiguration()
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(fallback))
    })
  }
}
