import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  APPLICATION_NAME,
  configureApplicationIdentity,
  legacyProfilePath
} from '../../main/applicationIdentity'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const application = (customProfile?: string) => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'wren-identity-'))
  roots.push(appData)
  const paths = { appData, userData: customProfile || path.join(appData, 'electron-default') }

  return {
    commandLine: { hasSwitch: jest.fn(() => Boolean(customProfile)) },
    getPath: jest.fn((name: 'appData' | 'userData') => paths[name]),
    setName: jest.fn(),
    setPath: jest.fn((name: 'userData', value: string) => {
      paths[name] = value
    })
  }
}

it('uses an independent Wren profile by default', () => {
  const app = application()

  configureApplicationIdentity(app)

  expect(app.setName).toHaveBeenCalledWith(APPLICATION_NAME)
  expect(app.setPath).toHaveBeenCalledWith('userData', path.join(app.getPath('appData'), 'wren'))
})

it('preserves an explicit isolated profile', () => {
  const app = application(path.join(os.tmpdir(), 'isolated-wren-profile'))

  configureApplicationIdentity(app)

  expect(app.setName).toHaveBeenCalledWith(APPLICATION_NAME)
  expect(app.setPath).not.toHaveBeenCalled()
})

it('rejects direct and nested access to the legacy Frame profile', () => {
  const direct = application()
  const frameProfile = path.join(direct.getPath('appData'), 'frame')
  fs.mkdirSync(frameProfile)
  direct.commandLine.hasSwitch.mockReturnValue(true)
  direct.getPath.mockImplementation((name: 'appData' | 'userData') =>
    name === 'appData' ? path.dirname(frameProfile) : frameProfile
  )

  expect(() => configureApplicationIdentity(direct)).toThrow(
    'Wren cannot use a profile inside the Frame profile; use --import-frame-profile instead'
  )

  direct.getPath.mockImplementation((name: 'appData' | 'userData') =>
    name === 'appData' ? path.dirname(frameProfile) : path.join(frameProfile, 'nested-wren')
  )
  expect(() => configureApplicationIdentity(direct)).toThrow(
    'Wren cannot use a profile inside the Frame profile; use --import-frame-profile instead'
  )

  const linked = application()
  const linkedFrame = path.join(linked.getPath('appData'), 'frame')
  const alias = path.join(linked.getPath('appData'), 'frame-alias')
  fs.mkdirSync(linkedFrame)
  fs.symlinkSync(linkedFrame, alias, 'dir')
  linked.commandLine.hasSwitch.mockReturnValue(true)
  linked.getPath.mockImplementation((name: 'appData' | 'userData') =>
    name === 'appData' ? path.dirname(linkedFrame) : path.join(alias, 'nested-wren')
  )

  expect(() => configureApplicationIdentity(linked)).toThrow(
    'Wren cannot use a profile inside the Frame profile; use --import-frame-profile instead'
  )
})

it('resolves the legacy Frame profile without touching it', () => {
  expect(legacyProfilePath(path.join(path.sep, 'home', 'test', '.config'))).toBe(
    path.join(path.sep, 'home', 'test', '.config', 'frame')
  )
})
