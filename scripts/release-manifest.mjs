import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function releaseArtifactNames(version, { includeMacos = false, includeWindows = false } = {}) {
  const artifacts = [`Wren-${version}.AppImage`, `wren_${version}_amd64.deb`]
  if (includeWindows) artifacts.push(`Wren-Setup-${version}-unsigned-x64.exe`)
  if (includeMacos) {
    artifacts.push(
      `Wren-${version}-macos-x64-unnotarized.dmg`,
      `Wren-${version}-macos-arm64-unnotarized.dmg`
    )
  }
  artifacts.push('wren.cdx.json')
  return artifacts.sort()
}

async function digestFile(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

async function assertReleaseFile(file) {
  const stats = await lstat(file)
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `Invalid release artifact: ${path.basename(file)}`)
  assert.ok(stats.size > 0, `Empty release artifact: ${path.basename(file)}`)
}

export async function writeReleaseChecksums({
  dist,
  version,
  includeMacos = false,
  includeWindows = false
}) {
  const artifacts = releaseArtifactNames(version, { includeMacos, includeWindows })
  const lines = []
  for (const artifact of artifacts) {
    const artifactPath = path.join(dist, artifact)
    await assertReleaseFile(artifactPath)
    lines.push(`${await digestFile(artifactPath)}  ${artifact}`)
  }
  await writeFile(path.join(dist, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o600 })
  return artifacts
}

export async function verifyReleaseChecksums({
  dist,
  version,
  includeMacos = false,
  includeWindows = false
}) {
  const expected = new Set(releaseArtifactNames(version, { includeMacos, includeWindows }))
  const manifest = await readFile(path.join(dist, 'SHA256SUMS'), 'utf8')
  assert.ok(manifest.endsWith('\n'), 'Checksum manifest must end with a newline')
  const lines = manifest.trim().split('\n')
  assert.equal(lines.length, expected.size, 'Checksum manifest has an unexpected entry count')

  const seen = new Set()
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line)
    assert.ok(match, 'Invalid checksum manifest entry')
    const [, expectedDigest, artifact] = match
    assert.ok(expected.has(artifact), `Checksum manifest references unexpected artifact: ${artifact}`)
    assert.ok(!seen.has(artifact), `Checksum manifest repeats artifact: ${artifact}`)
    seen.add(artifact)

    const artifactPath = path.join(dist, artifact)
    await assertReleaseFile(artifactPath)
    assert.equal(await digestFile(artifactPath), expectedDigest, `Checksum mismatch: ${artifact}`)
  }

  assert.deepEqual(seen, expected, 'Checksum manifest is incomplete')
  return [...expected].sort()
}
