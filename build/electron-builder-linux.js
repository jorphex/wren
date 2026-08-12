const baseConfig = require('./electron-builder-base.js')

module.exports = {
  ...baseConfig,
  appImage: {
    // Wren requires Electron's renderer sandbox in production.
    executableArgs: []
  },
  linux: {
    category: 'Office;Finance',
    syncDesktopName: true,
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'snap', arch: ['x64'] },
      { target: 'tar.gz', arch: ['x64'] }
    ]
  }
}
