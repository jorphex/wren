const PASSWORD = 'correct horse battery staple'
const PHRASE = 'test test test test test test test test test test test junk'
const MOCK_PRIVATE_KEY = `0x${'1'.padStart(64, '0')}`

const mockStagedSigners = []
const mockCallOrder = []

jest.mock('../../../main/signers/hot', () => ({
  validatePassword: jest.fn(() => mockCallOrder.push('password')),
  stageFromPhrase: jest.fn((signers, secret, password, cb) => {
    mockCallOrder.push('stage')
    const signer = mockMakeSigner('phrase')
    mockStagedSigners.push({ password, secret, signer })
    cb(null, signer)
  }),
  stageFromPrivateKey: jest.fn((signers, secret, password, cb) => {
    mockCallOrder.push('stage')
    const signer = mockMakeSigner('private-key')
    mockStagedSigners.push({ password, secret, signer })
    cb(null, signer)
  })
}))

jest.mock('../../../main/signers/hot/generate', () => ({
  recoveryPhrase: jest.fn(() => {
    mockCallOrder.push('entropy')
    return PHRASE
  }),
  privateKeyAccount: jest.fn(() => {
    mockCallOrder.push('entropy')
    return { address: '0x0000000000000000000000000000000000000001', privateKey: MOCK_PRIVATE_KEY }
  }),
  readSecureBytes: jest.fn((length, randomBytes) => randomBytes(length))
}))

const mockMakeSigner = (kind) => ({
  addresses: ['0x0000000000000000000000000000000000000001'],
  close: jest.fn(),
  commitStaged: jest.fn(),
  delete: jest.fn(),
  id: `${kind}-signer`,
  type: kind === 'phrase' ? 'seed' : 'ring'
})

const {
  BACKUP_MISMATCH_ERROR,
  GeneratedWalletSessions,
  MAX_SESSIONS,
  PARTIAL_ROLLBACK_ERROR,
  PHRASE_CHALLENGE_SIZE,
  STAGING_TTL_MS,
  SESSION_UNAVAILABLE_ERROR
} = require('../../../main/signers/generated')
const hot = require('../../../main/signers/hot')

const setup = (options = {}) => {
  let counter = 0
  const randomBytes = jest.fn((length) => Buffer.alloc(length, ++counter))
  const signers = {
    add: jest.fn(() => true),
    exists: jest.fn(() => false),
    untrackHotSigner: jest.fn()
  }
  const sessions = new GeneratedWalletSessions(signers, { randomBytes, ...options })
  return { randomBytes, sessions, signers }
}

const reserve = (sessions) =>
  new Promise((resolve, reject) =>
    sessions.reserve((error, result) => (error ? reject(error) : resolve(result)))
  )

const beginReserved = (sessions, id, kind) =>
  new Promise((resolve, reject) =>
    sessions.begin(id, kind, PASSWORD, (error, result) => (error ? reject(error) : resolve(result)))
  )

const begin = async (sessions, kind) => {
  const { sessionId } = await reserve(sessions)
  return beginReserved(sessions, sessionId, kind)
}

const complete = (sessions, id, proof) =>
  new Promise((resolve) => sessions.complete(id, proof, (error, result) => resolve({ error, result })))

describe('generated wallet sessions', () => {
  beforeEach(() => {
    mockStagedSigners.length = 0
    mockCallOrder.length = 0
    jest.clearAllMocks()
  })

  afterEach(() => jest.useRealTimers())

  test('validates the password before obtaining entropy and returns a one-time phrase challenge', async () => {
    const { randomBytes, sessions } = setup({ now: () => 1_000, sessionTtlMs: 5_000 })
    const presentation = await begin(sessions, 'phrase')

    expect(mockCallOrder.slice(0, 3)).toEqual(['password', 'entropy', 'stage'])
    expect(presentation).toMatchObject({
      address: '0x0000000000000000000000000000000000000001',
      expiresAt: 6_000,
      kind: 'phrase',
      secret: PHRASE
    })
    expect(presentation.challenge).toHaveLength(PHRASE_CHALLENGE_SIZE)
    expect(new Set(presentation.challenge).size).toBe(PHRASE_CHALLENGE_SIZE)
    expect(presentation.challenge).toEqual([...presentation.challenge].sort((a, b) => a - b))
    expect(presentation.challenge.every((position) => position >= 1 && position <= 12)).toBe(true)
    expect(randomBytes).toHaveBeenCalledWith(1)
    expect(presentation.sessionId).toMatch(/^[0-9a-f]{32}$/)
    expect(mockStagedSigners[0]).toMatchObject({ password: PASSWORD, secret: PHRASE })
    sessions.close()
  })

  test('reserves an OS-random session before it obtains wallet entropy', async () => {
    const { randomBytes, sessions } = setup()

    const { sessionId } = await reserve(sessions)

    expect(sessionId).toMatch(/^[0-9a-f]{32}$/)
    expect(randomBytes).toHaveBeenCalledWith(16)
    expect(mockCallOrder).toEqual([])
    expect(STAGING_TTL_MS).toBeLessThanOrEqual(60 * 1000)
    sessions.discard(sessionId, () => {})
  })

  test('contains a synchronous presentation delivery failure and discards the staged signer', () => {
    const onError = jest.fn()
    const { sessions, signers } = setup({ onError })
    const callbackError = new Error('renderer disappeared')
    const callback = jest.fn(() => {
      throw callbackError
    })

    let id
    sessions.reserve((error, result) => {
      expect(error).toBeNull()
      id = result.sessionId
    })
    expect(() => sessions.begin(id, 'phrase', PASSWORD, callback)).not.toThrow()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(callbackError)
    expect(sessions.sessions.size).toBe(0)
    expect(mockStagedSigners[0].signer.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(mockStagedSigners[0].signer)
  })

  test('contains an asynchronous presentation delivery failure and discards the staged signer', async () => {
    const callbacks = []
    let stagedSigner
    hot.stageFromPhrase.mockImplementationOnce((signers, secret, password, cb) => {
      stagedSigner = mockMakeSigner('phrase')
      callbacks.push(() => cb(null, stagedSigner))
      return { cancel: jest.fn(), signer: stagedSigner }
    })
    const onError = jest.fn()
    const { sessions, signers } = setup({ onError })
    const { sessionId } = await reserve(sessions)
    const callbackError = new Error('renderer disappeared')
    const callback = jest.fn(() => {
      throw callbackError
    })

    sessions.begin(sessionId, 'phrase', PASSWORD, callback)
    expect(() => callbacks[0]()).not.toThrow()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(callbackError)
    expect(sessions.sessions.size).toBe(0)
    expect(stagedSigner.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(stagedSigner)
  })

  test('discards the staged signer when renderer delivery reports failure', async () => {
    const { sessions, signers } = setup()
    const { sessionId } = await reserve(sessions)
    const callback = jest.fn(() => false)

    sessions.begin(sessionId, 'private-key', PASSWORD, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(sessions.sessions.size).toBe(0)
    expect(mockStagedSigners[0].signer.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(mockStagedSigners[0].signer)
  })

  test('releases in-flight capacity when staging throws before its callback', async () => {
    hot.stageFromPhrase.mockImplementationOnce(() => {
      throw new Error('staging unavailable')
    })
    const { sessions } = setup()

    await expect(begin(sessions, 'phrase')).rejects.toThrow('staging unavailable')
    const presentation = await begin(sessions, 'phrase')
    expect(presentation.sessionId).toMatch(/^[0-9a-f]{32}$/)
    sessions.close()
  })

  test('selects phrase verification positions from the injected random source', async () => {
    const { sessions } = setup()
    const first = await begin(sessions, 'phrase')
    const second = await begin(sessions, 'phrase')

    expect(first.challenge).not.toEqual(second.challenge)
    expect(new Set([...first.challenge, ...second.challenge]).size).toBeGreaterThan(PHRASE_CHALLENGE_SIZE)
    sessions.close()
  })

  test('does not admit a reservation when its deadline timer cannot be created', async () => {
    const { sessions } = setup({
      setTimeout: () => {
        throw new Error('timer unavailable')
      }
    })

    await expect(reserve(sessions)).rejects.toThrow('timer unavailable')
    expect(sessions.sessions.size).toBe(0)
  })

  test('rejects an expired reservation before password validation or wallet entropy', async () => {
    let timestamp = 1_000
    const timer = { unref: jest.fn() }
    const setTimeout = jest.fn(() => timer)
    const clearTimeout = jest.fn()
    const { sessions } = setup({
      clearTimeout,
      now: () => timestamp,
      setTimeout,
      stagingTtlMs: 100
    })
    const { sessionId } = await reserve(sessions)

    timestamp = 1_100
    await expect(beginReserved(sessions, sessionId, 'phrase')).rejects.toThrow(SESSION_UNAVAILABLE_ERROR)

    expect(mockCallOrder).toEqual([])
    expect(hot.validatePassword).not.toHaveBeenCalled()
    expect(hot.stageFromPhrase).not.toHaveBeenCalled()
    expect(clearTimeout).toHaveBeenCalledWith(timer)
    expect(sessions.sessions.has(sessionId)).toBe(false)
  })

  test('keeps the signer staged until all requested phrase words match', async () => {
    const { sessions, signers } = setup()
    const presentation = await begin(sessions, 'phrase')
    const signer = mockStagedSigners[0].signer

    const mismatch = await complete(sessions, presentation.sessionId, { words: ['wrong', 'test', 'test'] })
    expect(mismatch.error.message).toBe(BACKUP_MISMATCH_ERROR)
    expect(signer.commitStaged).not.toHaveBeenCalled()

    const success = await complete(sessions, presentation.sessionId, { words: ['test', 'test', 'test'] })
    expect(success).toEqual({
      error: null,
      result: {
        address: '0x0000000000000000000000000000000000000001',
        id: 'phrase-signer',
        type: 'seed'
      }
    })
    expect(signer.commitStaged).toHaveBeenCalledTimes(1)
    expect(signers.add).toHaveBeenCalledWith(signer)
    expect(sessions.sessions.size).toBe(0)
  })

  test('keeps successful admission successful if timer cleanup throws', async () => {
    const { sessions } = setup({
      clearTimeout: () => {
        throw new Error('timer cleanup failed')
      }
    })
    const presentation = await begin(sessions, 'phrase')

    const success = await complete(sessions, presentation.sessionId, { words: ['test', 'test', 'test'] })
    expect(success.error).toBe(null)
    expect(success.result.id).toBe('phrase-signer')
    expect(sessions.sessions.size).toBe(0)
  })

  test('normalizes and verifies the full private key before commit', async () => {
    const { sessions } = setup()
    const presentation = await begin(sessions, 'private-key')

    expect(presentation).toMatchObject({ kind: 'private-key', secret: MOCK_PRIVATE_KEY })
    const success = await complete(sessions, presentation.sessionId, {
      privateKey: MOCK_PRIVATE_KEY.toUpperCase()
    })
    expect(success.error).toBe(null)
    expect(mockStagedSigners[0].signer.commitStaged).toHaveBeenCalledTimes(1)
  })

  test('rejects a private-key signer whose independently derived address does not match', async () => {
    const { sessions, signers } = setup()
    const signer = mockMakeSigner('private-key')
    signer.addresses = ['0x0000000000000000000000000000000000000002']
    hot.stageFromPrivateKey.mockImplementationOnce((manager, secret, password, cb) => cb(null, signer))

    const { sessionId } = await reserve(sessions)
    const result = await new Promise((resolve) =>
      sessions.begin(sessionId, 'private-key', PASSWORD, (error, presentation) =>
        resolve({ error, presentation })
      )
    )

    expect(result.error.message).toBe('Generated private-key address does not match')
    expect(result.presentation).toBeUndefined()
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(signer)
    expect(signers.add).not.toHaveBeenCalled()
  })

  test('discard and expiry destroy an uncommitted signer', async () => {
    jest.useFakeTimers()
    const { sessions, signers } = setup()
    const presentation = await begin(sessions, 'phrase')
    const signer = mockStagedSigners[0].signer

    sessions.discard(presentation.sessionId, () => {})
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(signer)

    const expiring = await begin(sessions, 'private-key')
    const expiringSigner = mockStagedSigners[1].signer
    jest.advanceTimersByTime(10 * 60 * 1000)
    expect(expiringSigner.close).toHaveBeenCalledTimes(1)
    expect(sessions.sessions.has(expiring.sessionId)).toBe(false)
    const expired = await complete(sessions, expiring.sessionId, { privateKey: MOCK_PRIVATE_KEY })
    expect(expired.error.message).toBe(SESSION_UNAVAILABLE_ERROR)
  })

  test('enforces the stored expiry deadline even when its cleanup timer is delayed', async () => {
    let timestamp = 1_000
    const { sessions, signers } = setup({ now: () => timestamp, sessionTtlMs: 5_000 })
    const presentation = await begin(sessions, 'private-key')
    const signer = mockStagedSigners[0].signer

    timestamp = presentation.expiresAt
    const expired = await complete(sessions, presentation.sessionId, { privateKey: MOCK_PRIVATE_KEY })

    expect(expired.error.message).toBe(SESSION_UNAVAILABLE_ERROR)
    expect(expired.result).toBeUndefined()
    expect(signer.commitStaged).not.toHaveBeenCalled()
    expect(signers.add).not.toHaveBeenCalled()
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(signer)
    expect(sessions.sessions.has(presentation.sessionId)).toBe(false)
  })

  test('bounds reservations and releases capacity when staging settles', () => {
    const callbacks = []
    for (let index = 0; index < MAX_SESSIONS; index += 1) {
      hot.stageFromPhrase.mockImplementationOnce((signers, secret, password, cb) => callbacks.push(cb))
    }
    const { sessions } = setup()
    const ids = []

    for (let index = 0; index < MAX_SESSIONS; index += 1) {
      sessions.reserve((error, result) => {
        expect(error).toBeNull()
        ids.push(result.sessionId)
      })
    }
    const limit = jest.fn()
    sessions.reserve(limit)

    ids.forEach((id) => sessions.begin(id, 'phrase', PASSWORD, () => {}))
    expect(callbacks).toHaveLength(MAX_SESSIONS)
    expect(limit.mock.calls[0][0].message).toBe('Too many wallet creation sessions are active')

    callbacks.forEach((cb, index) => cb(null, mockMakeSigner(`phrase-${index}`)))
    expect(sessions.sessions.size).toBe(MAX_SESSIONS)
    sessions.close()
  })

  test('deletes a staged file if manager admission fails after commit', async () => {
    const { sessions, signers } = setup()
    signers.add.mockReturnValue(false)
    const presentation = await begin(sessions, 'private-key')
    const signer = mockStagedSigners[0].signer
    const result = await complete(sessions, presentation.sessionId, { privateKey: MOCK_PRIVATE_KEY })

    expect(result.error.message).toBe('Signer manager is closed')
    expect(signer.delete).toHaveBeenCalledTimes(1)
    expect(signer.close).toHaveBeenCalledTimes(1)
  })

  test('deletes and discards a staged signer if manager admission throws', async () => {
    const { sessions, signers } = setup()
    signers.add.mockImplementation(() => {
      throw new Error('store admission failed')
    })
    const presentation = await begin(sessions, 'private-key')
    const signer = mockStagedSigners[0].signer
    const result = await complete(sessions, presentation.sessionId, { privateKey: MOCK_PRIVATE_KEY })

    expect(result.error.message).toBe('store admission failed')
    expect(signer.delete).toHaveBeenCalledTimes(1)
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(sessions.sessions.size).toBe(0)
  })

  test('reports the existing partial rollback error when persisted cleanup fails', async () => {
    const { sessions, signers } = setup()
    signers.add.mockImplementation(() => {
      throw new Error('store admission failed')
    })
    const presentation = await begin(sessions, 'private-key')
    const signer = mockStagedSigners[0].signer
    signer.delete.mockImplementation(() => {
      throw new Error('delete failed')
    })

    const result = await complete(sessions, presentation.sessionId, { privateKey: MOCK_PRIVATE_KEY })

    expect(result.error.message).toBe(PARTIAL_ROLLBACK_ERROR)
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(sessions.sessions.size).toBe(0)
  })

  test('reports the existing partial rollback error when discard cleanup fails', async () => {
    const { sessions, signers } = setup()
    signers.add.mockImplementation(() => {
      throw new Error('store admission failed')
    })
    const presentation = await begin(sessions, 'private-key')
    const signer = mockStagedSigners[0].signer
    signer.close.mockImplementation(() => {
      throw new Error('close failed')
    })

    const result = await complete(sessions, presentation.sessionId, { privateKey: MOCK_PRIVATE_KEY })

    expect(result.error.message).toBe(PARTIAL_ROLLBACK_ERROR)
    expect(sessions.sessions.size).toBe(0)
  })

  test('cancels staging, releases its reservation, and cleans a late signer callback', async () => {
    const callbacks = []
    const stagedSigner = mockMakeSigner('phrase')
    const cancel = jest.fn()
    hot.stageFromPhrase.mockImplementationOnce((signers, secret, password, cb) => {
      callbacks.push(cb)
      cancel.mockImplementation(() => {
        stagedSigner.close()
        signers.untrackHotSigner(stagedSigner)
      })
      return { cancel, signer: stagedSigner }
    })
    const { sessions, signers } = setup()
    const { sessionId } = await reserve(sessions)
    const presented = jest.fn()

    sessions.begin(sessionId, 'phrase', PASSWORD, presented)
    sessions.discard(sessionId, () => {})
    callbacks[0](null, stagedSigner)

    expect(presented).toHaveBeenCalledTimes(1)
    expect(presented.mock.calls[0][0].message).toBe(SESSION_UNAVAILABLE_ERROR)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stagedSigner.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(stagedSigner)
    expect(sessions.sessions.size).toBe(0)
    await expect(reserve(sessions)).resolves.toMatchObject({ sessionId: expect.any(String) })
  })

  test('times out staging and ignores its late callback', async () => {
    jest.useFakeTimers()
    const callbacks = []
    const stagedSigner = mockMakeSigner('phrase')
    const cancel = jest.fn()
    hot.stageFromPhrase.mockImplementationOnce((signers, secret, password, cb) => {
      callbacks.push(cb)
      cancel.mockImplementation(() => {
        stagedSigner.close()
        signers.untrackHotSigner(stagedSigner)
      })
      return { cancel, signer: stagedSigner }
    })
    const { sessions, signers } = setup({ stagingTtlMs: 100 })
    const { sessionId } = await reserve(sessions)
    const presented = jest.fn()

    sessions.begin(sessionId, 'phrase', PASSWORD, presented)
    jest.advanceTimersByTime(100)
    callbacks[0](null, stagedSigner)

    expect(presented).toHaveBeenCalledTimes(1)
    expect(presented.mock.calls[0][0].message).toBe(SESSION_UNAVAILABLE_ERROR)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stagedSigner.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(stagedSigner)
    expect(sessions.sessions.size).toBe(0)
  })

  test('rejects staging completed after its deadline even when the cleanup timer is delayed', async () => {
    let timestamp = 1_000
    let stageCallback
    const stagedSigner = mockMakeSigner('phrase')
    hot.stageFromPhrase.mockImplementationOnce((signers, secret, password, cb) => {
      stageCallback = cb
      return { cancel: jest.fn(), signer: stagedSigner }
    })
    const timer = { unref: jest.fn() }
    const setTimeout = jest.fn(() => timer)
    const clearTimeout = jest.fn()
    const { sessions, signers } = setup({
      clearTimeout,
      now: () => timestamp,
      setTimeout,
      stagingTtlMs: 100
    })
    const { sessionId } = await reserve(sessions)
    const presented = jest.fn()

    sessions.begin(sessionId, 'phrase', PASSWORD, presented)
    timestamp = 1_100
    stageCallback(null, stagedSigner)

    expect(presented).toHaveBeenCalledTimes(1)
    expect(presented.mock.calls[0][0].message).toBe(SESSION_UNAVAILABLE_ERROR)
    expect(presented.mock.calls[0][1]).toBeUndefined()
    expect(stagedSigner.close).toHaveBeenCalledTimes(1)
    expect(signers.untrackHotSigner).toHaveBeenCalledWith(stagedSigner)
    expect(clearTimeout).toHaveBeenCalledWith(timer)
    expect(sessions.sessions.has(sessionId)).toBe(false)
  })

  test('does not roll back a committed signer when the success callback throws', async () => {
    const { sessions, signers } = setup()
    const presentation = await begin(sessions, 'phrase')
    const signer = mockStagedSigners[0].signer
    const callbackError = new Error('renderer disappeared')

    expect(() =>
      sessions.complete(presentation.sessionId, { words: ['test', 'test', 'test'] }, () => {
        throw callbackError
      })
    ).toThrow(callbackError)

    expect(signers.add).toHaveBeenCalledWith(signer)
    expect(signer.commitStaged).toHaveBeenCalledTimes(1)
    expect(signer.delete).not.toHaveBeenCalled()
    expect(signer.close).not.toHaveBeenCalled()
    expect(sessions.sessions.size).toBe(0)
  }, 1_000)

  test('rejects an address collision before persistence and leaves the existing signer untouched', async () => {
    const { sessions, signers } = setup()
    signers.exists.mockReturnValue(true)
    const { sessionId } = await reserve(sessions)
    const result = await new Promise((resolve) =>
      sessions.begin(sessionId, 'private-key', PASSWORD, (error, presentation) =>
        resolve({ error, presentation })
      )
    )

    expect(result.error.message).toBe('This account already exists')
    expect(result.presentation).toBeUndefined()
    expect(mockStagedSigners[0].signer.commitStaged).not.toHaveBeenCalled()
    expect(mockStagedSigners[0].signer.close).toHaveBeenCalledTimes(1)
    expect(signers.add).not.toHaveBeenCalled()
  })
})
