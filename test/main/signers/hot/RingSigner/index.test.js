import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { remove } from 'fs-extra'
import log from 'electron-log'

const PASSWORD = 'correct horse battery staple'
const PASSWORD_OPTIONS = { allowWeakPassword: false }
const SIGNER_PATH = path.resolve(__dirname, '../.userData/signers')
const FILE_PATH = path.resolve(__dirname, 'keystore.json')
const V1_FILE_PATH = path.resolve(__dirname, 'keystore-v1.json')

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
const signers = { add: (signer) => store.updateSigner(signer.summary()) }
// Util
const clean = () => remove(SIGNER_PATH)

let hot, store

describe('Ring signer', () => {
  let signer
  let privateKey

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

  test('Create from invalid private key', (done) => {
    const privateKey = 'invalid key'

    try {
      hot.createFromPrivateKey(signers, privateKey, PASSWORD, PASSWORD_OPTIONS, (err) => {
        expect(err).toBeTruthy()
        expect(store('main.signers')).toEqual({})
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 1000)

  test('Create from invalid keystore key', (done) => {
    const keystore = { invalid: 'keystore' }

    try {
      hot.createFromKeystore(signers, keystore, 'test', PASSWORD, PASSWORD_OPTIONS, (err) => {
        expect(err).toBeTruthy()
        expect(store('main.signers')).toEqual({})
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 2000)

  test('Create from private key', (done) => {
    try {
      privateKey = crypto.randomBytes(32).toString('hex')
      hot.createFromPrivateKey(signers, `0x${privateKey}`, PASSWORD, PASSWORD_OPTIONS, (err, result) => {
        signer = result

        expect(err).toBe(null)
        expect(signer.status).toBe('ok')
        expect(signer.id).not.toBe(undefined)
        expect(store(`main.signers.${signer.id}.id`)).toBe(signer.id)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 7_500)

  test('Creates an authenticated encrypted-key envelope', () => {
    expect(signer.encryptedKeys).toMatchObject({
      version: 2,
      kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32 },
      cipher: { name: 'aes-256-gcm' }
    })

    const stored = JSON.parse(fs.readFileSync(path.resolve(SIGNER_PATH, `${signer.id}.json`), 'utf8'))
    expect(stored.encryptedKeys).toEqual(signer.encryptedKeys)
  })

  test('Rejects a legacy keyring that does not match its stored addresses', async () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    const legacyEncryptedKeys = legacyEncrypt(privateKey, PASSWORD)
    const addresses = signer.addresses

    signer.encryptedKeys = legacyEncryptedKeys
    signer.save()
    await waitForCallback((cb) => signer.lock(cb))
    signer.addresses = ['0x0000000000000000000000000000000000000001']
    const error = await new Promise((resolve) => signer.unlock(PASSWORD, resolve))
    signer.addresses = addresses

    expect(error.message).toBe('Invalid password')
    expect(signer.status).toBe('locked')
    expect(JSON.parse(fs.readFileSync(signerPath, 'utf8')).encryptedKeys).toBe(legacyEncryptedKeys)
    expect(fs.existsSync(backupPath)).toBe(false)
  }, 3_000)

  test('Relocks and preserves the legacy signer if atomic migration fails', async () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    const legacyEncryptedKeys = legacyEncrypt(privateKey, PASSWORD)

    signer.encryptedKeys = legacyEncryptedKeys
    signer.save()
    await waitForCallback((cb) => signer.lock(cb))

    const originalFile = fs.readFileSync(signerPath, 'utf8')
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('synthetic rename failure')
    })

    let error
    try {
      error = await new Promise((resolve) => signer.unlock(PASSWORD, resolve))
    } finally {
      rename.mockRestore()
    }

    expect(error.message).toBe('Unable to upgrade signer encryption')
    expect(signer.status).toBe('locked')
    expect(signer.encryptedKeys).toBe(legacyEncryptedKeys)
    expect(fs.readFileSync(signerPath, 'utf8')).toBe(originalFile)
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(originalFile)
    expect(fs.readdirSync(SIGNER_PATH).filter((file) => file.endsWith('.tmp'))).toEqual([])
    if (process.platform !== 'win32') expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600)
  }, 3_000)

  test('Migrates a verified legacy keyring and preserves its first backup', async () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    const originalBackup = fs.readFileSync(backupPath, 'utf8')

    await waitForCallback((cb) => signer.unlock(PASSWORD, cb))

    const stored = JSON.parse(fs.readFileSync(signerPath, 'utf8'))
    expect(signer.status).toBe('ok')
    expect(signer.encryptedKeys).toMatchObject({ version: 2, cipher: { name: 'aes-256-gcm' } })
    expect(stored.encryptedKeys).toEqual(signer.encryptedKeys)
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(originalBackup)
    if (process.platform !== 'win32') expect(fs.statSync(signerPath).mode & 0o777).toBe(0o600)
  }, 3_000)

  test('Scan for signers', (done) => {
    jest.useFakeTimers()

    let count = 0
    const signers = {
      add: (signer) => {
        try {
          signer.close(() => {})
          if (signer.type === 'ring') count++
          expect(signer.encryptedKeys).toMatchObject({ version: 2 })
          expect(count).toBe(1)
          done()
        } catch (e) {
          done(e)
        }
      },
      exists: () => false
    }

    hot.scan(signers)

    jest.runAllTimers()
  }, 800)

  test('Delete preserves the primary signer if legacy-backup erasure fails', () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)
    const open = jest.spyOn(fs, 'openSync').mockImplementationOnce(() => {
      throw new Error('synthetic backup erase failure')
    })

    try {
      expect(() => signer.delete()).toThrow('synthetic backup erase failure')
    } finally {
      open.mockRestore()
    }

    expect(fs.existsSync(signerPath)).toBe(true)
    expect(fs.existsSync(backupPath)).toBe(true)
  })

  test('Delete removes both the current signer and its legacy recovery copy', () => {
    const signerPath = path.resolve(SIGNER_PATH, `${signer.id}.json`)
    const backupPath = path.resolve(SIGNER_PATH, `${signer.id}.legacy-v1.bak`)

    expect(fs.existsSync(signerPath)).toBe(true)
    expect(fs.existsSync(backupPath)).toBe(true)

    signer.delete()

    expect(fs.existsSync(signerPath)).toBe(false)
    expect(fs.existsSync(backupPath)).toBe(false)
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

  test('Create from keystore', (done) => {
    try {
      const file = fs.readFileSync(FILE_PATH, 'utf8')
      const keystore = JSON.parse(file)
      hot.createFromKeystore(signers, keystore, 'test', PASSWORD, PASSWORD_OPTIONS, (err, result) => {
        signer = result
        expect(err).toBe(null)
        expect(signer.status).toBe('ok')
        expect(signer.id).not.toBe(undefined)
        expect(signer.addresses).toEqual(['0xcddfa1bd81f56f4d91eec4f7937714823f51f717'])
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 7_500)

  test('Add private key', (done) => {
    try {
      const privateKey = crypto.randomBytes(32).toString('hex')
      signer.addPrivateKey(privateKey, PASSWORD, (err) => {
        expect(err).toBe(null)
        expect(signer.addresses.length).toBe(2)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 2000)

  test('Remove private key', (done) => {
    try {
      const secondAddress = signer.addresses[1]
      signer.removePrivateKey(0, PASSWORD, (err) => {
        expect(err).toBe(null)
        expect(signer.addresses.length).toBe(1)
        expect(signer.addresses[0]).toEqual(secondAddress)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 2000)

  test('Remove last private key', (done) => {
    try {
      signer.removePrivateKey(0, PASSWORD, (err) => {
        expect(err).toBe(null)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 2000)

  test('Add private key from keystore', (done) => {
    try {
      const file = fs.readFileSync(FILE_PATH, 'utf8')
      const keystore = JSON.parse(file)
      const previousLength = signer.addresses.length

      signer.addKeystore(keystore, 'test', PASSWORD, (err) => {
        expect(err).toBe(null)
        expect(signer.addresses.length).toBe(previousLength + 1)
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 7_500)

  test('Add private key from a legacy V1 keystore', (done) => {
    try {
      const keystore = JSON.parse(fs.readFileSync(V1_FILE_PATH, 'utf8'))
      const previousLength = signer.addresses.length

      signer.addKeystore(keystore, 'test', PASSWORD, (err) => {
        expect(err).toBe(null)
        expect(signer.addresses.length).toBe(previousLength + 1)
        expect(signer.addresses.at(-1)).toBe('0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f')
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 7_500)

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

  test('Unlock with wrong password', (done) => {
    try {
      signer.unlock('Wrong password', (err) => {
        expect(err).toBeTruthy()
        done()
      })
    } catch (e) {
      done(e)
    }
  }, 600)

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

  test('Sign message', (done) => {
    try {
      const message = '0x' + Buffer.from('test').toString('hex')

      signer.signMessage(0, message, (err, result) => {
        expect(err).toBe(null)
        expect(result.length).toBe(132)
        done()
      })
    } catch (e) {
      done(e)
    }
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
        expect(result.length).not.toBe(0)
        expect(result.slice(0, 2)).toBe('0x')
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

  test('Close signer', () => {
    expect(() => signer.close()).not.toThrow()
    expect(signer.status).toBe('locked')
  })
})
