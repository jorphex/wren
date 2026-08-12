import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { remove } from 'fs-extra'
import { mnemonicToSeedSync } from 'bip39'
import { SignTypedDataVersion } from '@metamask/eth-sig-util'
import log from 'electron-log'

const PASSWORD = 'fr@///3_password'
const PHRASE = 'test test test test test test test test test test test junk'
const SIGNER_PATH = path.resolve(__dirname, '../.userData/signers')
const ADDRESS_HASH = 'a7e66a7d4449b33d6cee47576c58733426bc35f39a0884865e0c8f873a5281cb'
const MESSAGE_SIGNATURES = {
  0: '0xf755d9a72d5b7386765e7f0e833af68795b739a267122dae933f41b781b5aed0626ce3263308ebd4c37bed84319b66da2794368771046825bd89b98ba68c4e871b',
  1: '0x4bbcd833f8fc48eee8a8ead81e5d54f9347a51da179067c80d2932e7ea901e612409666c6816eb693d5b23da422433ef4367b653a8351dbcd5e9b12b58aa61ab1b',
  99: '0x820428668a5079fe8d97f0e27488ddd083e8b6feab532868b8662eeaed3aef8e4461691a8c19c082c2e80b2d69e9a7533f04c39ad55e5109d96bebc477382b5d1b'
}
const TYPED_SIGNATURE =
  '0xfef8e26e62dc18aa6255ef0fbd9ff1122978bae3660954ef2acb14343c5507e12d570c5fdc137b88a760932a94b3e3bb77c7bc262abd43b8cc61b8ba010507a81b'
const TRANSACTION_SIGNATURE =
  '0xf866068609184e72a0008303000094fa3caabc8eefec2b5e2895e5afbf79379e7268a7' +
  '808025a0d89321513e12a3a8918ee6bf1946d6e868acb4579a3251fa3e92fde1a1e91e23' +
  'a01aa93afdcbed8f708122ccae8e00c51adbc5ba74cc625a6a4409239952d21c0e'

const legacyEncrypt = (plaintext, password) => {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 36_000_000 })

  try {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return `${salt.toString('hex')}:${iv.toString('hex')}:${ciphertext.toString('hex')}`
  } finally {
    key.fill(0)
  }
}

const waitForCallback = (action) =>
  new Promise((resolve, reject) => action((error, result) => (error ? reject(error) : resolve(result))))

jest.mock('electron')
jest.mock('../../../../../main/store/persist')

// Stubs
const signers = { add: () => {} }
// Util
const clean = () => remove(SIGNER_PATH)

let hot, store

describe('Seed signer', () => {
  let signer
  let seed

  beforeAll(async () => {
    log.transports.console.level = false

    clean()

    hot = await import('../../../../../main/signers/hot')
    store = require('../../../../../main/store').default
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  afterAll(() => {
    clean()
    if (signer.status !== 'locked') {
      signer.close()
    }
    log.transports.console.level = 'debug'
  })

  test('Create from invalid phrase', (done) => {
    const mnemonic = 'invalid mnemonic'

    try {
      hot.createFromPhrase(signers, mnemonic, PASSWORD, (err) => {
        expect(err).toBeTruthy()
        expect(store('main.signers')).toEqual({})
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 1000)

  test('Create from phrase', (done) => {
    try {
      const mnemonic = PHRASE
      seed = mnemonicToSeedSync(mnemonic).toString('hex')
      hot.createFromPhrase(signers, mnemonic, PASSWORD, (err, result) => {
        signer = result
        expect(err).toBe(null)
        expect(signer.status).toBe('ok')
        expect(signer.addresses.length).toBe(100)
        expect(crypto.createHash('sha256').update(signer.addresses.join('\n')).digest('hex')).toBe(
          ADDRESS_HASH
        )
        expect([signer.addresses[0], signer.addresses[1], signer.addresses[99]]).toEqual([
          '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          '0x98D08079928FcCB30598c6C6382ABfd7dbFaA1cD'
        ])
        expect(store(`main.signers.${signer.id}.id`)).toBe(signer.id)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 7_500)

  test('Creates an authenticated encrypted-seed envelope', () => {
    expect(signer.encryptedSeed).toMatchObject({
      version: 2,
      kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32 },
      cipher: { name: 'aes-256-gcm' }
    })

    const stored = JSON.parse(fs.readFileSync(path.resolve(SIGNER_PATH, `${signer.id}.json`), 'utf8'))
    expect(stored.encryptedSeed).toEqual(signer.encryptedSeed)
  })

  test('Migrates a verified legacy seed after unlock', async () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    const legacyEncryptedSeed = legacyEncrypt(seed, PASSWORD)

    signer.encryptedSeed = legacyEncryptedSeed
    signer.save()
    const legacyFile = fs.readFileSync(signerPath, 'utf8')
    await waitForCallback((cb) => signer.lock(cb))
    await waitForCallback((cb) => signer.unlock(PASSWORD, cb))

    const stored = JSON.parse(fs.readFileSync(signerPath, 'utf8'))
    expect(signer.status).toBe('ok')
    expect(signer.encryptedSeed).toMatchObject({ version: 2, cipher: { name: 'aes-256-gcm' } })
    expect(stored.encryptedSeed).toEqual(signer.encryptedSeed)
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(legacyFile)
  }, 3_000)

  test('Preserves the recovery copy when authenticated-envelope unlock fails', async () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    const activeFile = fs.readFileSync(signerPath, 'utf8')
    const recoveryFile = fs.readFileSync(backupPath, 'utf8')

    await waitForCallback((cb) => signer.lock(cb))
    const error = await new Promise((resolve) => signer.unlock('Wrong password', resolve))

    expect(error.message).toBe('Invalid password')
    expect(signer.status).toBe('locked')
    expect(fs.readFileSync(signerPath, 'utf8')).toBe(activeFile)
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(recoveryFile)
  })

  test('Lock', (done) => {
    try {
      signer.lock((err) => {
        expect(err).toBe(null)
        expect(signer.status).toBe('locked')
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 2000)

  test('Retires the legacy recovery copy after a subsequent verified authenticated unlock', async () => {
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    expect(fs.existsSync(backupPath)).toBe(true)

    await waitForCallback((cb) => signer.unlock(PASSWORD, cb))

    expect(fs.existsSync(backupPath)).toBe(false)
    await waitForCallback((cb) => signer.lock(cb))
  })

  test('Scan for signers', (done) => {
    jest.useFakeTimers()

    let count = 0
    const signers = {
      add: (signer) => {
        signer.close(() => {})
        if (signer.type === 'seed') count++
        expect(signer.encryptedSeed).toMatchObject({ version: 2 })
        expect(count).toBe(1)
        done()
      },
      exists: () => false
    }

    hot.scan(signers)

    jest.runAllTimers()
  }, 800)

  test('Unlock with wrong password', (done) => {
    try {
      signer.unlock('Wrong password', (err) => {
        expect(err).toBeTruthy()
        expect(signer.status).toBe('locked')
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 2000)

  test('Unlock', (done) => {
    try {
      signer.unlock(PASSWORD, (err) => {
        expect(err).toBe(null)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 500)

  test('Sign message with frozen private derivation indices', async () => {
    const message = '0x' + Buffer.from('test').toString('hex')

    for (const index of [0, 1, 99]) {
      const signature = await waitForCallback((cb) => signer.signMessage(index, message, cb))
      expect(signature).toBe(MESSAGE_SIGNATURES[index])
    }
  }, 500)

  test('Sign typed data', (done) => {
    const typedMessage = {
      version: SignTypedDataVersion.V4,
      data: {
        types: {
          EIP712Domain: [],
          Mail: [{ name: 'contents', type: 'string' }]
        },
        primaryType: 'Mail',
        domain: {},
        message: { contents: 'hello' }
      }
    }

    signer.signTypedData(0, typedMessage, (err, result) => {
      expect(err).toBe(null)
      expect(result).toBe(TYPED_SIGNATURE)
      done()
    })
  }, 500)

  test('Sign transaction', (done) => {
    const rawTx = {
      nonce: '0x6',
      gasPrice: '0x09184e72a000',
      gasLimit: '0x30000',
      to: '0xfa3caabc8eefec2b5e2895e5afbf79379e7268a7',
      value: '0x0',
      chainId: '0x1'
    }

    try {
      signer.signTransaction(0, rawTx, (err, result) => {
        expect(err).toBe(null)
        expect(result).toBe(TRANSACTION_SIGNATURE)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 500)

  test('Verify address', (done) => {
    try {
      signer.verifyAddress(0, signer.addresses[0], false, (err, result) => {
        expect(err).toBe(null)
        expect(result).toBe(true)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 500)

  test('Verify wrong address', (done) => {
    try {
      signer.verifyAddress(0, '0xabcdef', false, (err, result) => {
        expect(err.message).toBe('Unable to verify address')
        expect(result).toBe(undefined)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 500)

  test('Sign message when locked', (done) => {
    try {
      signer.signMessage(0, 'test', (err) => {
        expect(err.message).toBe('Signer locked')
        done()
      })
    } catch (e) {
      done(e)
    }
  })

  test('Close signer', (done) => {
    try {
      signer.close()
      expect(store(`main.signers.${signer.id}`)).toBe(undefined)
      done()
    } catch (e) {
      done(e)
    }
  })
})
