const { HDKey } = require('@scure/bip32')
const { computeAddress, hexlify } = require('ethers')
const HotSignerWorker = require('../HotSigner/worker')
const { decryptSecret } = require('../crypto')

class SeedSignerWorker extends HotSignerWorker {
  constructor() {
    super()
    this.seed = null
    process.on('message', (message) => this.handleMessage(message))
  }

  unlock({ encryptedSeed, password, addresses }, pseudoCallback) {
    try {
      const { plaintext, version } = decryptSecret(encryptedSeed, password)
      if (!/^[0-9a-f]{128}$/i.test(plaintext)) throw new Error('Invalid seed')

      if (!Array.isArray(addresses) || addresses.length !== 100) throw new Error('Invalid seed addresses')
      const wallet = HDKey.fromMasterSeed(Buffer.from(plaintext, 'hex'))
      const addressesMatch = addresses.every((address, index) => {
        const publicKey = wallet.derive(`m/44'/60'/0'/0/${index}`).publicKey
        return (
          publicKey &&
          typeof address === 'string' &&
          computeAddress(hexlify(publicKey)).toLowerCase() === address.toLowerCase()
        )
      })
      if (!addressesMatch) throw new Error('Seed does not match addresses')

      this._clearSeed()
      this.seed = Buffer.from(plaintext, 'hex')
      const result = version === 1 ? { encryptedSeed: this._encrypt(plaintext, password) } : undefined
      pseudoCallback(null, result)
    } catch {
      pseudoCallback('Invalid password')
    }
  }

  lock(_, pseudoCallback) {
    this._clearSeed()
    pseudoCallback(null)
  }

  encryptSeed({ seed, password }, pseudoCallback) {
    try {
      const plaintext = seed.toString('hex')
      if (!/^[0-9a-f]{128}$/i.test(plaintext)) throw new Error('Invalid seed')
      pseudoCallback(null, this._encrypt(plaintext, password))
    } catch {
      pseudoCallback('Unable to encrypt seed')
    }
  }

  signMessage({ index, message }, pseudoCallback) {
    // Make sure signer is unlocked
    if (!this.seed) return pseudoCallback('Signer locked')
    // Derive private key
    const key = this._derivePrivateKey(index)
    try {
      super.signMessage(key, message, pseudoCallback)
    } finally {
      key.fill(0)
    }
  }

  signTypedData({ index, typedMessage }, pseudoCallback) {
    // Make sure signer is unlocked
    if (!this.seed) return pseudoCallback('Signer locked')
    // Derive private key
    const key = this._derivePrivateKey(index)
    try {
      super.signTypedData(key, typedMessage, pseudoCallback)
    } finally {
      key.fill(0)
    }
  }

  signTransaction({ index, rawTx }, pseudoCallback) {
    // Make sure signer is unlocked
    if (!this.seed) return pseudoCallback('Signer locked')
    // Derive private key
    const key = this._derivePrivateKey(index)
    try {
      super.signTransaction(key, rawTx, pseudoCallback)
    } finally {
      key.fill(0)
    }
  }

  signEip7702Revoke({ index, request }, pseudoCallback) {
    if (!this.seed) return pseudoCallback('Signer locked')
    if (!Number.isSafeInteger(index) || index < 0) {
      return pseudoCallback('Invalid signer address index')
    }
    const key = this._derivePrivateKey(index)
    try {
      super.signEip7702Revoke(key, request, pseudoCallback)
    } finally {
      key.fill(0)
    }
  }

  _derivePrivateKey(index) {
    let key = HDKey.fromMasterSeed(this.seed)
    key = key.derive("m/44'/60'/0'/0/" + index)
    if (!key.privateKey) throw new Error(`Unable to derive private key at index ${index}`)
    return Buffer.from(key.privateKey)
  }

  _clearSeed() {
    this.seed?.fill(0)
    this.seed = null
  }
}

const seedSignerWorker = new SeedSignerWorker() // eslint-disable-line
