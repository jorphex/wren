const baseConfig = require('./electron-builder-base.js')
const { readSigningMode } = require('./signing-mode.js')

const signingMode = readSigningMode('WREN_MAC_SIGNING')
const notarizationMode = readSigningMode('WREN_MAC_NOTARIZATION')

if (signingMode !== notarizationMode) {
  throw new Error('macOS signing and notarization modes must match')
}

module.exports = {
  ...baseConfig,
  afterSign: './build/notarize.js',
  forceCodeSigning: signingMode === 'required',
  mac: {
    target: { target: 'default', arch: [process.arch] },
    identity: signingMode === 'skip' ? null : undefined,
    notarize: false,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist'
  }
}
