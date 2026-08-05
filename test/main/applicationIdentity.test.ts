import path from 'path'

import {
  APPLICATION_NAME,
  configureApplicationIdentity,
  legacyProfilePath
} from '../../main/applicationIdentity'

const application = (customProfile = false) => ({
  commandLine: { hasSwitch: jest.fn(() => customProfile) },
  getPath: jest.fn(() => path.join(path.sep, 'home', 'test', '.config')),
  setName: jest.fn(),
  setPath: jest.fn()
})

it('uses an independent Wren profile by default', () => {
  const app = application()

  configureApplicationIdentity(app)

  expect(app.setName).toHaveBeenCalledWith(APPLICATION_NAME)
  expect(app.setPath).toHaveBeenCalledWith('userData', path.join(path.sep, 'home', 'test', '.config', 'wren'))
})

it('preserves an explicit isolated profile', () => {
  const app = application(true)

  configureApplicationIdentity(app)

  expect(app.setName).toHaveBeenCalledWith(APPLICATION_NAME)
  expect(app.setPath).not.toHaveBeenCalled()
  expect(app.getPath).not.toHaveBeenCalled()
})

it('resolves the legacy Frame profile without touching it', () => {
  expect(legacyProfilePath(path.join(path.sep, 'home', 'test', '.config'))).toBe(
    path.join(path.sep, 'home', 'test', '.config', 'frame')
  )
})
