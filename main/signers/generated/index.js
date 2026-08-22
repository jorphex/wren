const crypto = require('crypto')

const hot = require('../hot')
const { privateKeyAccount, readSecureBytes, recoveryPhrase } = require('../hot/generate')

const SESSION_TTL_MS = 10 * 60 * 1000
const STAGING_TTL_MS = 60 * 1000
const MAX_SESSIONS = 4
const PHRASE_CHALLENGE_SIZE = 3
const PHRASE_WORD_COUNT = 12
const MAX_RANDOM_INDEX_ATTEMPTS = 128
const BACKUP_MISMATCH_ERROR = 'Backup confirmation does not match'
const SESSION_UNAVAILABLE_ERROR = 'Wallet creation session is no longer available'
const PARTIAL_ROLLBACK_ERROR =
  'Wallet creation could not be rolled back completely. Check Accounts before trying again.'

const normalizePrivateKey = (value) =>
  String(value || '')
    .trim()
    .replace(/^0x/iu, '')
    .toLowerCase()
const normalizeWord = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

class GeneratedWalletSessions {
  constructor(signers, options = {}) {
    this.signers = signers
    this.randomBytes = options.randomBytes || crypto.randomBytes
    this.sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS
    this.stagingTtlMs = options.stagingTtlMs ?? STAGING_TTL_MS
    this.now = options.now || Date.now
    this.setTimeout = options.setTimeout || setTimeout
    this.clearTimeout = options.clearTimeout || clearTimeout
    this.onError = options.onError || (() => {})
    this.sessions = new Map()
    this.closed = false
  }

  report(error) {
    try {
      this.onError(error)
    } catch {
      // Error reporting must never extend the lifetime of generated secret material.
    }
  }

  deliver(cb, ...args) {
    try {
      return cb(...args) !== false
    } catch (error) {
      this.report(error)
      return false
    }
  }

  digest(key, kind, value) {
    return crypto.createHmac('sha256', key).update(`wren-generated-wallet-v1\0${kind}\0${value}`).digest()
  }

  newSessionId() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const bytes = readSecureBytes(16, this.randomBytes)
      try {
        const id = bytes.toString('hex')
        if (!this.sessions.has(id)) return id
      } finally {
        bytes.fill(0)
      }
    }
    throw new Error('Unable to allocate a wallet creation session')
  }

  randomIndex(maxExclusive) {
    const limit = 256 - (256 % maxExclusive)
    for (let attempt = 0; attempt < MAX_RANDOM_INDEX_ATTEMPTS; attempt += 1) {
      const bytes = readSecureBytes(1, this.randomBytes)
      try {
        if (bytes[0] < limit) return bytes[0] % maxExclusive
      } finally {
        bytes.fill(0)
      }
    }
    throw new Error('Unable to select a wallet backup challenge')
  }

  phraseChallenge() {
    const available = Array.from({ length: PHRASE_WORD_COUNT }, (_, index) => index + 1)
    const selected = []
    while (selected.length < PHRASE_CHALLENGE_SIZE) {
      selected.push(available.splice(this.randomIndex(available.length), 1)[0])
    }
    return selected.sort((a, b) => a - b)
  }

  reserve(cb) {
    if (this.closed) return this.deliver(cb, new Error('Signer manager is closed'))
    if (this.sessions.size >= MAX_SESSIONS)
      return this.deliver(cb, new Error('Too many wallet creation sessions are active'))

    let id
    let timer
    try {
      id = this.newSessionId()
      const stagingExpiresAt = this.now() + this.stagingTtlMs
      timer = this.setTimeout(() => {
        if (this.sessions.get(id)?.timer === timer) this.discard(id, () => {})
      }, this.stagingTtlMs)
      timer.unref?.()
      this.sessions.set(id, { id, stagingExpiresAt, state: 'reserved', timer })
    } catch (error) {
      if (timer) {
        try {
          this.clearTimeout(timer)
        } catch {
          // Nothing was admitted, and the timer cannot retain a session without its map entry.
        }
      }
      this.deliver(cb, error)
      return
    }

    if (!this.deliver(cb, null, { sessionId: id })) this.discard(id, () => {})
  }

  cleanupSigner(signer) {
    let cleanupError
    try {
      this.signers.untrackHotSigner?.(signer)
    } catch (error) {
      cleanupError = error
    }
    try {
      signer.close()
    } catch (error) {
      cleanupError ||= error
    }
    return cleanupError
  }

  settleBegin(session, error, presentation) {
    if (session.beginSettled) return
    session.beginSettled = true
    const delivered = this.deliver(session.beginCb, error, presentation)
    if (!error && !delivered && this.sessions.get(session.id) === session) {
      this.discard(session.id, (cleanupError) => {
        if (cleanupError) this.report(cleanupError)
      })
    }
  }

  begin(id, kind, password, cb) {
    const session = this.sessions.get(id)
    if (!session || session.state !== 'reserved') return cb(new Error(SESSION_UNAVAILABLE_ERROR))
    if (this.now() >= session.stagingExpiresAt) {
      return this.discard(id, (error) => {
        if (error) this.report(error)
        cb(new Error(SESSION_UNAVAILABLE_ERROR))
      })
    }
    if (kind !== 'phrase' && kind !== 'private-key') return cb(new Error('Unknown generated wallet type'))
    try {
      hot.validatePassword(password)
    } catch (error) {
      return cb(error)
    }

    Object.assign(session, { beginCb: cb, beginSettled: false, state: 'staging' })
    let generated
    try {
      generated =
        kind === 'phrase' ? { secret: recoveryPhrase(this.randomBytes) } : privateKeyAccount(this.randomBytes)
    } catch (error) {
      this.finish(id)
      return this.settleBegin(session, error)
    }

    const stage = kind === 'phrase' ? hot.stageFromPhrase : hot.stageFromPrivateKey
    const secret = kind === 'phrase' ? generated.secret : generated.privateKey
    let callbackReceived = false
    const handleStage = (error, signer) => {
      if (callbackReceived) {
        if (signer && (!session.stageCancelled || !session.stageOwnsCleanup)) this.cleanupSigner(signer)
        return
      }
      callbackReceived = true

      if (this.sessions.get(id) !== session || session.state !== 'staging') {
        if (signer && (!session.stageCancelled || !session.stageOwnsCleanup)) this.cleanupSigner(signer)
        return
      }
      if (this.now() >= session.stagingExpiresAt) {
        this.finish(id)
        if (signer) this.cleanupSigner(signer)
        return this.settleBegin(session, new Error(SESSION_UNAVAILABLE_ERROR))
      }
      if (error) {
        this.finish(id)
        if (signer) this.cleanupSigner(signer)
        return this.settleBegin(session, error)
      }

      if (
        kind === 'private-key' &&
        String(signer.addresses?.[0] || '').toLowerCase() !== generated.address.toLowerCase()
      ) {
        this.finish(id)
        this.cleanupSigner(signer)
        return this.settleBegin(session, new Error('Generated private-key address does not match'))
      }
      if (this.signers.exists?.(signer.id)) {
        this.finish(id)
        this.cleanupSigner(signer)
        return this.settleBegin(session, new Error('This account already exists'))
      }
      if (this.closed) {
        this.finish(id)
        this.cleanupSigner(signer)
        return this.settleBegin(session, new Error('Signer manager is closed'))
      }

      let challenge
      let expected = []
      let verificationKey
      try {
        challenge = kind === 'phrase' ? this.phraseChallenge() : 'private-key'
        verificationKey = readSecureBytes(32, this.randomBytes)
        if (kind === 'phrase') {
          challenge.forEach((position) => {
            expected.push(
              this.digest(verificationKey, `word-${position}`, normalizeWord(secret.split(' ')[position - 1]))
            )
          })
        } else {
          expected.push(this.digest(verificationKey, 'private-key', normalizePrivateKey(secret)))
        }
      } catch (sessionError) {
        verificationKey?.fill(0)
        expected.forEach((value) => value.fill(0))
        this.finish(id)
        this.cleanupSigner(signer)
        return this.settleBegin(session, sessionError)
      }

      if (this.sessions.get(id) !== session || session.state !== 'staging') {
        verificationKey.fill(0)
        expected.forEach((value) => value.fill(0))
        this.cleanupSigner(signer)
        return
      }
      let activeTimer
      let expiresAt
      try {
        try {
          this.clearTimeout(session.timer)
        } catch {
          // The stale timer is guarded below and cannot discard the active session.
        }
        expiresAt = this.now() + this.sessionTtlMs
        activeTimer = this.setTimeout(() => {
          if (this.sessions.get(id)?.timer === activeTimer) this.discard(id, () => {})
        }, this.sessionTtlMs)
        activeTimer.unref?.()
      } catch (timerError) {
        if (activeTimer) {
          try {
            this.clearTimeout(activeTimer)
          } catch {
            // The session is being removed regardless of timer cleanup.
          }
        }
        verificationKey.fill(0)
        expected.forEach((value) => value.fill(0))
        this.finish(id)
        this.cleanupSigner(signer)
        return this.settleBegin(session, timerError)
      }
      Object.assign(session, {
        challenge,
        expected,
        expiresAt,
        kind,
        signer,
        state: 'active',
        timer: activeTimer,
        verificationKey
      })
      this.settleBegin(session, null, {
        address: signer.addresses[0],
        challenge: kind === 'phrase' ? [...challenge] : challenge,
        expiresAt,
        kind,
        secret,
        sessionId: id
      })
    }

    try {
      const staged = stage(this.signers, secret, password, handleStage)
      if (this.sessions.get(id) === session && session.state === 'staging' && staged?.signer) {
        session.cancelStage = staged.cancel
        session.stagedSigner = staged.signer
        session.stageOwnsCleanup = typeof staged.cancel === 'function'
      }
    } catch (error) {
      if (callbackReceived) throw error
      callbackReceived = true
      if (this.sessions.get(id) === session) this.finish(id)
      this.settleBegin(session, error)
    }
  }

  verify(session, proof) {
    const values =
      session.kind === 'phrase'
        ? Array.isArray(proof?.words)
          ? proof.words.map(normalizeWord)
          : []
        : [normalizePrivateKey(proof?.privateKey)]
    if (values.length !== session.expected.length || values.some((value) => !value)) return false
    return values.every((value, index) => {
      const kind = session.kind === 'phrase' ? `word-${session.challenge[index]}` : 'private-key'
      const actual = this.digest(session.verificationKey, kind, value)
      try {
        return crypto.timingSafeEqual(actual, session.expected[index])
      } finally {
        actual.fill(0)
      }
    })
  }

  complete(id, proof, cb) {
    const session = this.sessions.get(id)
    if (!session || session.state !== 'active') return cb(new Error(SESSION_UNAVAILABLE_ERROR))
    if (this.now() >= session.expiresAt) {
      return this.discard(id, (error) => {
        if (error) this.report(error)
        cb(new Error(SESSION_UNAVAILABLE_ERROR))
      })
    }
    if (!this.verify(session, proof)) return cb(new Error(BACKUP_MISMATCH_ERROR))
    if (this.signers.exists?.(session.signer.id)) {
      return this.discard(id, () => cb(new Error('This account already exists')))
    }

    const result = {
      address: session.signer.addresses[0],
      id: session.signer.id,
      type: session.signer.type
    }
    try {
      session.signer.commitStaged()
      if (this.signers.add(session.signer) === false) throw new Error('Signer manager is closed')
    } catch (error) {
      let rollbackFailed = false
      try {
        session.signer.delete()
      } catch {
        rollbackFailed = true
      }
      try {
        let discardError
        this.discard(id, (cleanupError) => {
          discardError = cleanupError
        })
        if (discardError) rollbackFailed = true
      } catch {
        rollbackFailed = true
      }
      return cb(rollbackFailed ? new Error(PARTIAL_ROLLBACK_ERROR) : error)
    }

    this.finish(id)
    cb(null, result)
  }

  finish(id) {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    try {
      this.clearTimeout(session.timer)
    } catch {
      // The session is already unavailable; continue wiping verification material.
    }
    session.verificationKey?.fill(0)
    session.expected?.forEach((value) => value.fill(0))
  }

  discard(id, cb) {
    const session = this.sessions.get(id)
    if (!session) return cb(null)
    this.finish(id)
    if (session.state === 'staging') {
      session.stageCancelled = true
      let cleanupError
      try {
        if (session.cancelStage) session.cancelStage()
        else if (session.stagedSigner) cleanupError = this.cleanupSigner(session.stagedSigner)
      } catch (error) {
        cleanupError = error
      }
      this.settleBegin(session, new Error(SESSION_UNAVAILABLE_ERROR))
      return cb(cleanupError || null)
    }
    if (!session.signer) return cb(null)
    const cleanupError = this.cleanupSigner(session.signer)
    cb(cleanupError || null)
  }

  close() {
    if (this.closed) return
    this.closed = true
    ;[...this.sessions.keys()].forEach((id) => this.discard(id, () => {}))
  }
}

module.exports = {
  BACKUP_MISMATCH_ERROR,
  GeneratedWalletSessions,
  MAX_SESSIONS,
  PARTIAL_ROLLBACK_ERROR,
  PHRASE_CHALLENGE_SIZE,
  SESSION_TTL_MS,
  STAGING_TTL_MS,
  SESSION_UNAVAILABLE_ERROR
}
