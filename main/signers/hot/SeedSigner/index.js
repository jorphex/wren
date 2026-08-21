const path = require('path')
const HotSigner = require('../HotSigner')
const bip39 = require('bip39')
const { HDKey } = require('@scure/bip32')
const { computeAddress, hexlify } = require('ethers')

const WORKER_PATH = path.resolve(__dirname, 'worker.js')

class SeedSigner extends HotSigner {
  constructor(signer, options) {
    super(signer, WORKER_PATH, options)
    this.encryptedSeed = signer && signer.encryptedSeed
    this.type = 'seed'
    this.model = 'phrase'
    if (this.encryptedSeed) this.update()
  }

  addSeed(seed, password, cb) {
    if (this.encryptedSeed) return cb(new Error('This signer already has a seed'))

    this._callWorker({ method: 'encryptSeed', params: { seed, password } }, (err, encryptedSeed) => {
      if (err) return cb(err)

      let addresses
      try {
        const wallet = HDKey.fromMasterSeed(Buffer.from(seed, 'hex'))
        addresses = Array.from({ length: 100 }, (_, index) => {
          const publicKey = wallet.derive(`m/44'/60'/0'/0/${index}`).publicKey
          if (!publicKey) throw new Error(`Unable to derive public key at index ${index}`)
          return computeAddress(hexlify(publicKey))
        })
      } catch (error) {
        return cb(error)
      }

      // Update signer
      this.encryptedSeed = encryptedSeed
      this.addresses = addresses
      this.update()
      this.unlock(password, cb)
    })
  }

  async addPhrase(phrase, password, cb) {
    // Validate phrase
    if (!bip39.validateMnemonic(phrase)) return cb(new Error('Invalid mnemonic phrase'))
    // Get seed
    const seed = await bip39.mnemonicToSeed(phrase)
    // Add seed to signer
    this.addSeed(seed.toString('hex'), password, cb)
  }

  save(options) {
    super.save({ encryptedSeed: this.encryptedSeed }, options)
  }

  unlock(password, cb) {
    super.unlock(
      password,
      { encryptedSeed: this.encryptedSeed, addresses: this.addresses },
      (err, result) => {
        if (err) return cb(err)
        this.persistEncryptionMigration('encryptedSeed', result?.encryptedSeed, cb)
      }
    )
  }
}

module.exports = SeedSigner
