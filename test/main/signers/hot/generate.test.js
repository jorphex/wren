import { entropyToMnemonic } from 'bip39'

const {
  MNEMONIC_ENTROPY_BYTES,
  PRIVATE_KEY_BYTES,
  privateKeyAccount,
  readSecureBytes,
  recoveryPhrase
} = require('../../../../main/signers/hot/generate')

describe('hot signer secret generation', () => {
  test('creates exactly one 12-word phrase from 128 OS-random bits', () => {
    const entropy = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
    const randomBytes = jest.fn(() => Buffer.from(entropy))

    expect(recoveryPhrase(randomBytes)).toBe(entropyToMnemonic(entropy))
    expect(recoveryPhrase(randomBytes).split(' ')).toHaveLength(12)
    expect(randomBytes).toHaveBeenCalledWith(MNEMONIC_ENTROPY_BYTES)
  })

  test('fails closed when the secure source throws or returns the wrong length', () => {
    expect(() => readSecureBytes(16, () => Buffer.alloc(15))).toThrow('invalid entropy')
    expect(() => recoveryPhrase(() => new Uint8Array(0))).toThrow('invalid entropy')
    expect(() =>
      privateKeyAccount(() => {
        throw new Error('rng unavailable')
      })
    ).toThrow('rng unavailable')
  })

  test('rejects invalid scalars instead of reducing them modulo the curve order', () => {
    const invalid = Buffer.alloc(PRIVATE_KEY_BYTES)
    const valid = Buffer.alloc(PRIVATE_KEY_BYTES)
    valid[PRIVATE_KEY_BYTES - 1] = 1
    const randomBytes = jest.fn().mockReturnValueOnce(invalid).mockReturnValueOnce(valid)

    expect(privateKeyAccount(randomBytes)).toEqual({
      address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
      privateKey: `0x${valid.toString('hex')}`
    })
    expect(randomBytes).toHaveBeenNthCalledWith(1, PRIVATE_KEY_BYTES)
    expect(randomBytes).toHaveBeenNthCalledWith(2, PRIVATE_KEY_BYTES)
  })

  test('bounds repeated invalid private-key samples', () => {
    const randomBytes = jest.fn(() => Buffer.alloc(PRIVATE_KEY_BYTES))

    expect(() => privateKeyAccount(randomBytes)).toThrow('could not produce a valid private key')
    expect(randomBytes).toHaveBeenCalledTimes(128)
  })
})
