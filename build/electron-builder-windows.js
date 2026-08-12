const baseConfig = require('./electron-builder-base.js')
const { readSigningMode } = require('./signing-mode.js')

const signingMode = readSigningMode('WREN_WINDOWS_SIGNING')

module.exports = {
  ...baseConfig,
  forceCodeSigning: signingMode === 'required',
  win: {
    signAndEditExecutable: true,
    signExecutable: signingMode === 'required',
    icon: 'build/icons/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  }
}
