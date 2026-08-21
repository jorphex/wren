let phraseDone

jest.mock('zxcvbn', () => () => ({ score: 4 }))
jest.mock('../../../../main/signers/hot/runtimeStorage', () => ({ osSignerStorage: {} }))
jest.mock('../../../../main/signers/hot/SeedSigner', () =>
  jest.fn(function SeedSigner() {
    this.addPhrase = jest.fn((phrase, password, cb) => {
      phraseDone = cb
    })
    this.close = jest.fn()
    this.lock = jest.fn()
  })
)
jest.mock('../../../../main/signers/hot/RingSigner', () =>
  jest.fn(function RingSigner() {
    this.addPrivateKey = jest.fn()
    this.close = jest.fn()
    this.lock = jest.fn()
  })
)

const SeedSigner = require('../../../../main/signers/hot/SeedSigner')
const RingSigner = require('../../../../main/signers/hot/RingSigner')
const hot = require('../../../../main/signers/hot')

beforeEach(() => {
  phraseDone = undefined
  jest.clearAllMocks()
})

test('exposes and immediately cancels a phrase signer while its worker callback is pending', () => {
  const signers = {
    trackHotSigner: jest.fn(() => true),
    untrackHotSigner: jest.fn()
  }
  const cb = jest.fn()
  const staged = hot.stageFromPhrase(signers, 'test phrase', 'correct horse battery staple', cb)
  const signer = SeedSigner.mock.instances[0]

  expect(staged).toEqual({ cancel: expect.any(Function), signer })
  staged.cancel()

  expect(signer.close).toHaveBeenCalledTimes(1)
  expect(signers.untrackHotSigner).toHaveBeenCalledWith(signer)
  phraseDone(null)
  expect(signer.lock).not.toHaveBeenCalled()
  expect(cb).not.toHaveBeenCalled()
})

test('exposes a synchronous cancellation handle for a private-key signer', () => {
  const signers = { trackHotSigner: jest.fn(() => true), untrackHotSigner: jest.fn() }
  const staged = hot.stageFromPrivateKey(
    signers,
    `0x${'1'.padStart(64, '0')}`,
    'correct horse battery staple',
    jest.fn()
  )
  const signer = RingSigner.mock.instances[0]

  expect(staged).toEqual({ cancel: expect.any(Function), signer })
})

test('does not swallow a synchronous caller callback failure after staging succeeds', () => {
  const callbackError = new Error('renderer disappeared')
  const signers = { trackHotSigner: jest.fn(() => true), untrackHotSigner: jest.fn() }
  SeedSigner.mockImplementationOnce(function SynchronousSeedSigner() {
    this.addPhrase = jest.fn((phrase, password, cb) => cb(null))
    this.close = jest.fn()
    this.lock = jest.fn((cb) => cb(null))
  })

  expect(() =>
    hot.stageFromPhrase(signers, 'test phrase', 'correct horse battery staple', () => {
      throw callbackError
    })
  ).toThrow(callbackError)
})
