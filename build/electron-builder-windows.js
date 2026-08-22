const baseConfig = require('./electron-builder-base.js')
const { readSigningMode } = require('./signing-mode.js')

const signingMode = readSigningMode('WREN_WINDOWS_SIGNING')

module.exports = {
  ...baseConfig,
  artifactName:
    signingMode === 'required'
      ? 'Wren-Setup-${version}-x64.${ext}'
      : 'Wren-Setup-${version}-unsigned-x64.${ext}',
  forceCodeSigning: signingMode === 'required',
  win: {
    signAndEditExecutable: true,
    signExecutable: signingMode === 'required',
    icon: 'build/icons/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  }
}
