const crypto = require('crypto')
const { signTypedData } = require('@metamask/eth-sig-util')
const { TransactionFactory } = require('@ethereumjs/tx')
const { Common } = require('@ethereumjs/common')
const {
  hashPersonalMessage,
  toBuffer,
  ecsign,
  addHexPrefix,
  pubToAddress,
  ecrecover
} = require('@ethereumjs/util')
const { encryptSecret } = require('../crypto')

function chainConfig(chain, hardfork) {
  const chainId = BigInt(chain)

  return Common.isSupportedChainId(chainId)
    ? new Common({ chain: chainId, hardfork })
    : Common.custom({ chainId: chainId }, { baseChain: 'mainnet', hardfork })
}

class HotSignerWorker {
  constructor() {
    this.token = crypto.randomBytes(32).toString('hex')
    process.send({ type: 'token', token: this.token })
  }

  handleMessage({ id, method, params, token }) {
    // Define (pseudo) callback
    const pseudoCallback = (error, result) => {
      // Add correlation id to response
      const response = { id, error, result, type: 'rpc' }
      // Send response to parent process
      process.send(response)
    }
    // Verify token
    if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.token)))
      return pseudoCallback('Invalid token')
    // If method exists -> execute
    if (this[method]) return this[method](params, pseudoCallback)
    // Else return error
    pseudoCallback(`Invalid method: '${method}'`)
  }

  signMessage(key, message, pseudoCallback) {
    // Hash message
    const hash = hashPersonalMessage(toBuffer(message))

    // Sign message
    const signed = ecsign(hash, key)

    // Return serialized signed message
    const hex = Buffer.concat([signed.r, signed.s, Buffer.from([Number(signed.v)])]).toString('hex')

    pseudoCallback(null, addHexPrefix(hex))
  }

  signTypedData(key, typedMessage, pseudoCallback) {
    try {
      const { data, version } = typedMessage
      const signature = signTypedData({ privateKey: key, data, version })
      pseudoCallback(null, signature)
    } catch (e) {
      pseudoCallback(e.message)
    }
  }

  signTransaction(key, rawTx, pseudoCallback) {
    if (!rawTx.chainId) {
      console.error(`invalid chain id ${rawTx.chainId} for transaction`)
      return pseudoCallback('could not determine chain id for transaction')
    }

    const chainId = parseInt(rawTx.chainId, 16)
    const hardfork = parseInt(rawTx.type) === 2 ? 'london' : 'berlin'
    const common = chainConfig(chainId, hardfork)

    const tx = TransactionFactory.fromTxData(rawTx, { common })
    const signedTx = tx.sign(key)
    const serialized = signedTx.serialize().toString('hex')

    pseudoCallback(null, addHexPrefix(serialized))
  }

  verifyAddress({ index, address }, pseudoCallback) {
    const message = '0x' + crypto.randomBytes(32).toString('hex')
    this.signMessage({ index, message }, (err, signedMessage) => {
      // Handle signing errors
      if (err) return pseudoCallback(err)
      // Signature -> buffer
      const signature = Buffer.from(signedMessage.replace('0x', ''), 'hex')
      // Ensure correct length
      if (signature.length !== 65)
        return pseudoCallback(new Error('Wren verifyAddress signature has incorrect length'))
      // Verify address
      let v = signature[64]
      v = BigInt(v === 0 || v === 1 ? v + 27 : v)
      const r = toBuffer(signature.slice(0, 32))
      const s = toBuffer(signature.slice(32, 64))
      const hash = hashPersonalMessage(toBuffer(message))
      const verifiedAddress = '0x' + pubToAddress(ecrecover(hash, v, r, s)).toString('hex')
      // Return result
      pseudoCallback(null, verifiedAddress.toLowerCase() === address.toLowerCase())
    })
  }

  _encrypt(string, password) {
    return encryptSecret(string, password)
  }
}

module.exports = HotSignerWorker
