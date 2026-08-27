import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  importFrameProfile,
  migratePersistedConfiguration,
  rollbackImportedProfile,
  runRequestedProfileMigration
} from '../../main/profileMigration'

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
  const migrationFixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'store/migrate/fixtures/v41-current-state.json'), 'utf8')
  ).state
  fs.writeFileSync(
    path.join(source, 'config.json'),
    `${JSON.stringify({ main: { __: { 41: migrationFixture } } })}\n`
  )
  const signer = {
    id: 'signer',
    addresses: ['0x000000000000000000000000000000000000dead'],
    type: 'seed',
    network: 'mainnet',
    encryptedSeed: 'test-only'
  }
  fs.writeFileSync(path.join(source, 'signers', 'signer.json'), JSON.stringify(signer))
  fs.writeFileSync(
    path.join(source, 'signers', 'signer.legacy-v1.bak'),
    JSON.stringify({ ...signer, encryptedSeed: 'legacy-test-only' })
  )
  return { appDataPath, source, target }
}

const legacyMigrationFixture = () =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'store/migrate/fixtures/v3-pre-cross-chain-state.json'), 'utf8')
  ).state

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

  expect(result).toMatchObject({
    status: 'imported',
    files: ['config.json', 'signers/signer.json', 'signers/signer.legacy-v1.bak']
  })
  if (result.status !== 'imported') throw new Error('Expected imported profile')
  expect(result.importId).toEqual(expect.any(String))
  expect(fs.readFileSync(path.join(target, 'config.json'), 'utf8')).toContain('accounts')
  expect(fs.readFileSync(path.join(target, 'signers', 'signer.json'), 'utf8')).toContain('test-only')
  expect(fs.existsSync(path.join(target, 'DappCache'))).toBe(false)
  expect(fs.existsSync(path.join(source, 'config.json'))).toBe(true)
  expect(fs.existsSync(path.join(source, 'signers', 'signer.json'))).toBe(true)
  const receipt = JSON.parse(fs.readFileSync(path.join(target, 'frame-profile-import.json'), 'utf8'))
  expect(receipt).toMatchObject({
    schemaVersion: 1,
    importId: result.importId,
    sourceProfile: 'frame',
    files: result.files
  })
  expect(receipt.importedAt).toEqual(expect.any(String))
  if (process.platform !== 'win32') {
    expect(fs.statSync(target).mode & 0o777).toBe(0o700)
    expect(fs.statSync(path.join(target, 'config.json')).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.join(target, 'signers', 'signer.json')).mode & 0o777).toBe(0o600)
  }
})

test('validates and preserves a version 3 profile for first-start migration', () => {
  const { source, target } = fixture()
  const configuration = { main: { __: { 3: legacyMigrationFixture() } } }
  fs.writeFileSync(path.join(source, 'config.json'), `${JSON.stringify(configuration)}\n`)

  expect(importFrameProfile(source, target)).toMatchObject({ status: 'imported' })
  expect(JSON.parse(fs.readFileSync(path.join(target, 'config.json'), 'utf8'))).toEqual(configuration)
})

test('accepts legacy primary colors while preserving imported wallet state', () => {
  const { source, target } = fixture()
  const configPath = path.join(source, 'config.json')
  const configuration = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const sourceMain = configuration.main.__['41'].main
  const accounts = structuredClone(sourceMain.accounts)
  const signers = structuredClone(sourceMain.signers)
  sourceMain.colorwayPrimary = {
    dark: { background: 'rgb(18, 22, 20)', text: 'rgb(230, 237, 231)' },
    light: { background: 'rgb(250, 250, 250)', text: 'rgb(20, 20, 20)' }
  }
  fs.writeFileSync(configPath, `${JSON.stringify(configuration)}\n`)

  expect(importFrameProfile(source, target)).toMatchObject({ status: 'imported' })

  const migrated = migratePersistedConfiguration(configuration)
  expect(migrated.main.colorwayPrimary).toEqual({
    dark: { background: 'rgb(17, 21, 19)', text: 'rgb(231, 238, 232)' },
    light: { background: 'rgb(17, 21, 19)', text: 'rgb(231, 238, 232)' }
  })
  expect(Object.keys(migrated.main.accounts)).toEqual(Object.keys(accounts))
  expect(migrated.main.accounts).toMatchObject(accounts)
  expect(migrated.main.signers).toEqual(signers)
})

test('rolls back only a profile created by the import flow', () => {
  const { source, target } = fixture()
  const result = importFrameProfile(source, target)
  if (result.status !== 'imported') throw new Error('Expected imported profile')

  expect(rollbackImportedProfile(target, result.importId)).toBe(true)

  expect(fs.existsSync(target)).toBe(false)
  expect(fs.existsSync(path.join(source, 'config.json'))).toBe(true)
  const unrelated = path.join(path.dirname(target), 'unrelated')
  fs.mkdirSync(unrelated)
  fs.writeFileSync(path.join(unrelated, 'keep'), 'keep')
  fs.writeFileSync(
    path.join(unrelated, 'frame-profile-import.json'),
    JSON.stringify({ schemaVersion: 1, importId: 'different-import' })
  )
  expect(rollbackImportedProfile(unrelated, result.importId)).toBe(false)
  expect(fs.readFileSync(path.join(unrelated, 'keep'), 'utf8')).toBe('keep')
})

test('accepts a bounded legacy backup without treating it as an active signer', () => {
  const { source, target } = fixture()
  fs.writeFileSync(path.join(source, 'signers', 'signer.legacy-v1.bak'), '{"legacy":"backup"}')

  expect(importFrameProfile(source, target)).toMatchObject({ status: 'imported' })
  expect(fs.readFileSync(path.join(target, 'signers', 'signer.legacy-v1.bak'), 'utf8')).toBe(
    '{"legacy":"backup"}'
  )
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

test('replaces only an empty directory pre-created by Electron', () => {
  const { source, target } = fixture()
  fs.mkdirSync(target)

  expect(importFrameProfile(source, target)).toMatchObject({ status: 'imported' })
  expect(fs.existsSync(path.join(target, 'config.json'))).toBe(true)
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

test('rejects a profile from a newer state version', () => {
  const { source, target } = fixture()
  fs.writeFileSync(
    path.join(source, 'config.json'),
    JSON.stringify({ main: { __: { 999: { main: { _version: 999 } } } } })
  )

  expect(() => importFrameProfile(source, target)).toThrow(
    'Frame profile version 999 is newer than Wren supports'
  )
  expect(fs.existsSync(target)).toBe(false)
})

test('rejects malformed signer records without creating a profile', () => {
  const { source, target } = fixture()
  fs.writeFileSync(
    path.join(source, 'signers', 'signer.json'),
    JSON.stringify({ id: 'signer', encryptedSeed: 'missing addresses and type' })
  )

  expect(() => importFrameProfile(source, target)).toThrow(
    'Frame signer file signer.json has an invalid record'
  )
  expect(fs.existsSync(target)).toBe(false)
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

  const sourceAlias = path.join(appDataPath, 'frame-alias')
  fs.symlinkSync(source, sourceAlias, 'dir')
  expect(() => importFrameProfile(source, path.join(sourceAlias, 'wren'))).toThrow(
    'Frame and Wren profile paths must be different'
  )
})
