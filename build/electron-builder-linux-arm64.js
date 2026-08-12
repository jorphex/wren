// build config for linux arm64

const baseConfig = require('./electron-builder-linux.js')

const config = {
  ...baseConfig,
  linux: {
    ...baseConfig.linux,
    target: [
      {
        target: 'AppImage',
        arch: ['arm64']
      },
      {
        target: 'tar.gz',
        arch: ['arm64']
      }
    ]
  }
}

module.exports = config
