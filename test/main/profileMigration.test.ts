import fs from 'fs'
import os from 'os'
import path from 'path'

import { importFrameProfile, runRequestedProfileMigration } from '../../main/profileMigration'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-profile-import-'))
  roots.push(appDataPath)
  const source = path.join(appDataPath, 'frame')
  const target = path.join(appDataPath, 'wren')
  fs.mkdirSync(path.join(source, 'signers'), { recursive: true })
  fs.writeFileSync(path.join(source, 'config.json'), '{"main":{"__":{"51":{"accounts":{}}}}}\n')
  fs.writeFileSync(
    path.join(source, 'signers', 'signer.json'),
    '{"id":"signer","encryptedSeed":{"ciphertext":"test-only"}}'
  )
  fs.writeFileSync(
    path.join(source, 'signers', 'signer.legacy-v1.bak'),
    '{"id":"signer","encryptedSeed":"legacy-test-only"}'
  )
  return { appDataPath, source, target }
}

test('does nothing unless the explicit import flag is present', () => {
  const { appDataPath, source, target } = fixture()

  expect(
    runRequestedProfileMigration({
      appDataPath,
      argv: ['electron', `--import-frame-profile-from=${source}`],
      userDataPath: target
    })
  ).toEqual({ status: 'not-requested' })
  expect(fs.existsSync(target)).toBe(false)
})

test('imports the standard Frame profile when no source override is provided', () => {
  const { appDataPath, target } = fixture()

  expect(
    runRequestedProfileMigration({
      appDataPath,
      argv: ['electron', '--import-frame-profile'],
      userDataPath: target
    })
  ).toMatchObject({ status: 'imported' })
  expect(fs.existsSync(path.join(target, 'config.json'))).toBe(true)
})

test('atomically copies only wallet state and encrypted signer files', () => {
  const { appDataPath, source, target } = fixture()
  fs.mkdirSync(path.join(source, 'DappCache'))
  fs.writeFileSync(path.join(source, 'DappCache', 'ignored'), 'not wallet state')

  const result = runRequestedProfileMigration({
    appDataPath,
    argv: ['electron', '--import-frame-profile', `--import-frame-profile-from=${source}`],
    userDataPath: target
  })

  expect(result).toEqual({
    status: 'imported',
    files: ['config.json', 'signers/signer.json', 'signers/signer.legacy-v1.bak']
  })
  expect(fs.readFileSync(path.join(target, 'config.json'), 'utf8')).toContain('accounts')
  expect(fs.readFileSync(path.join(target, 'signers', 'signer.json'), 'utf8')).toContain('test-only')
  expect(fs.existsSync(path.join(target, 'DappCache'))).toBe(false)
  expect(fs.existsSync(path.join(source, 'config.json'))).toBe(true)
  expect(fs.existsSync(path.join(source, 'signers', 'signer.json'))).toBe(true)
  const receipt = JSON.parse(fs.readFileSync(path.join(target, 'frame-profile-import.json'), 'utf8'))
  expect(receipt).toMatchObject({ schemaVersion: 1, sourceProfile: 'frame', files: result.files })
  expect(receipt.importedAt).toEqual(expect.any(String))
  if (process.platform !== 'win32') {
    expect(fs.statSync(target).mode & 0o777).toBe(0o700)
    expect(fs.statSync(path.join(target, 'config.json')).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.join(target, 'signers', 'signer.json')).mode & 0o777).toBe(0o600)
  }
})

test('refuses to overwrite an existing Wren profile', () => {
  const { appDataPath, target } = fixture()
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'keep'), 'existing')

  expect(() => importFrameProfile(path.join(appDataPath, 'frame'), target)).toThrow(
    'A Wren profile already exists; import is available only before first launch'
  )
  expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('existing')
})

test('treats a broken Wren profile symlink as an existing destination', () => {
  const { appDataPath, target } = fixture()
  fs.symlinkSync('missing-profile', target)

  expect(() => importFrameProfile(path.join(appDataPath, 'frame'), target)).toThrow(
    'A Wren profile already exists; import is available only before first launch'
  )
  expect(fs.lstatSync(target).isSymbolicLink()).toBe(true)
})

test('requires Frame to be closed and leaves both profiles untouched', () => {
  const { source, target } = fixture()
  fs.symlinkSync('locked', path.join(source, 'SingletonLock'))

  expect(() => importFrameProfile(source, target)).toThrow(
    'Close Frame before importing its profile, then try again'
  )
  expect(fs.existsSync(target)).toBe(false)
  expect(fs.existsSync(path.join(source, 'config.json'))).toBe(true)
})

test('removes staging data when validation fails', () => {
  const { appDataPath, source, target } = fixture()
  fs.writeFileSync(path.join(source, 'config.json'), 'not json')

  expect(() => importFrameProfile(source, target)).toThrow('Frame configuration is not valid JSON')
  expect(fs.existsSync(target)).toBe(false)
  expect(fs.readdirSync(appDataPath).filter((entry) => entry.startsWith('.wren-import-'))).toEqual([])
  expect(fs.readFileSync(path.join(source, 'config.json'), 'utf8')).toBe('not json')
})

test('rejects signer symlinks without creating a partial Wren profile', () => {
  const { source, target } = fixture()
  fs.symlinkSync('signer.json', path.join(source, 'signers', 'linked.json'))

  expect(() => importFrameProfile(source, target)).toThrow('Frame signer file is not regular: linked.json')
  expect(fs.existsSync(target)).toBe(false)
})

test('rejects a configuration symlink without creating a partial Wren profile', () => {
  const { source, target } = fixture()
  fs.renameSync(path.join(source, 'config.json'), path.join(source, 'config-target.json'))
  fs.symlinkSync('config-target.json', path.join(source, 'config.json'))

  expect(() => importFrameProfile(source, target)).toThrow('Frame configuration is not a regular file')
  expect(fs.existsSync(target)).toBe(false)
})

test('rejects relative, empty, and nested import paths', () => {
  const { appDataPath, source } = fixture()

  expect(() =>
    runRequestedProfileMigration({
      appDataPath,
      argv: ['electron', '--import-frame-profile', '--import-frame-profile-from=relative'],
      userDataPath: path.join(appDataPath, 'wren')
    })
  ).toThrow('Frame profile import source must be an absolute path')
  expect(() =>
    runRequestedProfileMigration({
      appDataPath,
      argv: ['electron', '--import-frame-profile', '--import-frame-profile-from='],
      userDataPath: path.join(appDataPath, 'wren')
    })
  ).toThrow('Frame profile import source cannot be empty')
  expect(() => importFrameProfile(source, path.join(source, 'wren'))).toThrow(
    'Frame and Wren profile paths must be different'
  )
})
