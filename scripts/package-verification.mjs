import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertReleaseBuildIdentity } from './build-identity.mjs'
import { readSourceIdentity } from './source-identity.mjs'

const platformNames = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }
const sevenZip = process.env.WREN_7Z ?? '7z'

export const packageTargets = Object.freeze({
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    unpackedDirectory: 'linux-unpacked',
    executable: ['wren'],
    artifacts: [
      { name: 'AppImage', kind: 'appimage', fileName: ({ version }) => `Wren-${version}.AppImage` },
      { name: 'amd64 deb', kind: 'deb', fileName: ({ version }) => `wren_${version}_amd64.deb` }
    ]
  },
  'linux-arm64': {
    platform: 'linux',
    arch: 'arm64',
    unpackedDirectory: 'linux-arm64-unpacked',
    executable: ['wren'],
    artifacts: [
      {
        name: 'arm64 AppImage',
        kind: 'appimage',
        fileName: ({ version }) => `Wren-${version}-arm64.AppImage`
      },
      {
        name: 'arm64 tarball',
        kind: 'tar',
        fileName: ({ version }) => `wren-${version}-arm64.tar.gz`
      }
    ]
  },
  'mac-x64': {
    platform: 'darwin',
    arch: 'x64',
    unpackedDirectory: 'mac',
    executable: ['Wren.app', 'Contents', 'MacOS', 'Wren'],
    artifacts: [
      {
        name: 'x64 unnotarized DMG',
        kind: 'dmg',
        fileName: ({ version }) => `Wren-${version}-macos-x64-unnotarized.dmg`
      },
      {
        name: 'x64 unnotarized ZIP',
        kind: 'zip',
        fileName: ({ version }) => `Wren-${version}-macos-x64-unnotarized.zip`
      }
    ]
  },
  'mac-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    unpackedDirectory: 'mac-arm64',
    executable: ['Wren.app', 'Contents', 'MacOS', 'Wren'],
    artifacts: [
      {
        name: 'arm64 unnotarized DMG',
        kind: 'dmg',
        fileName: ({ version }) => `Wren-${version}-macos-arm64-unnotarized.dmg`
      },
      {
        name: 'arm64 unnotarized ZIP',
        kind: 'zip',
        fileName: ({ version }) => `Wren-${version}-macos-arm64-unnotarized.zip`
      }
    ]
  },
  'windows-x64': {
    platform: 'win32',
    arch: 'x64',
    nsisPayload: 'app-64.7z',
    unpackedDirectory: 'win-unpacked',
    executable: ['Wren.exe'],
    artifacts: [
      {
        name: 'x64 NSIS installer',
        kind: 'nsis',
        fileName: ({ version }) => `Wren-Setup-${version}-unsigned-x64.exe`
      }
    ]
  }
})

export function getPackageTarget(name) {
  assert.ok(Object.hasOwn(packageTargets, name), `Unknown package verification target: ${name}`)
  return packageTargets[name]
}

export function selectPackageArtifacts(entries, target, version) {
  return target.artifacts.map(({ name, fileName }) => {
    const expected = fileName({ version })
    const count = entries.filter((entry) => entry === expected).length
    assert.equal(count, 1, `Expected one ${name}, found ${count}`)
    return expected
  })
}

export function assertNativeHost(target, host = { platform: process.platform, arch: process.arch }) {
  assert.equal(
    host.platform,
    target.platform,
    `Package runtime verification requires ${platformNames[target.platform]} (${target.platform})`
  )
  assert.equal(host.arch, target.arch, `Package runtime verification requires ${target.arch}`)
}

export function assertSafeArchiveEntries(entries) {
  assert.ok(entries.length > 0, 'Package archive is empty')
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    assert.ok(!normalized.includes('\0'), 'Package archive entry contains a null byte')
    assert.ok(!path.posix.isAbsolute(normalized), `Absolute package archive entry: ${entry}`)
    assert.doesNotMatch(normalized, /^[A-Za-z]:\//, `Drive-qualified package archive entry: ${entry}`)
    assert.ok(
      !normalized.split('/').includes('..'),
      `Package archive entry escapes extraction root: ${entry}`
    )
  }
}

export async function removeTemporaryPackageRoot(root, remove = rm) {
  await remove(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 250
  })
}

function readArchiveEntries(command, args, artifact) {
  const output = execFileSync(command, args, { encoding: 'utf8' })
  const entries = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => path.resolve(entry) !== path.resolve(artifact))
  assertSafeArchiveEntries(entries)
}

function runPackagedProbe(executable, root) {
  const probe = spawnSync(executable, [path.join(root, 'scripts', 'package-runtime-smoke.cjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: 'true' },
    timeout: 30_000
  })
  assert.equal(probe.status, 0, `Packaged runtime smoke failed:\n${probe.error || probe.stderr}`)
  return JSON.parse(probe.stdout)
}

async function findPackagedExecutable(root, target) {
  const candidates = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(candidate)
      else if (entry.isFile() && entry.name === target.executable.at(-1)) candidates.push(candidate)
    }
  }
  await visit(root)
  const valid = []
  for (const candidate of candidates) {
    const resources =
      target.platform === 'darwin'
        ? path.join(path.dirname(path.dirname(candidate)), 'Resources', 'app.asar')
        : path.join(path.dirname(candidate), 'resources', 'app.asar')
    try {
      if ((await lstat(resources)).isFile()) valid.push(candidate)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  assert.equal(valid.length, 1, `Expected one packaged executable in ${root}, found ${valid.length}`)
  return valid[0]
}

async function probeArtifact(artifact, kind, target, root, temporaryRoot, verifyExecutable) {
  const extraction = path.join(temporaryRoot, kind)
  await mkdir(extraction)
  let mounted = false
  try {
    if (kind === 'appimage') {
      execFileSync(artifact, ['--appimage-extract'], { cwd: extraction, stdio: 'ignore' })
    } else if (kind === 'deb') {
      execFileSync('dpkg-deb', ['--extract', artifact, extraction], { stdio: 'ignore' })
    } else if (kind === 'tar') {
      readArchiveEntries('tar', ['-tzf', artifact], artifact)
      execFileSync('tar', ['-xzf', artifact, '-C', extraction, '--no-same-owner', '--no-same-permissions'], {
        stdio: 'ignore'
      })
    } else if (kind === 'zip') {
      readArchiveEntries('unzip', ['-Z1', artifact], artifact)
      execFileSync('ditto', ['-x', '-k', artifact, extraction], { stdio: 'ignore' })
    } else if (kind === 'dmg') {
      execFileSync('hdiutil', ['attach', artifact, '-readonly', '-nobrowse', '-mountpoint', extraction], {
        stdio: 'ignore'
      })
      mounted = true
    } else if (kind === 'nsis') {
      const listing = execFileSync(sevenZip, ['l', '-slt', artifact], { encoding: 'utf8' })
      const entries = listing
        .split(/\r?\n/)
        .filter((line) => line.startsWith('Path = '))
        .map((line) => line.slice('Path = '.length))
        .filter((entry) => path.resolve(entry) !== path.resolve(artifact))
      assertSafeArchiveEntries(entries)
      execFileSync(sevenZip, ['x', '-y', `-o${extraction}`, artifact], { stdio: 'ignore' })
      const nested = []
      const visit = async (directory) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const candidate = path.join(directory, entry.name)
          if (entry.isDirectory()) await visit(candidate)
          else if (entry.isFile() && entry.name === target.nsisPayload) nested.push(candidate)
        }
      }
      await visit(extraction)
      assert.equal(nested.length, 1, 'Expected one x64 application payload in NSIS installer')
      execFileSync(sevenZip, ['x', '-y', `-o${path.join(extraction, 'app')}`, nested[0]], {
        stdio: 'ignore'
      })
    } else {
      assert.fail(`Unsupported package artifact kind: ${kind}`)
    }
    const executable = await findPackagedExecutable(extraction, target)
    if (verifyExecutable) await verifyExecutable(executable)
    return runPackagedProbe(executable, root)
  } finally {
    if (mounted) execFileSync('hdiutil', ['detach', extraction], { stdio: 'ignore' })
  }
}

export async function verifyNativePackage(targetName, options = {}) {
  const root = options.root ?? process.cwd()
  const dist = path.join(root, 'dist')
  const target = getPackageTarget(targetName)
  assertNativeHost(target, options.host)

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const sourceIdentity = options.sourceIdentity ?? readSourceIdentity()
  const entries = await readdir(dist)
  const artifacts = selectPackageArtifacts(entries, target, packageJson.version)

  await Promise.all(
    artifacts.map(async (artifact) => {
      const stats = await lstat(path.join(dist, artifact))
      assert.ok(stats.isFile() && !stats.isSymbolicLink(), `Invalid package artifact: ${artifact}`)
      assert.ok(stats.size > 0, `Empty package artifact: ${artifact}`)
    })
  )

  const executable = path.join(dist, target.unpackedDirectory, ...target.executable)
  const executableStats = await lstat(executable)
  assert.ok(executableStats.isFile() && !executableStats.isSymbolicLink(), 'Invalid packaged executable')
  if (options.verifyExecutable) await options.verifyExecutable(executable)

  const result = runPackagedProbe(executable, root)

  assert.equal(result.platform, target.platform)
  assert.equal(result.arch, target.arch)
  assert.equal(result.electron, packageJson.devDependencies.electron)
  assert.match(result.abi, /^\d+$/)
  assert.equal(result.desktopName, packageJson.desktopName)
  assert.equal(result.packageVersion, packageJson.version)
  assertReleaseBuildIdentity(result.buildIdentity, sourceIdentity, packageJson.version)
  assertReleaseBuildIdentity(result.rendererBuildIdentity, sourceIdentity, packageJson.version)
  assert.equal(result.rendererBundleNoncesValid, true)
  assert.equal(result.noSandboxRejected, true)
  assert.deepEqual(result.nativeModules, {
    nodeHid: 'function',
    usb: 'function',
    trezorUsb: 'object',
    ledger: Array(3).fill('function')
  })
  assert.deepEqual(result.versions, {
    nodeHid: packageJson.dependencies['node-hid'],
    usb: packageLock.packages['node_modules/usb'].version,
    ledger: {
      '@ledgerhq/hw-app-eth': packageJson.dependencies['@ledgerhq/hw-app-eth'],
      '@ledgerhq/hw-transport': packageJson.dependencies['@ledgerhq/hw-transport'],
      '@ledgerhq/hw-transport-node-hid-noevents':
        packageJson.dependencies['@ledgerhq/hw-transport-node-hid-noevents']
    }
  })
  assert.equal(result.signerSecretRoundTrip, true)
  assert.equal(result.signerTamperingRejected, true)
  assert.equal(result.osSignerProtection.available, false)
  assert.equal(
    result.osSignerProtection.backend,
    target.platform === 'linux' ? 'basic_text' : target.platform === 'win32' ? 'windows_dpapi' : 'unsupported'
  )
  assert.equal(result.osSignerProtection.state, target.platform === 'darwin' ? 'unsupported' : 'unavailable')
  assert.equal(result.osSignerProtection.failClosed, true)
  if (target.platform === 'linux') assert.ok(result.osSignerProtection.linuxBackendQueries > 0)
  else assert.equal(result.osSignerProtection.linuxBackendQueries, 0)
  assert.deepEqual(result.runtime, {
    ethers: packageJson.dependencies.ethers,
    ethersBrowserProvider: 'function',
    siweDomain: 'example.com',
    zod: packageJson.dependencies.zod,
    zodUnsafeIntegerAccepted: false,
    tarFsExtract: 'function',
    walletAddress: '0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f',
    fetchProbe: { runtime: 'native' },
    esmModuleExports: result.runtime.esmModuleExports
  })
  assert.ok(result.runtime.esmModuleExports.every((exports) => exports > 0))

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), `wren-${targetName}-`))
  try {
    for (const [index, artifact] of artifacts.entries()) {
      const artifactResult = await probeArtifact(
        path.join(dist, artifact),
        target.artifacts[index].kind,
        target,
        root,
        temporaryRoot,
        options.verifyExecutable
      )
      assert.deepEqual(artifactResult, result, `${artifact} payload differs from unpacked package output`)
    }
  } finally {
    await removeTemporaryPackageRoot(temporaryRoot)
  }

  return { artifacts, result, target }
}
