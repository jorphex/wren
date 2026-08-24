const baseConfig = require('./electron-builder-base.js')
const { readMacSigningMode, readSigningMode } = require('./signing-mode.js')

const signingMode = readMacSigningMode('WREN_MAC_SIGNING')
const notarizationMode = readSigningMode('WREN_MAC_NOTARIZATION')

if ((signingMode === 'required') !== (notarizationMode === 'required')) {
  throw new Error('macOS Developer ID signing and notarization must both be required or both be skipped')
}

const preview = signingMode !== 'required'

module.exports = {
  ...baseConfig,
  artifactName: preview
    ? 'Wren-${version}-macos-${arch}-unnotarized.${ext}'
    : 'Wren-${version}-macos-${arch}.${ext}',
  afterSign: './build/notarize.js',
  forceCodeSigning: signingMode !== 'skip',
  mac: {
    target: { target: 'default', arch: [process.arch] },
    identity: signingMode === 'skip' ? null : signingMode === 'adhoc' ? '-' : undefined,
    notarize: false,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist'
  }
}
