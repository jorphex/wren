const load = (path, env = {}) => {
  jest.resetModules()
  const names = ['WREN_MAC_SIGNING', 'WREN_MAC_NOTARIZATION', 'WREN_WINDOWS_SIGNING']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  names.forEach((name) => delete process.env[name])
  Object.assign(process.env, env)
  try {
    return require(path)
  } finally {
    names.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    })
  }
}

describe('electron-builder platform boundaries', () => {
  test('keeps the Linux build independent of signing configuration', () => {
    const config = load('../../../build/electron-builder-linux.js')
    expect(config.linux.category).toBe('Office;Finance')
    expect(config.appImage.executableArgs).toEqual([])
    expect(config.linux.target.map(({ target }) => target)).toEqual(['AppImage', 'deb'])
    expect(config.linux.target.every((target) => target.arch.every((arch) => arch === 'x64'))).toBe(true)
    expect(config.mac).toBeUndefined()
    expect(config.win).toBeUndefined()
  })

  test('shares Linux policy with the native arm64 configuration', () => {
    const config = load('../../../build/electron-builder-linux-arm64.js')
    expect(config.linux.category).toBe('Office;Finance')
    expect(config.appImage.executableArgs).toEqual([])
    expect(config.linux.target.every((target) => target.arch.every((arch) => arch === 'arm64'))).toBe(true)
  })

  test('makes unsigned macOS output explicit and removes inherited identities', () => {
    const config = load('../../../build/electron-builder-macos.js', {
      WREN_MAC_SIGNING: 'skip',
      WREN_MAC_NOTARIZATION: 'skip'
    })
    expect(config.forceCodeSigning).toBe(false)
    expect(config.mac.identity).toBeNull()
    expect(config.mac.requirements).toBeUndefined()
  })

  test('makes macOS release signing fail closed', () => {
    const config = load('../../../build/electron-builder-macos.js', {
      WREN_MAC_SIGNING: 'required',
      WREN_MAC_NOTARIZATION: 'required'
    })
    expect(config.forceCodeSigning).toBe(true)
    expect(config.mac.identity).toBeUndefined()
    expect(config.mac.target.arch).toEqual([process.arch])
    expect(() => load('../../../build/electron-builder-macos.js')).toThrow(
      'WREN_MAC_SIGNING must be explicitly set'
    )
    expect(() =>
      load('../../../build/electron-builder-macos.js', {
        WREN_MAC_SIGNING: 'required',
        WREN_MAC_NOTARIZATION: 'skip'
      })
    ).toThrow('macOS signing and notarization modes must match')
  })

  test('distinguishes unsigned and fail-closed Windows output', () => {
    const unsigned = load('../../../build/electron-builder-windows.js', {
      WREN_WINDOWS_SIGNING: 'skip'
    })
    expect(unsigned.forceCodeSigning).toBe(false)
    expect(unsigned.win.signExecutable).toBe(false)

    const release = load('../../../build/electron-builder-windows.js', {
      WREN_WINDOWS_SIGNING: 'required'
    })
    expect(release.forceCodeSigning).toBe(true)
    expect(release.win.signExecutable).toBe(true)
  })
})
