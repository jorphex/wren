import fs from 'fs'
import path from 'path'
import { remove } from 'fs-extra'
import log from 'electron-log'

const PASSWORD = 'correct horse battery staple'
const PHRASE = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = `0x${'1'.padStart(64, '0')}`
const PASSWORD_OPTIONS = { allowWeakPassword: false }
const SIGNER_PATH = path.resolve(__dirname, '../.userData/signers')

jest.mock('electron')
jest.mock('../../../../main/store/persist')

const { GeneratedWalletSessions } = require('../../../../main/signers/generated')

const waitForCallback = (action) =>
  new Promise((resolve, reject) => action((error, result) => (error ? reject(error) : resolve(result))))

describe('staged hot signers', () => {
  let hot
  const pending = new Set()
  const accepted = new Set()
  const signers = {
    add: (signer) => {
      pending.delete(signer)
      accepted.add(signer)
      return true
    },
    exists: (id) => [...accepted].some((signer) => signer.id === id),
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
    accepted.forEach((signer) => signer.close())
    await remove(SIGNER_PATH)
    log.transports.console.level = 'debug'
  })

  test('encrypts and locks a phrase without persisting before commit', async () => {
    let staged
    const signer = await waitForCallback((cb) => {
      staged = hot.stageFromPhrase(signers, PHRASE, PASSWORD, PASSWORD_OPTIONS, cb)
    })
    const signerFile = path.join(SIGNER_PATH, `${signer.id}.json`)

    expect(staged).toEqual({ cancel: expect.any(Function), signer })
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
    let staged
    const signer = await waitForCallback((cb) => {
      staged = hot.stageFromPrivateKey(signers, PRIVATE_KEY, PASSWORD, PASSWORD_OPTIONS, cb)
    })
    const signerFile = path.join(SIGNER_PATH, `${signer.id}.json`)

    expect(staged).toEqual({ cancel: expect.any(Function), signer })
    expect(signer.status).toBe('locked')
    expect(signer.encryptedKeys).toMatchObject({ version: 2, cipher: { name: 'aes-256-gcm' } })
    expect(fs.existsSync(signerFile)).toBe(false)
    signer.close()
    pending.delete(signer)
    expect(fs.existsSync(signerFile)).toBe(false)
  }, 10_000)

  test('does not persist a direct import rejected by the signer-removal fence', async () => {
    let rejectedSigner
    const rejectingSigners = {
      add: (signer) => {
        rejectedSigner = signer
        throw new Error('Signer removal is still being completed')
      },
      exists: () => false,
      trackHotSigner: () => true,
      untrackHotSigner: jest.fn()
    }

    await expect(
      waitForCallback((cb) =>
        hot.createFromPrivateKey(rejectingSigners, PRIVATE_KEY, PASSWORD, PASSWORD_OPTIONS, cb)
      )
    ).rejects.toThrow('Signer removal is still being completed')

    expect(rejectedSigner).toBeDefined()
    expect(fs.existsSync(path.join(SIGNER_PATH, `${rejectedSigner.id}.json`))).toBe(false)
    expect(rejectingSigners.untrackHotSigner).toHaveBeenCalledWith(rejectedSigner)
  }, 10_000)

  test('detaches an admitted import when protected storage cannot be committed', async () => {
    let rejectedSigner
    const rollbackAdmission = jest.fn((signer) => signer.close())
    const failingSigners = {
      add: (signer) => {
        rejectedSigner = signer
        signer.commitStaged = () => {
          throw new Error('protected storage unavailable')
        }
        return true
      },
      exists: () => false,
      rollbackAdmission,
      trackHotSigner: () => true,
      untrackHotSigner: jest.fn()
    }

    await expect(
      waitForCallback((cb) =>
        hot.createFromPrivateKey(failingSigners, PRIVATE_KEY, PASSWORD, PASSWORD_OPTIONS, cb)
      )
    ).rejects.toThrow('protected storage unavailable')

    expect(rollbackAdmission).toHaveBeenCalledWith(rejectedSigner)
    expect(rejectedSigner._closed).toBe(true)
    expect(fs.existsSync(path.join(SIGNER_PATH, `${rejectedSigner.id}.json`))).toBe(false)
  }, 10_000)

  test('completes a real generated-wallet session into encrypted persisted storage', async () => {
    const sessions = new GeneratedWalletSessions(signers)
    const { sessionId } = await waitForCallback((cb) => sessions.reserve(cb))
    const presentation = await waitForCallback((cb) =>
      sessions.begin(sessionId, 'phrase', PASSWORD, PASSWORD_OPTIONS, cb)
    )
    const words = presentation.secret.split(' ')
    const completed = await waitForCallback((cb) =>
      sessions.complete(
        presentation.sessionId,
        { words: presentation.challenge.map((position) => words[position - 1]) },
        cb
      )
    )
    const signer = [...accepted].find((candidate) => candidate.id === completed.id)
    const signerFile = path.join(SIGNER_PATH, `${completed.id}.json`)

    expect(presentation.secret.split(' ')).toHaveLength(12)
    expect(signer).toBeDefined()
    expect(fs.existsSync(signerFile)).toBe(true)
    const stored = fs.readFileSync(signerFile, 'utf8')
    expect(stored).not.toContain(presentation.secret)
    expect(JSON.parse(stored).encryptedSeed).toMatchObject({
      version: 2,
      cipher: { name: 'aes-256-gcm' }
    })

    signer.delete()
    signer.close()
    accepted.delete(signer)
    sessions.close()
  }, 10_000)
})
