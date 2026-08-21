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
  id: `${kind}-signer`
})

const { GeneratedWalletSessions } = require('../../../main/signers/generated')
const hot = require('../../../main/signers/hot')

const setup = () => {
  let counter = 0
  const randomBytes = jest.fn((length) => Buffer.alloc(length, ++counter))
  const signers = {
    add: jest.fn(() => true),
    exists: jest.fn(() => false),
    untrackHotSigner: jest.fn()
  }
  const sessions = new GeneratedWalletSessions(signers, { randomBytes })
  return { randomBytes, sessions, signers }
}

const begin = (sessions, kind) =>
  new Promise((resolve, reject) =>
    sessions.begin(kind, PASSWORD, (error, result) => (error ? reject(error) : resolve(result)))
  )

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
    const { sessions } = setup()
    const presentation = await begin(sessions, 'phrase')

    expect(mockCallOrder.slice(0, 3)).toEqual(['password', 'entropy', 'stage'])
    expect(presentation).toMatchObject({
      address: '0x0000000000000000000000000000000000000001',
      challenge: [2, 6, 10],
      kind: 'phrase',
      secret: PHRASE
    })
    expect(presentation.sessionId).toMatch(/^[0-9a-f]{32}$/)
    expect(mockStagedSigners[0]).toMatchObject({ password: PASSWORD, secret: PHRASE })
    sessions.close()
  })

  test('keeps the signer staged until all requested phrase words match', async () => {
    const { sessions, signers } = setup()
    const presentation = await begin(sessions, 'phrase')
    const signer = mockStagedSigners[0].signer

    const mismatch = await complete(sessions, presentation.sessionId, { words: ['wrong', 'test', 'test'] })
    expect(mismatch.error.message).toBe('Backup confirmation does not match')
    expect(signer.commitStaged).not.toHaveBeenCalled()

    const success = await complete(sessions, presentation.sessionId, { words: ['test', 'test', 'test'] })
    expect(success).toEqual({ error: null, result: { id: 'phrase-signer' } })
    expect(signer.commitStaged).toHaveBeenCalledTimes(1)
    expect(signers.add).toHaveBeenCalledWith(signer)
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

    const result = await new Promise((resolve) =>
      sessions.begin('private-key', PASSWORD, (error, presentation) => resolve({ error, presentation }))
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

  test('rejects an address collision before persistence and leaves the existing signer untouched', async () => {
    const { sessions, signers } = setup()
    signers.exists.mockReturnValue(true)
    const result = await new Promise((resolve) =>
      sessions.begin('private-key', PASSWORD, (error, presentation) => resolve({ error, presentation }))
    )

    expect(result.error.message).toBe('This account already exists')
    expect(result.presentation).toBeUndefined()
    expect(mockStagedSigners[0].signer.commitStaged).not.toHaveBeenCalled()
    expect(mockStagedSigners[0].signer.close).toHaveBeenCalledTimes(1)
    expect(signers.add).not.toHaveBeenCalled()
  })
})
