import fs from 'fs'
import os from 'os'
import path from 'path'

const mockUserData = path.join(os.tmpdir(), `wren-signer-erasure-${process.pid}`)

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() =>
      require('path').join(require('os').tmpdir(), `wren-signer-erasure-${process.pid}`)
    ),
    on: jest.fn()
  }
}))

import { eraseSignerFiles } from '../../../../main/signers/hot/HotSigner'

const signerRoot = path.join(mockUserData, 'signers')

beforeEach(() => {
  fs.rmSync(mockUserData, { force: true, recursive: true })
  fs.mkdirSync(signerRoot, { recursive: true })
})

afterAll(() => {
  fs.rmSync(mockUserData, { force: true, recursive: true })
})

test('rejects path-like signer identifiers without touching an external file', () => {
  const target = path.join(mockUserData, '..', `wren-signer-erasure-target-${process.pid}.json`)
  fs.writeFileSync(target, 'keep me')

  try {
    expect(() => eraseSignerFiles('../../wren-signer-erasure-target')).toThrow('Invalid signer identifier')
    expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
  } finally {
    fs.rmSync(target, { force: true })
  }
})

test('unlinks a signer-path symlink without overwriting its target', () => {
  const target = path.join(mockUserData, 'external-target.json')
  const signerPath = path.join(signerRoot, 'safe-id.json')
  fs.writeFileSync(target, 'keep me')
  fs.symlinkSync(target, signerPath)

  eraseSignerFiles('safe-id')

  expect(fs.existsSync(signerPath)).toBe(false)
  expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
})

test('rejects a signer-path hard link without overwriting its target', () => {
  const target = path.join(mockUserData, 'external-hard-link-target.json')
  const signerPath = path.join(signerRoot, 'safe-id.json')
  fs.writeFileSync(target, 'keep me')
  fs.linkSync(target, signerPath)

  expect(() => eraseSignerFiles('safe-id')).toThrow('unexpected hard links')

  expect(fs.existsSync(signerPath)).toBe(true)
  expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
})

test('propagates storage errors instead of treating them as missing files', () => {
  const failure = Object.assign(new Error('storage unavailable'), { code: 'EACCES' })
  const lstat = jest.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
    throw failure
  })

  try {
    expect(() => eraseSignerFiles('safe-id')).toThrow('storage unavailable')
  } finally {
    lstat.mockRestore()
  }
})
