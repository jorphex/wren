const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')
const log = require('electron-log')
const { v4: uuid } = require('uuid')

const Signer = require('../../Signer').default
const store = require('../../../store').default
const { signerWorkerEnvironment } = require('../../../worker/environment')
const { osSignerStorage } = require('../runtimeStorage')
const { isSafeSignerId } = require('../../../../resources/domain/signerId')
const SIGNERS_PATH = osSignerStorage.signerRoot
const DEFAULT_RPC_TIMEOUT_MS = 30_000

const eraseFile = (filePath) => {
  const initial = fs.lstatSync(filePath)
  if (initial.isSymbolicLink()) {
    fs.unlinkSync(filePath)
    return
  }
  if (!initial.isFile()) throw new Error('Signer storage entry is not a regular file')
  if (initial.nlink !== 1) throw new Error('Signer storage entry has unexpected hard links')

  const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0)
  const descriptor = fs.openSync(filePath, flags)
  let buffer
  try {
    const opened = fs.fstatSync(descriptor)
    const current = fs.lstatSync(filePath)
    if (
      !current.isFile() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      opened.nlink !== 1 ||
      current.nlink !== 1
    ) {
      throw new Error('Signer storage entry changed while opening')
    }

    const size = opened.size
    buffer = Buffer.alloc(Math.min(Math.max(size, 1), 64 * 1024))
    for (let offset = 0; offset < size; offset += buffer.length) {
      fs.writeSync(descriptor, buffer, 0, Math.min(buffer.length, size - offset), offset)
    }
    fs.fsyncSync(descriptor)
  } finally {
    buffer?.fill(0)
    fs.closeSync(descriptor)
  }
  fs.unlinkSync(filePath)
}

const workerFailure = (reason) => {
  if (reason instanceof Error && reason.message) return reason
  if (typeof reason === 'string' && reason) return new Error(reason)
  return new Error('Hot signer worker stopped')
}

const eraseSignerFiles = (id) => {
  if (!isSafeSignerId(id)) throw new Error('Invalid signer identifier')
  const signerRoot = path.resolve(SIGNERS_PATH)
  const signerPaths = [
    path.resolve(signerRoot, `${id}.legacy-v1.bak`),
    path.resolve(signerRoot, `${id}.json`)
  ]
  if (signerPaths.some((signerPath) => path.dirname(signerPath) !== signerRoot)) {
    throw new Error('Signer path is outside protected storage')
  }

  signerPaths.forEach((signerPath) => {
    try {
      eraseFile(signerPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  })
}

class HotSigner extends Signer {
  constructor(signer, workerPath, options = {}) {
    super()
    this.status = 'locked'
    this.addresses = signer ? signer.addresses : []
    this._worker = options.worker || fork(workerPath, [], { env: signerWorkerEnvironment() })
    this._rpcTimeoutMs = options.rpcTimeoutMs || DEFAULT_RPC_TIMEOUT_MS
    this._pending = new Map()
    this._closed = false
    this._deferPersistence = options.deferPersistence === true
    this._handleWorkerMessage = this._handleWorkerMessage.bind(this)
    this._handleWorkerError = this._handleWorkerError.bind(this)
    this._handleWorkerExit = this._handleWorkerExit.bind(this)
    this._handleWorkerDisconnect = this._handleWorkerDisconnect.bind(this)
    this._worker.on('message', this._handleWorkerMessage)
    this._worker.once('error', this._handleWorkerError)
    this._worker.once('exit', this._handleWorkerExit)
    this._worker.once('disconnect', this._handleWorkerDisconnect)
    this.ready = false
  }

  save(data, { backupLegacy = false } = {}) {
    // Construct signer
    const { id, addresses, type, network } = this
    const signer = { id, addresses, type, network, ...data }

    const signerName = `${id}.json`
    const backupName = `${id}.legacy-v1.bak`
    const signerPath = path.resolve(SIGNERS_PATH, signerName)
    const backupPath = path.resolve(SIGNERS_PATH, backupName)

    if (backupLegacy && fs.existsSync(signerPath)) {
      if (!fs.existsSync(backupPath)) {
        const source = osSignerStorage.readAllSignerFiles().find(({ name }) => name === signerName)
        if (!source) throw new Error('Signer recovery source is unavailable')
        osSignerStorage.writeSignerFile(backupName, source.bytes, { exclusive: true })
      }
    }

    osSignerStorage.writeSignerFile(signerName, Buffer.from(JSON.stringify(signer), 'utf8'))

    // Log
    log.debug('Signer saved to disk')
  }

  delete() {
    eraseSignerFiles(this.id)

    // Log
    log.info('Signer erased from disk')
  }

  remove() {
    // Erase the protected material before changing the live signer state. If
    // erasure fails, the signer remains available and the caller can retry.
    this.delete()

    const deferPersistence = this._deferPersistence
    this._deferPersistence = true
    try {
      this.close()
    } finally {
      this._deferPersistence = deferPersistence
    }
  }

  lock(cb) {
    this._callWorker({ method: 'lock' }, (err) => {
      if (err) return cb(err)
      this.status = 'locked'
      this.update()
      log.info('Signer locked')
      cb(null)
    })
  }

  unlock(password, data, cb) {
    const params = { password, ...data }
    this._callWorker({ method: 'unlock', params }, (err, result) => {
      if (err) return cb(err)
      this.status = 'ok'
      this.update()
      log.info('Signer unlocked')
      cb(null, result)
    })
  }

  persistEncryptionMigration(field, encryptedSecret, cb) {
    if (!encryptedSecret) {
      this.retireLegacyEncryptionBackup()
      return cb(null)
    }

    const previousSecret = this[field]
    this[field] = encryptedSecret

    try {
      this.save({ backupLegacy: true })
      log.info('Signer encryption upgraded')
      cb(null)
    } catch (error) {
      this[field] = previousSecret
      log.error('Unable to persist signer encryption upgrade', error)
      this.lock(() => cb(new Error('Unable to upgrade signer encryption')))
    }
  }

  retireLegacyEncryptionBackup() {
    if (!this.id) return
    const backupPath = path.resolve(SIGNERS_PATH, `${this.id}.legacy-v1.bak`)
    if (!fs.existsSync(backupPath)) return

    try {
      eraseFile(backupPath)
      log.info('Legacy signer encryption recovery copy retired')
    } catch (error) {
      log.warn('Unable to retire legacy signer encryption recovery copy', error)
    }
  }

  close(cb = () => {}) {
    if (this._closed) {
      cb(null)
      return
    }

    this._closed = true
    this._failPending(new Error('Hot signer closed'))
    this._removeWorkerListeners({ keepErrorListener: true })

    try {
      if (this._worker.connected) this._worker.disconnect()
    } catch (error) {
      log.warn('Unable to disconnect hot signer worker', error)
    }

    if (!this._deferPersistence) store.removeSigner(this.id)
    log.info('Signer closed')
    cb(null)
  }

  update() {
    // Get derived ID
    const derivedId = this.fingerprint()

    // On new ID ->
    if (!this.id) {
      // Update id
      this.id = derivedId
      // Write to disk
      if (!this._deferPersistence) this.save()
    } else if (this.id !== derivedId) {
      // On changed ID
      // Erase from disk
      if (!this._deferPersistence) {
        this.delete(this.id)
        // Remove from store
        store.removeSigner(this.id)
      }
      // Update id
      this.id = derivedId
      // Write to disk
      if (!this._deferPersistence) this.save()
    }

    if (!this._deferPersistence) store.updateSigner(this.summary())
    log.info('Signer updated')
  }

  commitStaged() {
    if (!this._deferPersistence || !this.id) {
      throw new Error('Hot signer is not ready to commit')
    }
    this.save()
    this._deferPersistence = false
  }

  signMessage(index, message, cb) {
    const payload = { method: 'signMessage', params: { index, message } }
    this._callWorker(payload, cb)
  }

  signTypedData(index, typedMessage, cb) {
    const payload = { method: 'signTypedData', params: { index, typedMessage } }
    this._callWorker(payload, cb)
  }

  signTransaction(index, rawTx, cb) {
    const payload = { method: 'signTransaction', params: { index, rawTx } }
    this._callWorker(payload, cb)
  }

  signEip7702Revoke(index, request, cb) {
    const payload = { method: 'signEip7702Revoke', params: { index, request } }
    this._callWorker(payload, cb)
  }

  verifyAddress(index, address, display, cb = () => {}) {
    const payload = { method: 'verifyAddress', params: { index, address } }
    this._callWorker(payload, (err, verified) => {
      if (err || !verified) {
        if (!err) {
          store.notify('hotSignerMismatch')
          err = new Error('Unable to verify address')
        }
        this.lock(() => {
          if (err) {
            log.error('HotSigner verifyAddress: Unable to verify address')
          } else {
            log.error('HotSigner verifyAddress: Address mismatch')
          }
          log.error(err)
        })
        cb(err)
      } else {
        log.info('Hot signer verify address matched')
        cb(null, verified)
      }
    })
  }

  _handleWorkerMessage(response) {
    if (this._closed || !response || typeof response !== 'object') return

    if (response.type === 'token') {
      if (this._token || typeof response.token !== 'string' || !response.token) return

      this._token = response.token
      this.ready = true
      this.emit('ready')

      for (const [id, pending] of this._pending) {
        if (!pending.sent) this._dispatchWorkerCall(id, pending)
      }
      return
    }

    if (response.type !== 'rpc' || typeof response.id !== 'string') return

    const error = response.error ? new Error(String(response.error)) : null
    this._settlePending(response.id, error, response.result)
  }

  _handleWorkerError(error) {
    this._stopWorker(workerFailure(error))
  }

  _handleWorkerExit(code, signal) {
    const detail = signal ? `signal ${signal}` : `code ${code}`
    this._stopWorker(new Error(`Hot signer worker exited (${detail})`))
  }

  _handleWorkerDisconnect() {
    this._stopWorker(new Error('Hot signer worker disconnected'))
  }

  _stopWorker(error) {
    if (this._closed) return

    this._closed = true
    this.ready = false
    this.status = 'error'
    this._failPending(error)
    this._removeWorkerListeners()
    if (this.id) store.updateSigner(this.summary())
  }

  _removeWorkerListeners({ keepErrorListener = false } = {}) {
    this._worker.removeListener('message', this._handleWorkerMessage)
    if (!keepErrorListener) this._worker.removeListener('error', this._handleWorkerError)
    this._worker.removeListener('exit', this._handleWorkerExit)
    this._worker.removeListener('disconnect', this._handleWorkerDisconnect)
  }

  _failPending(error) {
    for (const id of [...this._pending.keys()]) {
      try {
        this._settlePending(id, error)
      } catch (callbackError) {
        log.warn('Hot signer callback failed while the signer was closing', callbackError)
      }
    }
  }

  _settlePending(id, error, result) {
    const pending = this._pending.get(id)
    if (!pending) return

    this._pending.delete(id)
    clearTimeout(pending.timeout)
    pending.cb(error, result)
  }

  _dispatchWorkerCall(id, pending) {
    if (this._closed) {
      this._settlePending(id, new Error('Hot signer worker is not running'))
      return
    }

    pending.sent = true

    try {
      this._worker.send({ id, token: this._token, ...pending.payload }, (error) => {
        if (error) this._settlePending(id, workerFailure(error))
      })
    } catch (error) {
      this._settlePending(id, workerFailure(error))
    }
  }

  _callWorker(payload, cb) {
    if (this._closed) {
      cb(new Error('Hot signer worker is not running'))
      return
    }

    const id = uuid()
    const timeout = setTimeout(() => {
      this._settlePending(id, new Error('Hot signer worker request timed out'))
    }, this._rpcTimeoutMs)
    timeout.unref?.()

    const pending = { cb, payload, sent: false, timeout }
    this._pending.set(id, pending)

    if (this._token) this._dispatchWorkerCall(id, pending)
  }
}

module.exports = HotSigner
module.exports.eraseSignerFiles = eraseSignerFiles
