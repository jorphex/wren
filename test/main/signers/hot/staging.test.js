import fs from 'fs'
import path from 'path'
import { remove } from 'fs-extra'
import log from 'electron-log'

const PASSWORD = 'correct horse battery staple'
const PHRASE = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = `0x${'1'.padStart(64, '0')}`
const SIGNER_PATH = path.resolve(__dirname, '../.userData/signers')

jest.mock('electron')
jest.mock('../../../../main/store/persist')

const waitForCallback = (action) =>
  new Promise((resolve, reject) => action((error, result) => (error ? reject(error) : resolve(result))))

describe('staged hot signers', () => {
  let hot
  const pending = new Set()
  const signers = {
    trackHotSigner: (signer) => {
      pending.add(signer)
      return true
    },
    untrackHotSigner: (signer) => pending.delete(signer)
  }

  beforeAll(async () => {
    log.transports.console.level = false
    await remove(SIGNER_PATH)
    hot = await import('../../../../main/signers/hot')
  })

  afterAll(async () => {
    pending.forEach((signer) => signer.close())
    await remove(SIGNER_PATH)
    log.transports.console.level = 'debug'
  })

  test('encrypts and locks a phrase without persisting before commit', async () => {
    const signer = await waitForCallback((cb) => hot.stageFromPhrase(signers, PHRASE, PASSWORD, cb))
    const signerFile = path.join(SIGNER_PATH, `${signer.id}.json`)

    expect(signer.status).toBe('locked')
    expect(signer.encryptedSeed).toMatchObject({ version: 2, cipher: { name: 'aes-256-gcm' } })
    expect(fs.existsSync(signerFile)).toBe(false)

    signer.commitStaged()
    const stored = fs.readFileSync(signerFile, 'utf8')
    expect(stored).not.toContain(PHRASE)
    expect(JSON.parse(stored).encryptedSeed).toEqual(signer.encryptedSeed)
    pending.delete(signer)
    signer.close()
  }, 10_000)

  test('destroys an abandoned private-key signer without creating a file', async () => {
    const signer = await waitForCallback((cb) => hot.stageFromPrivateKey(signers, PRIVATE_KEY, PASSWORD, cb))
    const signerFile = path.join(SIGNER_PATH, `${signer.id}.json`)

    expect(signer.status).toBe('locked')
    expect(signer.encryptedKeys).toMatchObject({ version: 2, cipher: { name: 'aes-256-gcm' } })
    expect(fs.existsSync(signerFile)).toBe(false)
    signer.close()
    pending.delete(signer)
    expect(fs.existsSync(signerFile)).toBe(false)
  }, 10_000)
})
