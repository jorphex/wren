import log from 'electron-log'
import { encode } from 'rlp'
import { Client, Utils, Constants } from 'gridplus-sdk'
import { padToEven, addHexPrefix, stripHexPrefix } from '@ethereumjs/util'
import { TypedTransaction } from '@ethereumjs/tx'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'

import Signer from '../../Signer'
import { sign, signerCompatibility, londonToLegacy } from '../../../transaction'
import { Derivation, getDerivationPath } from '../../Signer/derive'
import { hexToInt } from '../../../../resources/utils'

import type { TypedData, TypedMessage } from '../../../accounts/types'
import type { TransactionData } from '../../../../resources/domain/transaction'
import { SignerUserRejectedError } from '../../errors'

const ADDRESS_LIMIT = 10
const HARDENED_OFFSET = 0x80000000

interface DeriveOptions {
  retries: number
  derivation?: Derivation
}

type SignatureComponent = string | number | bigint | Uint8Array

interface Signature {
  r: SignatureComponent
  s: SignatureComponent
  v?: SignatureComponent
}

type LatticeResponseError = {
  name: 'LatticeResponseError'
  responseCode: number
  errorMessage: string
}

type SigningPayload = Parameters<InstanceType<typeof Client>['sign']>[0]['data']
type LatticeSignOptions = Parameters<InstanceType<typeof Client>['sign']>[0]
type SignProtocol = 'eip712' | 'signPersonal'

interface LatticeUnsignedTransaction extends Record<string, unknown> {
  chainId: string
  nonce: number
  gasLimit: number
  useEIP155: boolean
  signerPath: number[]
}

export const Status = {
  OK: 'ready',
  CONNECTING: 'connecting',
  DERIVING: 'loading-addresses',
  READY_FOR_PAIRING: 'pairing-code-required',
  LOCKED: 'locked',
  PAIRING: 'pairing',
  PAIRING_FAILED: 'pairing-failed',
  NO_ACTIVE_WALLET: 'no-active-wallet',
  UNKNOWN_ERROR: 'device-error',
  DISCONNECTED: 'disconnected',
  NEEDS_RECONNECTION: 'reconnect-required'
}

const USER_DECLINED_RESPONSE = 132

class StaleLatticeOperationError extends Error {
  constructor(message = 'Lattice connection changed before request completed') {
    super(message)
    this.name = 'StaleLatticeOperationError'
  }
}

function devicePermission(tag: string) {
  return tag ? `Frame-${tag}` : 'Frame'
}

function parseError(err: Error) {
  return (err.message || '').replace(/Error from device: /, '')
}

function getStatusForError(err: Error) {
  const errText = (err.message || '').toLowerCase()

  if (errText.includes('device locked')) {
    return Status.LOCKED
  }

  if (errText.includes('pairing failed')) {
    return Status.PAIRING_FAILED
  }

  return Status.UNKNOWN_ERROR
}

function signatureComponentToHex(component: SignatureComponent) {
  if (typeof component === 'string') return stripHexPrefix(component)
  if (typeof component === 'number' || typeof component === 'bigint') return component.toString(16)
  return Buffer.from(component).toString('hex')
}

function normalizeSignature(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Lattice returned no signature')

  const { r, s, v } = value as Partial<Signature>
  if (r === undefined || s === undefined || v === undefined) {
    throw new Error('Lattice returned an incomplete signature')
  }

  return {
    r: signatureComponentToHex(r),
    s: signatureComponentToHex(s),
    v: padToEven(signatureComponentToHex(v))
  }
}

function getSigningErrorMessage(err: unknown) {
  if (err && typeof err === 'object') {
    const { errorMessage, message } = err as Partial<LatticeResponseError & Error>

    if (errorMessage) return errorMessage
    if (message) return message
  }

  return 'Unknown Lattice signing error'
}

function isUserRejection(err: unknown) {
  if (err instanceof SignerUserRejectedError) return true
  if (!err || typeof err !== 'object') return false

  const { responseCode } = err as Partial<LatticeResponseError>
  return responseCode === USER_DECLINED_RESPONSE
}

function toSignerError(err: unknown) {
  if (isUserRejection(err)) return new SignerUserRejectedError()
  if (err instanceof Error) return err
  return new Error(getSigningErrorMessage(err))
}

function once<T>(cb: Callback<T>) {
  let called = false

  return (error: Error | null, result?: T) => {
    if (called) return
    called = true
    cb(error, result)
  }
}

export default class Lattice extends Signer {
  deviceId: string
  derivation: Derivation | undefined
  connection: Client | null = null

  accountLimit = 5
  tag = ''

  private closed = false
  private connectionGeneration = 0
  private derivationGeneration = 0
  private deviceQueue: Promise<void> = Promise.resolve()
  private retryTimers = new Map<ReturnType<typeof setTimeout>, (error: Error) => void>()
  private operationCancellations = new Set<(error: Error) => void>()

  constructor(deviceId: string, name: string, tag: string) {
    super()

    this.id = 'lattice-' + deviceId
    this.deviceId = deviceId
    this.name = name
    this.tag = tag
    this.status = Status.DISCONNECTED
    this.type = 'lattice'
    this.model = 'Lattice1'
  }

  async connect(baseUrl: string, privateKey: string) {
    if (this.closed) throw new Error('Lattice signer is closed')

    this.cancelOperations(new StaleLatticeOperationError())
    const generation = ++this.connectionGeneration
    ++this.derivationGeneration
    this.cancelRetryTimers(new StaleLatticeOperationError())

    this.status = Status.CONNECTING
    this.emit('update')

    log.info('connecting to Lattice', { name: this.name, baseUrl })

    try {
      const connection = new Client({
        name: devicePermission(this.tag),
        baseUrl,
        privKey: privateKey
      })
      this.connection = connection

      const connecting = connection.connect(this.deviceId)
      this.deviceQueue = connecting.then(
        () => undefined,
        () => undefined
      )

      const paired = await connecting
      this.assertCurrentConnection(generation, connection)

      const { fix: patch, minor, major } = connection.getFwVersion() || { fix: 0, major: 0, minor: 0 }

      log.info(
        `Connected to Lattice with deviceId=${this.deviceId} paired=${paired}, firmware v${major}.${minor}.${patch}`
      )

      this.appVersion = { major, minor, patch }

      if (!paired) {
        this.status = Status.READY_FOR_PAIRING
        this.emit('update')
      }

      this.emit('connect', paired)

      return paired
    } catch (e) {
      if (e instanceof StaleLatticeOperationError || generation !== this.connectionGeneration) {
        throw toSignerError(e)
      }

      const errorMessage = this.handleError('could not connect to Lattice', e as Error)

      this.connection = null
      this.cancelOperations(new Error(errorMessage))

      this.emit('error')

      throw new Error(errorMessage)
    }
  }

  disconnect() {
    this.cancelOperations(new StaleLatticeOperationError('Lattice disconnected before request completed'))
    ++this.connectionGeneration
    ++this.derivationGeneration
    this.deviceQueue = Promise.resolve()
    this.cancelRetryTimers(new StaleLatticeOperationError('Lattice disconnected before request completed'))

    const operationalStatuses = new Set([
      Status.OK,
      Status.CONNECTING,
      Status.DERIVING,
      Status.READY_FOR_PAIRING,
      Status.PAIRING,
      Status.NO_ACTIVE_WALLET,
      Status.DISCONNECTED
    ])

    if (this.status !== Status.DISCONNECTED && operationalStatuses.has(this.status)) {
      this.status = Status.DISCONNECTED
      this.emit('update')
    }

    this.connection = null

    this.addresses = []
  }

  override close() {
    if (this.closed) return
    this.closed = true

    this.emit('close')
    this.removeAllListeners()

    this.disconnect()

    super.close()
  }

  async pair(pairingCode: string) {
    log.info(`pairing to Lattice ${this.deviceId}`)

    try {
      const { connection, generation } = this.connectionSnapshot()
      const hasActiveWallet = await this.enqueueDeviceRequest(connection, generation, async () => {
        this.status = Status.PAIRING
        this.emit('update')

        return connection.pair(pairingCode)
      })

      this.assertCurrentConnection(generation, connection)

      log.info(`successfully paired to Lattice ${this.deviceId}`)

      if (!hasActiveWallet) {
        this.status = Status.NO_ACTIVE_WALLET
        this.emit('update')
      }

      this.emit('paired', hasActiveWallet)

      return hasActiveWallet
    } catch (e) {
      if (e instanceof StaleLatticeOperationError) throw e

      if (isUserRejection(e)) {
        this.status = Status.READY_FOR_PAIRING
        this.emit('update')
        throw toSignerError(e)
      }

      const errorMessage = this.handleError('could not pair to Lattice', e as Error)

      this.emit('error')

      throw new Error(errorMessage)
    }
  }

  async deriveAddresses(derivation?: Derivation, retries = 2) {
    try {
      const { connection, generation: connectionGeneration } = this.connectionSnapshot()
      this.cancelRetryTimers(new StaleLatticeOperationError('Lattice derivation was replaced'))
      const generation = ++this.derivationGeneration
      const selectedDerivation = derivation ?? this.derivation

      if (!selectedDerivation) throw new Error('attempted to derive addresses with unknown derivation')

      this.derivation = selectedDerivation
      this.status = Status.DERIVING
      this.emit('update')

      log.info(`deriving addresses for Lattice ${connection.getAppName()}`)

      const addresses = await this.derive(
        { derivation: selectedDerivation, retries },
        { connection, connectionGeneration, derivationGeneration: generation }
      )

      this.assertCurrentDerivation(generation, connectionGeneration, connection)
      this.addresses = addresses
      this.status = Status.OK
      this.emit('update')
    } catch (e) {
      if (e instanceof StaleLatticeOperationError) return
      this.emit('error', e)
    }
  }

  private async derive(
    opts: DeriveOptions,
    context?: { connection: Client; connectionGeneration: number; derivationGeneration: number }
  ): Promise<string[]> {
    const { retries } = opts
    const derivation = opts.derivation ?? this.derivation

    if (!derivation) throw new Error('attempted to derive addresses with unknown derivation')

    const activeConnection = this.connectionSnapshot()
    const snapshot = context ?? {
      connection: activeConnection.connection,
      connectionGeneration: activeConnection.generation,
      derivationGeneration: this.derivationGeneration
    }
    const { connection, connectionGeneration, derivationGeneration } = snapshot
    const accountLimit = this.accountLimit
    const addresses = [...this.addresses]

    try {
      const addressLimit = derivation === Derivation.live ? 1 : ADDRESS_LIMIT

      while (addresses.length < accountLimit) {
        const req = {
          startPath: this.getPath(addresses.length, derivation),
          n: Math.min(addressLimit, accountLimit - addresses.length)
        }

        const loadedAddresses = await this.enqueueDeviceRequest(connection, connectionGeneration, () =>
          connection.getAddresses(req)
        )
        this.assertCurrentDerivation(derivationGeneration, connectionGeneration, connection)
        addresses.push(...loadedAddresses.map((addr) => addHexPrefix(addr.toString())))
      }

      return addresses.map((addr) => addHexPrefix(addr.toString()))
    } catch (e) {
      const err = e as Error

      if (err instanceof StaleLatticeOperationError) throw err

      if (retries > 0) {
        log.verbose(
          `Deriving ${derivation} Lattice addresses failed, trying ${retries} more times, error:`,
          err.message
        )

        await this.waitForRetry(3000)
        this.assertCurrentDerivation(derivationGeneration, connectionGeneration, connection)
        return this.derive({ derivation, retries: retries - 1 }, snapshot)
      }

      const errorMessage = this.handleError('could not derive addresses', err)

      throw new Error(errorMessage)
    }
  }

  override async verifyAddress(
    index: number,
    currentAddress: string,
    _display = true,
    cb: Callback<boolean>
  ) {
    const settle = once(cb)

    try {
      const { connection, generation: connectionGeneration } = this.connectionSnapshot()
      const derivationGeneration = this.derivationGeneration
      const derivation = this.derivation
      if (!derivation) throw new Error('attempted to verify address with unknown derivation')

      log.info(`verifying address ${currentAddress} for Lattice ${connection.getAppName()}`)

      const addresses = await this.derive(
        { derivation, retries: 0 },
        { connection, connectionGeneration, derivationGeneration }
      )
      this.assertCurrentDerivation(derivationGeneration, connectionGeneration, connection)

      const address = stripHexPrefix(addresses[index] || '').toLowerCase()

      if (address !== stripHexPrefix(currentAddress).toLowerCase()) {
        throw new Error('Address does not match device')
      }

      log.info(`address ${currentAddress} matches device`)

      settle(null, true)
    } catch (e) {
      const err = e as Error

      if (!(err instanceof StaleLatticeOperationError)) {
        this.handleError('could not verify address', err)
        this.emit('error')
      }

      settle(err)
    }
  }

  override async signMessage(index: number, message: string, cb: Callback<string>) {
    const settle = once(cb)

    try {
      const signature = await this.sign(index, 'signPersonal', message)

      return settle(null, signature)
    } catch (err) {
      log.error('failed to sign message with Lattice', err)
      return settle(toSignerError(err))
    }
  }

  override async signTypedData(
    index: number,
    typedMessage: TypedMessage<SignTypedDataVersion.V4>,
    cb: Callback<string>
  ) {
    const settle = once(cb)

    try {
      const signature = await this.sign(index, 'eip712', typedMessage.data)

      return settle(null, signature)
    } catch (err) {
      log.error('failed to sign typed data with Lattice', err)
      return settle(toSignerError(err))
    }
  }

  override async signTransaction(index: number, rawTx: TransactionData, cb: Callback<string>) {
    const settle = once(cb)

    try {
      const { connection, generation } = this.connectionSnapshot()
      const compatibility = signerCompatibility(rawTx, this.summary())
      const latticeTx = compatibility.compatible ? { ...rawTx } : londonToLegacy(rawTx)
      const derivation = this.derivation
      if (!derivation) throw new Error('attempted to sign transaction with unknown derivation')

      const signedTx = await sign(latticeTx, async (tx) => {
        const unsignedTx = this.createTransaction(index, latticeTx.chainId, tx, derivation)
        const signingOptions = await this.createTransactionSigningOptions(connection, tx, unsignedTx)
        this.assertCurrentConnection(generation, connection)

        const signedTx = await this.enqueueDeviceRequest(connection, generation, () =>
          connection.sign(signingOptions)
        )
        this.assertCurrentConnection(generation, connection)
        return normalizeSignature(signedTx?.sig)
      })

      settle(null, addHexPrefix(signedTx.serialize().toString('hex')))
    } catch (err) {
      log.error('error signing transaction with Lattice', err)
      return settle(toSignerError(err))
    }
  }

  override summary() {
    const summary = super.summary()

    return {
      ...summary,
      tag: this.tag,
      addresses: this.addresses.slice(0, this.accountLimit || this.addresses.length)
    }
  }

  private async sign(index: number, protocol: SignProtocol, payload: string | TypedData) {
    const { connection, generation } = this.connectionSnapshot()
    const derivation = this.derivation
    if (!derivation) throw new Error('attempted to sign with unknown derivation')

    const data = {
      protocol,
      payload,
      curveType: Constants.SIGNING.CURVES.SECP256K1,
      hashType: Constants.SIGNING.HASHES.KECCAK256,
      signerPath: this.getPath(index, derivation)
    } as SigningPayload

    const signOpts = {
      currency: 'ETH_MSG' as const,
      data: data
    }

    const result = await this.enqueueDeviceRequest(connection, generation, () => connection.sign(signOpts))
    this.assertCurrentConnection(generation, connection)
    const sig = normalizeSignature(result?.sig)

    const signature = [sig.r, sig.s, sig.v].join('')

    return addHexPrefix(signature)
  }

  private createTransaction(index: number, chainId: string, tx: TypedTransaction, derivation: Derivation) {
    const { value, to, data, ...txJson } = tx.toJSON()

    const unsignedTx: LatticeUnsignedTransaction = {
      to,
      value,
      data,
      chainId,
      nonce: hexToInt(txJson.nonce || ''),
      gasLimit: hexToInt(txJson.gasLimit || ''),
      useEIP155: true,
      signerPath: this.getPath(index, derivation)
    }

    if (tx.type) {
      unsignedTx['type'] = tx.type
    }

    if ('accessList' in txJson) {
      unsignedTx['accessList'] = txJson.accessList
    }

    const optionalFields = ['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']

    optionalFields.forEach((field) => {
      if (field in txJson) {
        const value = txJson[field as keyof typeof txJson]
        unsignedTx[field] = hexToInt(value?.toString() || '')
      }
    })

    return unsignedTx
  }

  private async createTransactionSigningOptions(
    connection: Client,
    tx: TypedTransaction,
    unsignedTx: LatticeUnsignedTransaction
  ): Promise<LatticeSignOptions> {
    const fwVersion = connection.getFwVersion()

    if (fwVersion && (fwVersion.major > 0 || fwVersion.minor >= 15)) {
      const payload = tx.type ? tx.getMessageToSign(false) : encode(tx.getMessageToSign(false))

      const to = tx.to?.toString() ?? undefined

      const callDataDecoder = to
        ? await Utils.fetchCalldataDecoder(tx.data, to, unsignedTx.chainId)
        : undefined

      const data = {
        payload,
        curveType: Constants.SIGNING.CURVES.SECP256K1,
        hashType: Constants.SIGNING.HASHES.KECCAK256,
        encodingType: Constants.SIGNING.ENCODINGS.EVM,
        signerPath: unsignedTx.signerPath,
        ...(callDataDecoder && { decoder: Buffer.from(callDataDecoder.def) })
      }

      return { data, currency: 'ETH' as const }
    }

    return { currency: 'ETH' as const, data: unsignedTx } as unknown as LatticeSignOptions
  }

  private getPath(index: number, derivation = this.derivation) {
    if (!derivation) throw new Error('attempted to get base path with unknown derivation!')

    const path = getDerivationPath(derivation, index)

    return path.split('/').map((element) => {
      if (element.endsWith("'")) {
        return parseInt(element.substring(0, element.length - 1)) + HARDENED_OFFSET
      }

      return parseInt(element)
    })
  }

  private handleError(message: string, err: Error) {
    const status = getStatusForError(err)
    const parsedErrorMessage = parseError(err)
    const fullMessage = message + ': ' + parsedErrorMessage

    log.error(fullMessage)

    this.status = status

    return fullMessage
  }

  private connectionSnapshot() {
    if (this.closed) throw new Error('Lattice signer is closed')
    if (!this.connection) throw new Error('Lattice is disconnected')

    return { connection: this.connection, generation: this.connectionGeneration }
  }

  private isCurrentConnection(generation: number, connection: Client) {
    return !this.closed && generation === this.connectionGeneration && connection === this.connection
  }

  private assertCurrentConnection(generation: number, connection: Client) {
    if (!this.isCurrentConnection(generation, connection)) throw new StaleLatticeOperationError()
  }

  private assertCurrentDerivation(
    derivationGeneration: number,
    connectionGeneration: number,
    connection: Client
  ) {
    this.assertCurrentConnection(connectionGeneration, connection)
    if (derivationGeneration !== this.derivationGeneration) throw new StaleLatticeOperationError()
  }

  private enqueueDeviceRequest<T>(connection: Client, generation: number, request: () => Promise<T>) {
    const previous = this.deviceQueue
    const queued = this.withOperationCancellation(generation, connection, async () => {
      await previous
      this.assertCurrentConnection(generation, connection)
      return request()
    })

    this.deviceQueue = queued.then(
      () => undefined,
      () => undefined
    )

    return queued
  }

  private withOperationCancellation<T>(generation: number, connection: Client, request: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      let settled = false

      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        this.operationCancellations.delete(cancel)
        settle()
      }
      const cancel = (error: Error) => finish(() => reject(error))

      this.operationCancellations.add(cancel)

      Promise.resolve()
        .then(() => {
          this.assertCurrentConnection(generation, connection)
          return request()
        })
        .then(
          (result) => {
            try {
              this.assertCurrentConnection(generation, connection)
              finish(() => resolve(result))
            } catch (error) {
              finish(() => reject(error))
            }
          },
          (error) => finish(() => reject(error))
        )
    })
  }

  private cancelOperations(error: Error) {
    const cancellations = [...this.operationCancellations]
    this.operationCancellations.clear()
    cancellations.forEach((cancel) => cancel(error))
  }

  private waitForRetry(delay: number) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer)
        resolve()
      }, delay)

      this.retryTimers.set(timer, reject)
    })
  }

  private cancelRetryTimers(error: Error) {
    this.retryTimers.forEach((reject, timer) => {
      clearTimeout(timer)
      reject(error)
    })
    this.retryTimers.clear()
  }
}
