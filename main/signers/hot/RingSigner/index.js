const path = require('path')
const log = require('electron-log')
const { Wallet } = require('@ethereumjs/wallet')

const HotSigner = require('../HotSigner')

const WORKER_PATH = path.resolve(__dirname, 'worker.js')

class RingSigner extends HotSigner {
  constructor(signer, options) {
    super(signer, WORKER_PATH, options)
    this.type = 'ring'
    this.model = 'keyring'
    this.encryptedKeys = signer && signer.encryptedKeys
    if (this.encryptedKeys) this.update()
  }

  save(options) {
    super.save({ encryptedKeys: this.encryptedKeys }, options)
  }

  unlock(password, cb) {
    super.unlock(
      password,
      { encryptedKeys: this.encryptedKeys, addresses: this.addresses },
      (err, result) => {
        if (err) return cb(err)
        this.persistEncryptionMigration('encryptedKeys', result?.encryptedKeys, cb)
      }
    )
  }

  addPrivateKey(key, password, cb) {
    // Validate private key
    let wallet
    try {
      wallet = Wallet.fromPrivateKey(Buffer.from(key, 'hex'))
    } catch {
      return cb(new Error('Invalid private key'))
    }
    const address = wallet.getAddressString()

    // Ensure private key hasn't already been added
    if (this.addresses.includes(address)) {
      return cb(new Error('Private key already added'))
    }

    // Call worker
    const params = { encryptedKeys: this.encryptedKeys, key, password }
    this._callWorker({ method: 'addKey', params }, (err, encryptedKeys) => {
      // Handle errors
      if (err) return cb(err)

      // Update addresses
      this.addresses = [...this.addresses, address]

      // Update encrypted keys
      this.encryptedKeys = encryptedKeys

      // Log and update signer
      log.info('Private key added to signer', this.id)
      this.update()

      // If signer was unlock -> update keys in worker
      this.unlock(password, cb)
    })
  }

  removePrivateKey(index, password, cb) {
    // Call worker
    const params = { encryptedKeys: this.encryptedKeys, index, password }
    this._callWorker({ method: 'removeKey', params }, (err, encryptedKeys) => {
      // Handle errors
      if (err) return cb(err)

      // Remove address at index
      this.addresses = this.addresses.filter((address) => address !== this.addresses[index])

      // Update encrypted keys
      this.encryptedKeys = encryptedKeys

      // Log and update signer
      log.info('Private key removed from signer', this.id)
      this.update()

      // If signer was unlock -> update keys in worker
      if (this.status === 'ok') this.lock(cb)
      else cb(null)
    })
  }

  async addKeystore(keystore, keystorePassword, password, cb) {
    let wallet
    // Try to generate wallet from keystore
    try {
      const version = Number(keystore.version ?? keystore.Version)
      if (version === 1) wallet = await Wallet.fromV1(keystore, keystorePassword)
      else if (version === 3) wallet = await Wallet.fromV3(keystore, keystorePassword)
      else return cb(new Error('Invalid keystore version'))
    } catch (e) {
      return cb(e)
    }
    // Add private key
    this.addPrivateKey(Buffer.from(wallet.getPrivateKey()).toString('hex'), password, cb)
  }
}

module.exports = RingSigner
