const crypto = require('crypto')
const bip39 = require('bip39')
const { isValidPrivate } = require('@ethereumjs/util')
const { Wallet } = require('@ethereumjs/wallet')
const { getAddress } = require('ethers')

const MNEMONIC_ENTROPY_BYTES = 16
const PRIVATE_KEY_BYTES = 32
const MAX_PRIVATE_KEY_ATTEMPTS = 128

const readSecureBytes = (length, randomBytes = crypto.randomBytes) => {
  const result = randomBytes(length)
  if (!(result instanceof Uint8Array) || result.length !== length) {
    throw new Error('Secure random source returned invalid entropy')
  }
  return Buffer.from(result)
}

const recoveryPhrase = (randomBytes = crypto.randomBytes) => {
  const entropy = readSecureBytes(MNEMONIC_ENTROPY_BYTES, randomBytes)
  try {
    const phrase = bip39.entropyToMnemonic(entropy)
    if (phrase.split(' ').length !== 12 || !bip39.validateMnemonic(phrase)) {
      throw new Error('Generated recovery phrase is invalid')
    }
    return phrase
  } finally {
    entropy.fill(0)
  }
}

const privateKeyAccount = (randomBytes = crypto.randomBytes) => {
  for (let attempt = 0; attempt < MAX_PRIVATE_KEY_ATTEMPTS; attempt += 1) {
    const candidate = readSecureBytes(PRIVATE_KEY_BYTES, randomBytes)
    try {
      if (!isValidPrivate(candidate)) continue
      const privateKey = candidate.toString('hex')
      const wallet = Wallet.fromPrivateKey(candidate)
      return {
        address: getAddress(wallet.getAddressString()),
        privateKey: `0x${privateKey}`
      }
    } finally {
      candidate.fill(0)
    }
  }
  throw new Error('Secure random source could not produce a valid private key')
}

module.exports = {
  MNEMONIC_ENTROPY_BYTES,
  PRIVATE_KEY_BYTES,
  privateKeyAccount,
  readSecureBytes,
  recoveryPhrase
}
