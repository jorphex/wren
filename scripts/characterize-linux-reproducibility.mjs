import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  compareFileManifests,
  createFileManifest,
  nativeModuleManifest,
  parseSourceDateEpoch
} from './reproducibility.mjs'
import { readSourceIdentity } from './source-identity.mjs'

assert.equal(process.platform, 'linux', 'Linux reproducibility characterization requires Linux')
assert.equal(process.arch, 'x64', 'Linux reproducibility characterization requires x64')

const outputArgument = process.argv.indexOf('--output')
assert.ok(outputArgument === -1 || process.argv[outputArgument + 1], '--output requires a path')
const output = path.resolve(
  outputArgument === -1 ? 'reproducibility-report.json' : process.argv[outputArgument + 1]
)

const source = readSourceIdentity()
const epoch = parseSourceDateEpoch(
  execFileSync('git', ['show', '-s', '--format=%ct', source.commit], { encoding: 'utf8' }).trim()
)
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'wren-repro-'))
const worktrees = ['build-a', 'build-b'].map((name) => path.join(temporaryRoot, name))
const extracted = ['extract-a', 'extract-b'].map((name) => path.join(temporaryRoot, name))
const environment = {
  ...process.env,
  SOURCE_DATE_EPOCH: String(epoch),
  TZ: 'UTC',
  LANG: 'C',
  LC_ALL: 'C',
  npm_config_loglevel: 'error'
}

const run = (command, args, cwd, stdio = 'inherit') =>
  execFileSync(command, args, { cwd, env: environment, stdio })
const runNpm = (cwd, script) => run('npm', ['run', script], cwd)

async function selectOne(directory, predicate, description) {
  const matches = (await readdir(directory)).filter(predicate)
  assert.equal(matches.length, 1, `Expected one ${description}, found ${matches.length}`)
  return path.join(directory, matches[0])
}

async function build(index) {
  const worktree = worktrees[index]
  const extraction = extracted[index]
  run('git', ['worktree', 'add', '--detach', worktree, source.commit], process.cwd(), 'ignore')
  runNpm(worktree, 'setup:ci')
  for (const script of [
    'compile',
    'bundle',
    'package:linux:x64',
    'package:verify:linux',
    'sbom:linux',
    'sbom:verify:linux',
    'checksums:linux',
    'release:verify:linux'
  ]) {
    runNpm(worktree, script)
  }

  await mkdir(extraction)
  const appImage = await selectOne(
    path.join(worktree, 'dist'),
    (entry) => entry.endsWith('.AppImage'),
    'AppImage'
  )
  const deb = await selectOne(
    path.join(worktree, 'dist'),
    (entry) => entry.endsWith('_amd64.deb'),
    'amd64 deb'
  )
  run(appImage, ['--appimage-extract'], extraction, 'ignore')
  const debRoot = path.join(extraction, 'deb')
  await mkdir(debRoot)
  run('dpkg-deb', ['--extract', deb, debRoot], worktree, 'ignore')

  return {
    compiled: await createFileManifest(path.join(worktree, 'compiled')),
    bundle: await createFileManifest(path.join(worktree, 'bundle')),
    unpacked: await createFileManifest(path.join(worktree, 'dist', 'linux-unpacked')),
    appImagePayload: await createFileManifest(path.join(extraction, 'squashfs-root')),
    debPayload: await createFileManifest(debRoot),
    evidence: await createFileManifest(path.join(worktree, 'dist'))
  }
}

let succeeded = false
try {
  const builds = [await build(0), await build(1)]
  const layers = {}
  for (const layer of ['compiled', 'bundle', 'unpacked', 'appImagePayload', 'debPayload', 'evidence']) {
    layers[layer] = compareFileManifests(builds[0][layer], builds[1][layer])
  }
  layers.nativeModules = compareFileManifests(
    nativeModuleManifest(builds[0].unpacked),
    nativeModuleManifest(builds[1].unpacked)
  )
  const payloadReproducible = [
    'compiled',
    'bundle',
    'unpacked',
    'appImagePayload',
    'debPayload',
    'nativeModules'
  ].every((layer) => layers[layer].equal)
  const packageBytesReproducible = layers.evidence.equal
  const report = {
    schemaVersion: 1,
    source,
    environment: { SOURCE_DATE_EPOCH: String(epoch), TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
    payloadReproducible,
    packageBytesReproducible,
    reproducible: payloadReproducible && packageBytesReproducible,
    layers
  }
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(
    `Wrote reproducibility characterization to ${output}: payload=${payloadReproducible}, package-bytes=${packageBytesReproducible}`
  )
  succeeded = true
} finally {
  if (process.env.WREN_REPRO_KEEP !== '1') {
    for (const worktree of worktrees) {
      try {
        run('git', ['worktree', 'remove', '--force', worktree], process.cwd(), 'ignore')
      } catch {
        // The worktree may not have been created if an earlier build failed.
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true })
  } else if (!succeeded) {
    console.error(`Preserved failed reproducibility worktrees at ${temporaryRoot}`)
  }
}
