const HotSignerWorker = require('../HotSigner/worker')
const { decryptSecret } = require('../crypto')
const { privateToAddress } = require('@ethereumjs/util')

class RingSignerWorker extends HotSignerWorker {
  constructor() {
    super()
    this.keys = null
    process.on('message', (message) => this.handleMessage(message))
  }

  unlock({ encryptedKeys, password, addresses }, pseudoCallback) {
    try {
      const { keys, version } = this._decryptKeys(encryptedKeys, password)
      const derivedAddresses = keys.map(
        (key) => `0x${privateToAddress(Buffer.from(key, 'hex')).toString('hex')}`
      )
      if (
        !Array.isArray(addresses) ||
        addresses.length !== derivedAddresses.length ||
        derivedAddresses.some(
          (address, index) =>
            typeof addresses[index] !== 'string' || address !== addresses[index].toLowerCase()
        )
      )
        throw new Error('Private keys do not match addresses')

      this._clearKeys()
      this.keys = keys.map((key) => Buffer.from(key, 'hex'))
      const result = version === 1 ? { encryptedKeys: this._encryptKeys(keys, password) } : undefined
      pseudoCallback(null, result)
    } catch {
      pseudoCallback('Invalid password')
    }
  }

  lock(_, pseudoCallback) {
    this._clearKeys()
    pseudoCallback(null)
  }

  addKey({ encryptedKeys, key, password }, pseudoCallback) {
    try {
      let keys
      // If signer already has encrypted keys -> decrypt them and add new key
      if (encryptedKeys) keys = [...this._decryptKeys(encryptedKeys, password).keys, key]
      // Else -> generate new list of keys
      else keys = [key]
      // Encrypt and return list of keys
      encryptedKeys = this._encryptKeys(keys, password)
      pseudoCallback(null, encryptedKeys)
    } catch {
      pseudoCallback('Invalid password')
    }
  }

  removeKey({ encryptedKeys, index, password }, pseudoCallback) {
    if (!encryptedKeys) return pseudoCallback('Signer does not have any keys')
    try {
      // Get list of decrypted keys
      let keys = this._decryptKeys(encryptedKeys, password).keys
      // Remove key from list
      keys = keys.filter((key) => key !== keys[index])
      // Return encrypted list (or null if empty)
      const result = keys.length > 0 ? this._encryptKeys(keys, password) : null
      pseudoCallback(null, result)
    } catch {
      pseudoCallback('Invalid password')
    }
  }

  signMessage({ index, message }, pseudoCallback) {
    // Make sure signer is unlocked
    if (!this.keys) return pseudoCallback('Signer locked')
    // Sign message
    super.signMessage(this.keys[index], message, pseudoCallback)
  }

  signTypedData({ index, typedMessage }, pseudoCallback) {
    // Make sure signer is unlocked
    if (!this.keys) return pseudoCallback('Signer locked')
    // Sign Typed Data
    super.signTypedData(this.keys[index], typedMessage, pseudoCallback)
  }

  signTransaction({ index, rawTx }, pseudoCallback) {
    // Make sure signer is unlocked
    if (!this.keys) return pseudoCallback('Signer locked')
    // Sign transaction
    super.signTransaction(this.keys[index], rawTx, pseudoCallback)
  }

  signEip7702Revoke({ index, request }, pseudoCallback) {
    if (!this.keys) return pseudoCallback('Signer locked')
    if (!Number.isSafeInteger(index) || index < 0) {
      return pseudoCallback('Invalid signer address index')
    }
    const key = this.keys[index]
    if (!key) return pseudoCallback('Invalid signer address index')
    super.signEip7702Revoke(key, request, pseudoCallback)
  }

  _decryptKeys(encryptedKeys, password) {
    if (!encryptedKeys) return null
    const { plaintext, version } = decryptSecret(encryptedKeys, password)
    const keys = plaintext.split(':')
    if (!keys.length || keys.some((key) => !/^[0-9a-f]{64}$/i.test(key))) {
      throw new Error('Invalid private keys')
    }
    return { keys, version }
  }

  _encryptKeys(keys, password) {
    if (!Array.isArray(keys) || !keys.length || keys.some((key) => !/^[0-9a-f]{64}$/i.test(key))) {
      throw new Error('Invalid private keys')
    }
    const keyString = keys.join(':')
    return this._encrypt(keyString, password)
  }

  _clearKeys() {
    this.keys?.forEach((key) => key.fill(0))
    this.keys = null
  }
}

const ringSignerWorker = new RingSignerWorker() // eslint-disable-line
