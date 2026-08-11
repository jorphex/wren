const path = require('path')
const fs = require('fs')
const { ensureDirSync } = require('fs-extra')
const { app } = require('electron')
const log = require('electron-log')
const bip39 = require('bip39')
const zxcvbn = require('zxcvbn')

const crypt = require('../../crypt')

const SeedSigner = require('./SeedSigner')
const RingSigner = require('./RingSigner')
const { stripHexPrefix } = require('@ethereumjs/util')

const USER_DATA = app
  ? app.getPath('userData')
  : path.resolve(path.dirname(require.main.filename), '../.userData')
const SIGNERS_PATH = path.resolve(USER_DATA, 'signers')

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const trackSigner = (signers, signer) =>
  typeof signers.trackHotSigner !== 'function' || signers.trackHotSigner(signer)
const untrackSigner = (signers, signer) => signers.untrackHotSigner?.(signer)

module.exports = {
  newPhrase: (cb) => {
    cb(null, bip39.generateMnemonic())
  },
  createFromSeed: (signers, seed, password, cb) => {
    if (!seed) return cb(new Error('Seed required to create hot signer'))
    if (!password) return cb(new Error('Password required to create hot signer'))
    if (password.length < 12) return cb(new Error('Hot account password is too short'))
    if (zxcvbn(password).score < 3) return cb(new Error('Hot account password is too weak'))
    const signer = new SeedSigner()
    if (!trackSigner(signers, signer)) return cb(new Error('Signer manager is closed'))
    signer.addSeed(seed, password, (err) => {
      if (err) {
        signer.close()
        untrackSigner(signers, signer)
        return cb(err)
      }
      if (signers.add(signer) === false) {
        untrackSigner(signers, signer)
        return cb(new Error('Signer manager is closed'))
      }
      untrackSigner(signers, signer)
      cb(null, signer)
    })
  },
  createFromPhrase: (signers, phrase, password, cb) => {
    if (!phrase) return cb(new Error('Phrase required to create hot signer'))
    if (!password) return cb(new Error('Password required to create hot signer'))
    if (password.length < 12) return cb(new Error('Hot account password is too short'))
    if (zxcvbn(password).score < 3) return cb(new Error('Hot account password is too weak'))
    const signer = new SeedSigner()
    if (!trackSigner(signers, signer)) return cb(new Error('Signer manager is closed'))
    signer.addPhrase(phrase, password, (err) => {
      if (err) {
        signer.close()
        untrackSigner(signers, signer)
        return cb(err)
      }
      if (signers.add(signer) === false) {
        untrackSigner(signers, signer)
        return cb(new Error('Signer manager is closed'))
      }
      untrackSigner(signers, signer)
      cb(null, signer)
    })
  },
  createFromPrivateKey: (signers, privateKey, password, cb) => {
    const privateKeyHex = stripHexPrefix(privateKey)

    if (!privateKeyHex) return cb(new Error('Private key required to create hot signer'))
    if (!password) return cb(new Error('Password required to create hot signer'))
    if (password.length < 12) return cb(new Error('Hot account password is too short'))
    if (zxcvbn(password).score < 3) return cb(new Error('Hot account password is too weak'))
    const signer = new RingSigner()
    if (!trackSigner(signers, signer)) return cb(new Error('Signer manager is closed'))

    signer.addPrivateKey(privateKeyHex, password, (err) => {
      if (err) {
        signer.close()
        untrackSigner(signers, signer)
        return cb(err)
      }
      if (signers.add(signer) === false) {
        untrackSigner(signers, signer)
        return cb(new Error('Signer manager is closed'))
      }
      untrackSigner(signers, signer)
      cb(null, signer)
    })
  },
  createFromKeystore: (signers, keystore, keystorePassword, password, cb) => {
    if (!keystore) return cb(new Error('Keystore required'))
    if (!keystorePassword) return cb(new Error('Keystore password required'))
    if (!password) return cb(new Error('Password required to create hot signer'))
    if (password.length < 12) return cb(new Error('Hot account password is too short'))
    if (zxcvbn(password).score < 3) return cb(new Error('Hot account password is too weak'))
    const signer = new RingSigner()
    if (!trackSigner(signers, signer)) return cb(new Error('Signer manager is closed'))
    signer.addKeystore(keystore, keystorePassword, password, (err) => {
      if (err) {
        signer.close()
        untrackSigner(signers, signer)
        return cb(err)
      }
      if (signers.add(signer) === false) {
        untrackSigner(signers, signer)
        return cb(new Error('Signer manager is closed'))
      }
      untrackSigner(signers, signer)
      cb(null, signer)
    })
  },
  createScanner: (signers, delay = 4000) => {
    let closed = false

    const scan = async () => {
      if (closed) return

      const storedSigners = {}

      // Ensure signer directory exists
      ensureDirSync(SIGNERS_PATH)

      // Find stored signers, read them from disk and add them to storedSigners
      fs.readdirSync(SIGNERS_PATH)
        .filter((file) => file.endsWith('.json'))
        .forEach((file) => {
          try {
            const signer = JSON.parse(fs.readFileSync(path.resolve(SIGNERS_PATH, file), 'utf8'))
            storedSigners[signer.id] = signer
          } catch {
            log.error(`Corrupt signer file: ${file}`)
          }
        })

      // Add stored signers
      for (const id of Object.keys(storedSigners)) {
        if (closed) return
        await wait(100)
        if (closed) return
        const { addresses, encryptedKeys, encryptedSeed, type, network } = storedSigners[id]
        if (addresses && addresses.length) {
          const id = crypt.stringToKey(addresses.join()).toString('hex')
          if (!signers.exists(id)) {
            if (type === 'seed') {
              signers.add(new SeedSigner({ network, addresses, encryptedSeed }))
            } else if (type === 'ring') {
              signers.add(new RingSigner({ network, addresses, encryptedKeys }))
            }
          }
        }
      }
    }

    const timer = setTimeout(scan, delay)
    timer.unref?.()

    return {
      close: () => {
        closed = true
        clearTimeout(timer)
      },
      scan
    }
  },
  scan: (signers) => {
    const scanner = module.exports.createScanner(signers)
    const scan = scanner.scan
    scan.close = scanner.close
    return scan
  }
}
