const crypto = require('crypto')

const hot = require('../hot')
const { privateKeyAccount, readSecureBytes, recoveryPhrase } = require('../hot/generate')

const SESSION_TTL_MS = 10 * 60 * 1000
const MAX_SESSIONS = 4
const PHRASE_CHALLENGE = Object.freeze([2, 6, 10])

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
    this.sessionTtlMs = options.sessionTtlMs || SESSION_TTL_MS
    this.setTimeout = options.setTimeout || setTimeout
    this.clearTimeout = options.clearTimeout || clearTimeout
    this.sessions = new Map()
    this.closed = false
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

  begin(kind, password, cb) {
    if (this.closed) return cb(new Error('Signer manager is closed'))
    if (kind !== 'phrase' && kind !== 'private-key') return cb(new Error('Unknown generated wallet type'))
    if (this.sessions.size >= MAX_SESSIONS) {
      return cb(new Error('Too many wallet creation sessions are active'))
    }
    try {
      hot.validatePassword(password)
    } catch (error) {
      return cb(error)
    }

    let generated
    try {
      generated =
        kind === 'phrase' ? { secret: recoveryPhrase(this.randomBytes) } : privateKeyAccount(this.randomBytes)
    } catch (error) {
      return cb(error)
    }

    const stage = kind === 'phrase' ? hot.stageFromPhrase : hot.stageFromPrivateKey
    const secret = kind === 'phrase' ? generated.secret : generated.privateKey
    stage(this.signers, secret, password, (error, signer) => {
      if (error) return cb(error)
      if (this.signers.exists?.(signer.id)) {
        signer.close()
        this.signers.untrackHotSigner?.(signer)
        return cb(new Error('This account already exists'))
      }
      if (this.closed || this.sessions.size >= MAX_SESSIONS) {
        signer.close()
        this.signers.untrackHotSigner?.(signer)
        return cb(
          new Error(this.closed ? 'Signer manager is closed' : 'Too many wallet creation sessions are active')
        )
      }

      let verificationKey
      let id
      try {
        verificationKey = readSecureBytes(32, this.randomBytes)
        id = this.newSessionId()
      } catch (sessionError) {
        verificationKey?.fill(0)
        signer.close()
        this.signers.untrackHotSigner?.(signer)
        return cb(sessionError)
      }

      const expected =
        kind === 'phrase'
          ? PHRASE_CHALLENGE.map((position) =>
              this.digest(verificationKey, `word-${position}`, normalizeWord(secret.split(' ')[position - 1]))
            )
          : [this.digest(verificationKey, 'private-key', normalizePrivateKey(secret))]
      const timer = this.setTimeout(() => this.discard(id, () => {}), this.sessionTtlMs)
      timer.unref?.()
      this.sessions.set(id, { expected, kind, signer, timer, verificationKey })

      cb(null, {
        address: signer.addresses[0],
        challenge: kind === 'phrase' ? [...PHRASE_CHALLENGE] : 'private-key',
        kind,
        secret,
        sessionId: id
      })
    })
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
      const kind = session.kind === 'phrase' ? `word-${PHRASE_CHALLENGE[index]}` : 'private-key'
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
    if (!session) return cb(new Error('Wallet creation session is no longer available'))
    if (!this.verify(session, proof)) return cb(new Error('Backup confirmation does not match'))
    if (this.signers.exists?.(session.signer.id)) {
      return this.discard(id, () => cb(new Error('This account already exists')))
    }

    try {
      session.signer.commitStaged()
      if (this.signers.add(session.signer) === false) throw new Error('Signer manager is closed')
      this.finish(id)
      cb(null, { id: session.signer.id })
    } catch (error) {
      try {
        session.signer.delete()
      } catch {
        // Preserve the commit error.
      }
      this.discard(id, () => cb(error))
    }
  }

  finish(id) {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    this.clearTimeout(session.timer)
    session.verificationKey.fill(0)
    session.expected.forEach((value) => value.fill(0))
  }

  discard(id, cb) {
    const session = this.sessions.get(id)
    if (!session) return cb(null)
    this.finish(id)
    this.signers.untrackHotSigner?.(session.signer)
    session.signer.close()
    cb(null)
  }

  close() {
    if (this.closed) return
    this.closed = true
    ;[...this.sessions.keys()].forEach((id) => this.discard(id, () => {}))
  }
}

module.exports = { GeneratedWalletSessions, MAX_SESSIONS, PHRASE_CHALLENGE, SESSION_TTL_MS }
