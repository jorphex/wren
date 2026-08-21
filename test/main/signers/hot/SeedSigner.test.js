jest.mock('bip39', () => ({
  mnemonicToSeed: jest.fn(),
  validateMnemonic: jest.fn(() => true)
}))

jest.mock(
  '../../../../main/signers/hot/HotSigner',
  () =>
    class HotSigner {
      constructor() {}
    }
)

const bip39 = require('bip39')
const SeedSigner = require('../../../../main/signers/hot/SeedSigner')

test('reports a rejected mnemonic seed derivation through addPhrase callback', async () => {
  const rejection = new Error('seed derivation failed')
  bip39.mnemonicToSeed.mockRejectedValueOnce(rejection)
  const signer = new SeedSigner()
  signer.addSeed = jest.fn()
  const callback = jest.fn()
  await new Promise((resolve) => {
    callback.mockImplementation(resolve)
    signer.addPhrase('test test test test test test test test test test test junk', 'password', callback)
  })

  expect(callback).toHaveBeenCalledWith(rejection)
  expect(signer.addSeed).not.toHaveBeenCalled()
})

test('wipes the mnemonic seed buffer after passing its derived hex to addSeed', async () => {
  const seed = Buffer.from('0123456789abcdef', 'hex')
  bip39.mnemonicToSeed.mockResolvedValueOnce(seed)
  const signer = new SeedSigner()
  signer.addSeed = jest.fn((hex, password, cb) => cb(null))

  await new Promise((resolve) =>
    signer.addPhrase('test test test test test test test test test test test junk', 'password', resolve)
  )

  expect(signer.addSeed).toHaveBeenCalledWith('0123456789abcdef', 'password', expect.any(Function))
  expect(seed.equals(Buffer.alloc(seed.length))).toBe(true)
})
