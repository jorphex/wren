import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { assertReleaseBuildIdentity } from './build-identity.mjs'
import { readSourceIdentity } from './source-identity.mjs'

const dist = path.resolve('dist')
const artifactWaitTimeout = 30_000
const artifactPollInterval = 250
const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(path.resolve('package-lock.json'), 'utf8'))
const sourceIdentity = readSourceIdentity()

const findArtifact = async (suffix) => {
  const deadline = Date.now() + artifactWaitTimeout

  while (Date.now() < deadline) {
    const entries = await readdir(dist)
    const matches = entries.filter((entry) => entry.endsWith(suffix))
    assert.ok(matches.length <= 1, `Expected one ${suffix} artifact, found ${matches.length}`)
    if (matches.length === 1) return matches[0]
    await delay(artifactPollInterval)
  }

  assert.fail(`Timed out waiting ${artifactWaitTimeout}ms for one ${suffix} artifact`)
}

const artifacts = await Promise.all([findArtifact('.AppImage'), findArtifact('_amd64.deb')])
const readDebFile = async (deb, member) => {
  const archive = spawn('dpkg-deb', ['--fsys-tarfile', deb], { stdio: ['ignore', 'pipe', 'pipe'] })
  const extract = spawn('tar', ['-xOf', '-', member], { stdio: ['pipe', 'pipe', 'pipe'] })
  const output = []
  const archiveErrors = []
  const extractErrors = []

  archive.stderr.on('data', (chunk) => archiveErrors.push(chunk))
  extract.stdout.on('data', (chunk) => output.push(chunk))
  extract.stderr.on('data', (chunk) => extractErrors.push(chunk))

  await Promise.all([
    pipeline(archive.stdout, extract.stdin),
    once(archive, 'close').then(([code]) =>
      assert.equal(code, 0, `dpkg-deb failed: ${Buffer.concat(archiveErrors).toString()}`)
    ),
    once(extract, 'close').then(([code]) =>
      assert.equal(code, 0, `tar failed: ${Buffer.concat(extractErrors).toString()}`)
    )
  ])

  return Buffer.concat(output).toString('utf8')
}

const unpackedModules = path.join(dist, 'linux-unpacked', 'resources', 'app.asar.unpacked', 'node_modules')
const nativeModules = [
  path.join(unpackedModules, 'node-hid', 'build', 'Release', 'HID_hidraw.node'),
  path.join(unpackedModules, 'usb', 'prebuilds', 'linux-x64', 'node.napi.glibc.node')
]

await Promise.all(nativeModules.map((modulePath) => access(modulePath)))

const packagedExecutable = path.join(dist, 'linux-unpacked', 'wren')
const packagedModuleProbe = `
const { createRequire } = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const modules = ['node-hid', 'usb']
const ledgerPackages = [
  '@ledgerhq/hw-app-eth',
  '@ledgerhq/hw-transport',
  '@ledgerhq/hw-transport-node-hid-noevents'
]
const appRoot = path.join(process.resourcesPath, 'app.asar')
const appModules = path.join(appRoot, 'node_modules')
for (const module of modules) require(path.join(appModules, module))
const trezorTransportRequire = createRequire(path.join(appModules, '@trezor/transport/package.json'))
trezorTransportRequire('usb')
const ledgerModules = ledgerPackages.map((module) => require(path.join(appModules, module)))
const ledgerVersions = Object.fromEntries(
  ledgerPackages.map((module) => [module, require(path.join(appModules, module, 'package.json')).version])
)
const { SiweMessage } = require(path.join(appModules, 'siwe'))
const ethers = require(path.join(appModules, 'ethers'))
const sigUtil = require(path.join(appModules, '@metamask/eth-sig-util'))
const tarFs = require(path.join(appModules, 'tar-fs'))
const tarFsRequire = createRequire(path.join(appModules, 'tar-fs', 'package.json'))
const tarStream = tarFsRequire('tar-stream')
const electronLog = require(path.join(appModules, 'electron-log'))
const { z } = require(path.join(appModules, 'zod'))
const siwe = new SiweMessage(\`example.com wants you to sign in with your Ethereum account:
0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2


URI: https://example.com/login
Version: 1
Chain ID: 1
Nonce: 32891756
Issued At: 2021-09-30T16:25:24Z\`)
const signaturePrivateKey = Buffer.from('46'.repeat(32), 'hex')
const signatureAddress = '0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f'
const signatureData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' }
    ],
    Mail: [
      { name: 'recipient', type: 'address' },
      { name: 'contents', type: 'string' }
    ]
  },
  primaryType: 'Mail',
  domain: { name: 'Frame', version: '1', chainId: 1, verifyingContract: signatureAddress },
  message: { recipient: signatureAddress, contents: 'hello' }
}
const signature = sigUtil.signTypedData({
  privateKey: signaturePrivateKey,
  data: signatureData,
  version: sigUtil.SignTypedDataVersion.V4
})
const signatureHash = sigUtil.TypedDataUtils.eip712Hash(
  signatureData,
  sigUtil.SignTypedDataVersion.V4
).toString('hex')
const recoveredSignatureAddress = sigUtil.recoverTypedSignature({
  data: signatureData,
  signature,
  version: sigUtil.SignTypedDataVersion.V4
})
const modernModules = require(path.join(appRoot, 'compiled/main/nebula/modules.js'))
const fetchUtils = require(path.join(appRoot, 'compiled/resources/utils/fetch.js'))
const signerCrypto = require(path.join(appRoot, 'compiled/main/signers/hot/crypto.js'))
const sandbox = require(path.join(appRoot, 'compiled/main/security/sandbox.js'))
const { nodeWorkerEnvironment } = require(path.join(appRoot, 'compiled/main/worker/environment.js'))
const buildIdentity = require(path.join(appRoot, 'compiled/main/build-identity.json'))
const rendererBuildIdentity = require(path.join(appRoot, 'bundle/build-identity.json'))
const packagedMetadata = require(path.join(appRoot, 'package.json'))
const { Wallet } = require(path.join(appModules, '@ethereumjs/wallet'))
const walletAddress = Wallet.fromPrivateKey(Buffer.from('46'.repeat(32), 'hex')).getAddressString()
const signerSecret = 'packaged-software-signer-probe'
const encryptedSignerSecret = signerCrypto.encryptSecret(signerSecret, 'package-test-password')
const decryptedSignerSecret = signerCrypto.decryptSecret(encryptedSignerSecret, 'package-test-password')
const tamperedSignerSecret = structuredClone(encryptedSignerSecret)
tamperedSignerSecret.ciphertext = \`\${tamperedSignerSecret.ciphertext[0] === '0' ? '1' : '0'}\${tamperedSignerSecret.ciphertext.slice(1)}\`
let signerTamperingRejected = false
try {
  signerCrypto.decryptSecret(tamperedSignerSecret, 'package-test-password')
} catch {
  signerTamperingRejected = true
}
const zodPartialRecord = z.partialRecord(z.enum(['existing', 'future']), z.boolean()).parse({ existing: true })
const zodPrefault = z.object({ enabled: z.boolean().default(true) }).prefault({}).parse(undefined)
const zodUnsafeInteger = z.number().int().safeParse(Number.MAX_SAFE_INTEGER + 1)
const workerEnvironment = nodeWorkerEnvironment({
  ELECTRON_RUN_AS_NODE: '0',
  FRAME_PACKAGE_WORKER_PROBE: 'worker'
})
const rendererBundles = ['tray', 'dash', 'dapp', 'onboard']
const rendererBundleNoncesValid = rendererBundles.every((renderer) => {
  const html = fs.readFileSync(path.join(appRoot, 'bundle', renderer + '.html'), 'utf8')
  const nonceMatches = [...html.matchAll(/'nonce-([^']+)'/g)]
  const nonces = new Set(nonceMatches.map((match) => match[1]))
  if (nonces.size !== 1) return false
  const [nonce] = nonces
  const scripts = [...html.matchAll(/<script\\b[^>]*>/gi)].map(([tag]) => tag)
  return scripts.length > 0 && scripts.every((tag) => {
    const match = tag.match(/\\bnonce\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s>]+))/i)
    return match && (match[1] || match[2] || match[3]) === nonce
  })
})
let noSandboxRejected = false
try {
  sandbox.assertSandboxEnabled({ hasSwitch: (name) => name === 'no-sandbox' }, 'production')
} catch {
  noSandboxRejected = true
}
Promise.all([
  Promise.all([modernModules.loadKuboModule(), modernModules.loadUnixFsModule()]),
  fetchUtils.readJsonWithLimit(new Response('{"runtime":"native"}'), 64)
])
  .then(([loaded, fetchProbe]) => process.stdout.write(JSON.stringify({
    electron: process.versions.electron,
    abi: process.versions.modules,
    desktopName: packagedMetadata.desktopName,
    buildIdentity,
    rendererBuildIdentity,
    noSandboxRejected,
    rendererBundleNoncesValid,
    workerEnvironment: {
      inheritedPath: workerEnvironment.PATH === process.env.PATH,
      override: workerEnvironment.FRAME_PACKAGE_WORKER_PROBE,
      runAsNode: workerEnvironment.ELECTRON_RUN_AS_NODE
    },
    modules: [...modules, 'usb via @trezor/transport'],
    ledgerApis: ledgerModules.map((module) => typeof module.default),
    ledgerVersions,
    siweDomain: siwe.domain,
    reactVersion: require(path.join(appModules, 'react/package.json')).version,
    reactDomVersion: require(path.join(appModules, 'react-dom/package.json')).version,
    styledComponentsVersion: require(path.join(appModules, 'styled-components/package.json')).version,
    ethersVersion: ethers.version,
    ethersBrowserProvider: typeof ethers.BrowserProvider,
    signatureVersion: require(path.join(appModules, '@metamask/eth-sig-util/package.json')).version,
    archiveVersions: {
      'tar-fs': require(path.join(appModules, 'tar-fs/package.json')).version,
      'tar-stream': tarFsRequire('tar-stream/package.json').version
    },
    archiveApis: [typeof tarFs.extract, typeof tarStream.extract],
    electronLogVersion: require(path.join(appModules, 'electron-log/package.json')).version,
    electronLogApis: [
      typeof electronLog.info,
      typeof electronLog.error,
      typeof electronLog.transports.console,
      typeof electronLog.transports.file,
      typeof electronLog.transports.file.resolvePathFn
    ],
    zodVersion: require(path.join(appModules, 'zod/package.json')).version,
    zodProbe: {
      partialRecord: zodPartialRecord,
      prefault: zodPrefault,
      unsafeIntegerAccepted: zodUnsafeInteger.success
    },
    signature,
    signatureHash,
    recoveredSignatureAddress,
    walletAddress,
    signerEncryptionVersion: encryptedSignerSecret.version,
    signerSecretRoundTrip: decryptedSignerSecret.plaintext === signerSecret,
    signerTamperingRejected,
    fetchType: typeof fetch,
    fetchProbe,
    esmModules: loaded.map((module) => Object.keys(module).length)
  })))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
`
const runPackagedProbe = (description, executable) => {
  const probe = spawnSync(executable, ['-e', packagedModuleProbe], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: 'true' },
    timeout: 30_000
  })

  assert.equal(probe.status, 0, `${description} module probe failed:\n${probe.error || probe.stderr}`)
  return JSON.parse(probe.stdout)
}

const probeResult = runPackagedProbe('linux-unpacked', packagedExecutable)
const appImageExtraction = await mkdtemp(path.join(tmpdir(), 'wren-appimage-'))
const debExtraction = await mkdtemp(path.join(tmpdir(), 'wren-deb-'))
let appImageProbeResult
let appImageDesktopEntry
let debProbeResult
try {
  execFileSync(path.join(dist, artifacts[0]), ['--appimage-extract'], {
    cwd: appImageExtraction,
    stdio: 'ignore',
    timeout: 30_000
  })
  execFileSync('dpkg-deb', ['--extract', path.join(dist, artifacts[1]), debExtraction], {
    stdio: 'ignore',
    timeout: 30_000
  })

  appImageProbeResult = runPackagedProbe('AppImage', path.join(appImageExtraction, 'squashfs-root', 'wren'))
  appImageDesktopEntry = await readFile(
    path.join(appImageExtraction, 'squashfs-root', packageJson.desktopName),
    'utf8'
  )
  debProbeResult = runPackagedProbe('deb', path.join(debExtraction, 'opt', 'Wren', 'wren'))
} finally {
  await Promise.all([
    rm(appImageExtraction, { recursive: true, force: true }),
    rm(debExtraction, { recursive: true, force: true })
  ])
}

assert.deepEqual(appImageProbeResult, probeResult, 'AppImage payload differs from package output')
assert.deepEqual(debProbeResult, probeResult, 'deb payload differs from package output')
const desktopEntry = await readDebFile(
  path.join(dist, artifacts[1]),
  `./usr/share/applications/${packageJson.desktopName}`
)
const builderPackage = JSON.parse(
  await readFile(path.resolve('node_modules/electron-builder/package.json'), 'utf8')
)
const notarizePackage = JSON.parse(
  await readFile(path.resolve('node_modules/@electron/notarize/package.json'), 'utf8')
)
const [{ notarize }, { default: notarizeHook }, { default: builderConfig }] = await Promise.all([
  import('@electron/notarize'),
  import(pathToFileURL(path.resolve('build/notarize.js')).href),
  import(pathToFileURL(path.resolve('build/electron-builder-standard.js')).href)
])
assert.equal(builderPackage.version, packageJson.devDependencies['electron-builder'])
assert.equal(notarizePackage.version, packageJson.devDependencies['@electron/notarize'])
assert.equal(typeof notarize, 'function')
assert.equal(typeof notarizeHook, 'function')
assert.equal(builderConfig.win.signtoolOptions, undefined)
assert.equal(builderConfig.win.publisherName, undefined)
assert.deepEqual(builderConfig.appImage.executableArgs, [])
assert.equal(builderConfig.linux.syncDesktopName, true)
assert.equal(builderConfig.linux.category, 'Office;Finance')
await notarizeHook({})
assert.equal(probeResult.electron, packageJson.devDependencies.electron)
assert.equal(probeResult.desktopName, packageJson.desktopName)
assertReleaseBuildIdentity(probeResult.buildIdentity, sourceIdentity, packageJson.version)
assertReleaseBuildIdentity(probeResult.rendererBuildIdentity, sourceIdentity, packageJson.version)
assert.equal(probeResult.noSandboxRejected, true)
assert.equal(probeResult.rendererBundleNoncesValid, true)
assert.deepEqual(probeResult.workerEnvironment, {
  inheritedPath: true,
  override: 'worker',
  runAsNode: '1'
})
assert.match(appImageDesktopEntry, /^Exec=AppRun %U$/m)
assert.doesNotMatch(appImageDesktopEntry, /--no-sandbox/)
assert.match(desktopEntry, /^Exec=\/opt\/Wren\/wren %U$/m)
assert.match(desktopEntry, /^StartupWMClass=wren$/m)
assert.match(desktopEntry, /^Categories=Office;Finance;$/m)
assert.doesNotMatch(desktopEntry, /^Categories=Utility;$/m)
assert.deepEqual(probeResult.modules, ['node-hid', 'usb', 'usb via @trezor/transport'])
assert.ok(probeResult.ledgerApis.every((api) => api === 'function'))
assert.deepEqual(probeResult.ledgerVersions, {
  '@ledgerhq/hw-app-eth': packageJson.dependencies['@ledgerhq/hw-app-eth'],
  '@ledgerhq/hw-transport': packageJson.dependencies['@ledgerhq/hw-transport'],
  '@ledgerhq/hw-transport-node-hid-noevents':
    packageJson.dependencies['@ledgerhq/hw-transport-node-hid-noevents']
})
assert.equal(probeResult.siweDomain, 'example.com')
assert.equal(probeResult.reactVersion, packageJson.dependencies.react)
assert.equal(probeResult.reactDomVersion, packageJson.dependencies['react-dom'])
assert.equal(probeResult.styledComponentsVersion, packageJson.dependencies['styled-components'])
assert.equal(probeResult.ethersVersion, packageJson.dependencies.ethers)
assert.equal(probeResult.ethersBrowserProvider, 'function')
assert.equal(probeResult.signatureVersion, packageJson.dependencies['@metamask/eth-sig-util'])
assert.deepEqual(probeResult.archiveVersions, {
  'tar-fs': packageJson.dependencies['tar-fs'],
  'tar-stream':
    packageLock.packages['node_modules/tar-fs/node_modules/tar-stream']?.version ??
    packageLock.packages['node_modules/tar-stream'].version
})
assert.deepEqual(probeResult.archiveApis, ['function', 'function'])
assert.equal(probeResult.electronLogVersion, packageJson.dependencies['electron-log'])
assert.deepEqual(probeResult.electronLogApis, Array(5).fill('function'))
assert.equal(probeResult.zodVersion, packageJson.dependencies.zod)
assert.deepEqual(probeResult.zodProbe, {
  partialRecord: { existing: true },
  prefault: { enabled: true },
  unsafeIntegerAccepted: false
})
assert.equal(probeResult.signatureHash, 'd07e8b0969c3d3ba7934bcf9134d586ce1c14c96c4396824a3c6b0137c1e4943')
assert.equal(
  probeResult.signature,
  '0xd5a81e21c610fc88fa3acf615af9881b4b23c52ff4c6a4094b6cfb4af09dde5e35a4e4d8d365477faea588b3fdc54ea3792b14c607f1d69a39e5c6ca8e2d5e2a1c'
)
assert.equal(probeResult.recoveredSignatureAddress, '0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f')
assert.equal(probeResult.walletAddress, '0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f')
assert.equal(probeResult.signerEncryptionVersion, 2)
assert.equal(probeResult.signerSecretRoundTrip, true)
assert.equal(probeResult.signerTamperingRejected, true)
assert.equal(probeResult.fetchType, 'function')
assert.deepEqual(probeResult.fetchProbe, { runtime: 'native' })
assert.equal(probeResult.esmModules.length, 2)
assert.ok(probeResult.esmModules.every((exports) => exports > 0))
assert.match(probeResult.abi, /^\d+$/)

console.log(
  `Verified ${artifacts.join(' and ')} with Electron ${probeResult.electron} ABI ${
    probeResult.abi
  } hardware-wallet native, Ledger ${
    probeResult.ledgerVersions['@ledgerhq/hw-app-eth']
  }, source identity, sandbox enforcement, electron-builder 26/notarize 3, React 19/styled-components 6, SIWE, EIP-712, Zod 4, electron-log 5, native fetch, tar-fs 3, ethers 6, EthereumJS wallet, software-signer encryption, and IPFS ESM modules`
)
