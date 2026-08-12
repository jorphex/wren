const { createRequire } = require('node:module')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.join(process.resourcesPath, 'app.asar')
const appModules = path.join(appRoot, 'node_modules')
const fromApp = (module) => require(path.join(appModules, module))
const packageVersion = (module) => require(path.join(appModules, module, 'package.json')).version

const nodeHid = fromApp('node-hid')
const usb = fromApp('usb')
const trezorRequire = createRequire(path.join(appModules, '@trezor/transport/package.json'))
const trezorUsb = trezorRequire('usb')
const ledgerPackages = [
  '@ledgerhq/hw-app-eth',
  '@ledgerhq/hw-transport',
  '@ledgerhq/hw-transport-node-hid-noevents'
]
const ledger = ledgerPackages.map((module) => fromApp(module))
const sandbox = require(path.join(appRoot, 'compiled/main/security/sandbox.js'))
const signerCrypto = require(path.join(appRoot, 'compiled/main/signers/hot/crypto.js'))
const modernModules = require(path.join(appRoot, 'compiled/main/nebula/modules.js'))
const fetchUtils = require(path.join(appRoot, 'compiled/resources/utils/fetch.js'))
const buildIdentity = require(path.join(appRoot, 'compiled/main/build-identity.json'))
const rendererBuildIdentity = require(path.join(appRoot, 'bundle/build-identity.json'))
const packagedMetadata = require(path.join(appRoot, 'package.json'))
const { Wallet } = fromApp('@ethereumjs/wallet')
const ethers = fromApp('ethers')
const { SiweMessage } = fromApp('siwe')
const { z } = fromApp('zod')
const tarFs = fromApp('tar-fs')

const rendererBundles = ['tray', 'dash', 'dapp', 'onboard']
const rendererBundleNoncesValid = rendererBundles.every((renderer) => {
  const html = fs.readFileSync(path.join(appRoot, 'bundle', `${renderer}.html`), 'utf8')
  const nonceMatches = [...html.matchAll(/'nonce-([^']+)'/g)]
  const nonces = new Set(nonceMatches.map((match) => match[1]))
  if (nonces.size !== 1) return false
  const [nonce] = nonces
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag)
  return (
    scripts.length > 0 &&
    scripts.every((tag) => {
      const match = tag.match(/\bnonce\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
      return match && (match[1] || match[2] || match[3]) === nonce
    })
  )
})

let noSandboxRejected = false
try {
  sandbox.assertSandboxEnabled({ hasSwitch: (name) => name === 'no-sandbox' }, 'production')
} catch {
  noSandboxRejected = true
}

const signerSecret = 'packaged-runtime-smoke'
const encrypted = signerCrypto.encryptSecret(signerSecret, 'package-smoke-password')
const decrypted = signerCrypto.decryptSecret(encrypted, 'package-smoke-password')
const tampered = structuredClone(encrypted)
tampered.ciphertext = `${tampered.ciphertext[0] === '0' ? '1' : '0'}${tampered.ciphertext.slice(1)}`
let signerTamperingRejected = false
try {
  signerCrypto.decryptSecret(tampered, 'package-smoke-password')
} catch {
  signerTamperingRejected = true
}

const siwe = new SiweMessage(`example.com wants you to sign in with your Ethereum account:
0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2


URI: https://example.com/login
Version: 1
Chain ID: 1
Nonce: 32891756
Issued At: 2021-09-30T16:25:24Z`)
const walletAddress = Wallet.fromPrivateKey(Buffer.from('46'.repeat(32), 'hex')).getAddressString()

Promise.all([
  Promise.all([modernModules.loadKuboModule(), modernModules.loadUnixFsModule()]),
  fetchUtils.readJsonWithLimit(new Response('{"runtime":"native"}'), 64)
])
  .then(([esmModules, fetchProbe]) =>
    process.stdout.write(
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        abi: process.versions.modules,
        desktopName: packagedMetadata.desktopName,
        packageVersion: packagedMetadata.version,
        buildIdentity,
        rendererBuildIdentity,
        rendererBundleNoncesValid,
        noSandboxRejected,
        nativeModules: {
          nodeHid: typeof nodeHid.devices,
          usb: typeof usb.getDeviceList,
          trezorUsb: typeof trezorUsb,
          ledger: ledger.map((module) => typeof module.default)
        },
        versions: {
          nodeHid: packageVersion('node-hid'),
          usb: packageVersion('usb'),
          ledger: Object.fromEntries(ledgerPackages.map((module) => [module, packageVersion(module)]))
        },
        runtime: {
          ethers: ethers.version,
          ethersBrowserProvider: typeof ethers.BrowserProvider,
          siweDomain: siwe.domain,
          zod: packageVersion('zod'),
          zodUnsafeIntegerAccepted: z
            .number()
            .int()
            .safeParse(Number.MAX_SAFE_INTEGER + 1).success,
          tarFsExtract: typeof tarFs.extract,
          walletAddress,
          fetchProbe,
          esmModuleExports: esmModules.map((module) => Object.keys(module).length)
        },
        signerSecretRoundTrip: decrypted.plaintext === signerSecret,
        signerTamperingRejected
      })
    )
  )
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
