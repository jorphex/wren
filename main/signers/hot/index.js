const log = require('electron-log')
const zxcvbn = require('zxcvbn')

const crypt = require('../../crypt')

const SeedSigner = require('./SeedSigner')
const RingSigner = require('./RingSigner')
const { osSignerStorage } = require('./runtimeStorage')
const { stripHexPrefix } = require('@ethereumjs/util')
const { recoveryPhrase } = require('./generate')
const { MINIMUM_NEW_PASSWORD_SCORE, MINIMUM_PASSWORD_LENGTH } = require('../../../resources/domain/password')

const eraseProtectedSignerFiles = (id) => require('./HotSigner').eraseSignerFiles(id)

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const trackSigner = (signers, signer) =>
  typeof signers.trackHotSigner !== 'function' || signers.trackHotSigner(signer)
const untrackSigner = (signers, signer) => signers.untrackHotSigner?.(signer)

const validatePassword = (password, passwordOptions = {}) => {
  if (!password) throw new Error('Password required to create hot signer')
  if (password.length < MINIMUM_PASSWORD_LENGTH) throw new Error('Hot account password is too short')
  if (passwordOptions?.allowWeakPassword !== true && zxcvbn(password).score < MINIMUM_NEW_PASSWORD_SCORE) {
    throw new Error('Hot account password is too weak')
  }
}

const stageSigner = (signers, signer, addSecret, cb, { lockBeforeReady = true } = {}) => {
  if (!trackSigner(signers, signer)) {
    cb(new Error('Signer manager is closed'))
    return undefined
  }

  let cancelled = false
  let settled = false
  const cleanup = () => {
    let cleanupError
    try {
      signer.close()
    } catch (error) {
      cleanupError = error
    }
    try {
      untrackSigner(signers, signer)
    } catch (error) {
      cleanupError ||= error
    }
    if (cleanupError) throw cleanupError
  }
  const cancel = () => {
    if (cancelled || settled) return
    cancelled = true
    cleanup()
  }
  const fail = (error) => {
    if (cancelled || settled) return
    settled = true
    cleanup()
    cb(error)
  }

  let callbackStarted = false
  try {
    addSecret((error) => {
      callbackStarted = true
      if (cancelled || settled) return
      if (error) return fail(error)
      if (!lockBeforeReady) {
        settled = true
        cb(null, signer)
        return
      }
      signer.lock((lockError) => {
        if (cancelled || settled) return
        if (lockError) return fail(lockError)
        settled = true
        cb(null, signer)
      })
    })
  } catch (error) {
    if (callbackStarted) throw error
    fail(error)
  }

  return { cancel, signer }
}

const createStagedSigner = (signers, signer, addSecret, cb) =>
  stageSigner(
    signers,
    signer,
    addSecret,
    (error, stagedSigner) => {
      if (error) return cb(error)

      let admitted = false
      try {
        if (signers.exists?.(stagedSigner.id)) throw new Error('This account already exists')
        if (signers.add(stagedSigner) === false) throw new Error('Signer manager is closed')
        admitted = true
        stagedSigner.commitStaged()
        untrackSigner(signers, stagedSigner)
      } catch (admissionError) {
        try {
          if (admitted) {
            const store = require('../../store').default
            const { requireStoreAction } = require('../../store/action')
            const { commitMainState } = require('../../store/persist')
            requireStoreAction('beginSignerRemoval')(stagedSigner.id, {
              addresses: [],
              kind: 'hot'
            })
            try {
              commitMainState(store('main'))
            } catch (journalError) {
              log.warn('Could not immediately persist rejected signer cleanup', journalError)
            }
            if (typeof signers.rollbackAdmission === 'function') {
              signers.rollbackAdmission(stagedSigner)
            } else {
              signers.remove(stagedSigner.id)
            }
            Promise.resolve(signers.rescanHotSigners?.()).catch((scanError) =>
              log.warn('Could not start rejected signer cleanup', scanError)
            )
          } else stagedSigner.close()
        } catch (cleanupError) {
          log.warn('Could not fully clean up rejected signer import', cleanupError)
        }
        untrackSigner(signers, stagedSigner)
        return cb(admissionError)
      }
      cb(null, stagedSigner)
    },
    { lockBeforeReady: false }
  )

module.exports = {
  newPhrase: (cb) => {
    try {
      cb(null, recoveryPhrase())
    } catch (error) {
      cb(error)
    }
  },
  createFromSeed: (signers, seed, password, cb) => {
    if (!seed) return cb(new Error('Seed required to create hot signer'))
    try {
      validatePassword(password)
    } catch (error) {
      return cb(error)
    }
    const signer = new SeedSigner(undefined, { deferPersistence: true })
    return createStagedSigner(signers, signer, (done) => signer.addSeed(seed, password, done), cb)
  },
  createFromPhrase: (signers, phrase, password, passwordOptions, cb) => {
    if (!phrase) return cb(new Error('Phrase required to create hot signer'))
    try {
      validatePassword(password, passwordOptions)
    } catch (error) {
      return cb(error)
    }
    const signer = new SeedSigner(undefined, { deferPersistence: true })
    return createStagedSigner(signers, signer, (done) => signer.addPhrase(phrase, password, done), cb)
  },
  createFromPrivateKey: (signers, privateKey, password, passwordOptions, cb) => {
    const privateKeyHex = stripHexPrefix(privateKey)

    if (!privateKeyHex) return cb(new Error('Private key required to create hot signer'))
    try {
      validatePassword(password, passwordOptions)
    } catch (error) {
      return cb(error)
    }
    const signer = new RingSigner(undefined, { deferPersistence: true })
    return createStagedSigner(
      signers,
      signer,
      (done) => signer.addPrivateKey(privateKeyHex, password, done),
      cb
    )
  },
  createFromKeystore: (signers, keystore, keystorePassword, password, passwordOptions, cb) => {
    if (!keystore) return cb(new Error('Keystore required'))
    if (!keystorePassword) return cb(new Error('Keystore password required'))
    try {
      validatePassword(password, passwordOptions)
    } catch (error) {
      return cb(error)
    }
    const signer = new RingSigner(undefined, { deferPersistence: true })
    return createStagedSigner(
      signers,
      signer,
      (done) => signer.addKeystore(keystore, keystorePassword, password, done),
      cb
    )
  },
  stageFromPhrase: (signers, phrase, password, passwordOptions, cb) => {
    if (!phrase) return cb(new Error('Phrase required to create hot signer'))
    try {
      validatePassword(password, passwordOptions)
    } catch (error) {
      return cb(error)
    }
    const signer = new SeedSigner(undefined, { deferPersistence: true })
    return stageSigner(signers, signer, (done) => signer.addPhrase(phrase, password, done), cb)
  },
  stageFromPrivateKey: (signers, privateKey, password, passwordOptions, cb) => {
    const privateKeyHex = stripHexPrefix(privateKey)
    if (!privateKeyHex) return cb(new Error('Private key required to create hot signer'))
    try {
      validatePassword(password, passwordOptions)
    } catch (error) {
      return cb(error)
    }
    const signer = new RingSigner(undefined, { deferPersistence: true })
    return stageSigner(signers, signer, (done) => signer.addPrivateKey(privateKeyHex, password, done), cb)
  },
  validatePassword,
  createScanner: (
    signers,
    delay = 4000,
    storage = osSignerStorage,
    eraseFiles = eraseProtectedSignerFiles
  ) => {
    let closed = false
    let retryTimer
    const scheduleScan = () => {
      if (closed || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void scan()
      }, delay)
      retryTimer.unref?.()
    }

    const scan = async () => {
      if (closed) return
      let retryNeeded = false

      const store = require('../../store').default
      const { requireStoreAction } = require('../../store/action')
      const pendingRemovals = store('main.pendingSignerRemovals') || {}
      for (const [id, removal] of Object.entries(pendingRemovals)) {
        if (removal?.kind !== 'hot') continue
        try {
          eraseFiles(id)
          signers.finishRemoval?.(id)
          requireStoreAction('finishSignerRemoval')(id)
        } catch (error) {
          retryNeeded = true
          log.warn(`Could not finish removing software signer ${id}`, error)
        }
      }

      const storedSigners = {}

      // Read the complete signer set through the device-protection boundary.
      let files
      try {
        files = storage.readAllSignerFiles().filter(({ name }) => name.endsWith('.json'))
      } catch (error) {
        log.error('Software signers unavailable:', error.message)
        signers.unload?.('software signer storage unavailable')
        scheduleScan()
        return
      }

      files.forEach(({ bytes, name }) => {
        try {
          const signer = JSON.parse(bytes.toString('utf8'))
          if (!pendingRemovals[signer.id]) storedSigners[signer.id] = signer
        } catch {
          log.error(`Corrupt signer file: ${name}`)
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
      if (retryNeeded) scheduleScan()
    }

    scheduleScan()

    return {
      close: () => {
        closed = true
        clearTimeout(retryTimer)
        retryTimer = undefined
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
