import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve('dist')
const entries = await readdir(dist)
const selectOne = (description, predicate) => {
  const matches = entries.filter(predicate)
  assert.equal(matches.length, 1, `Expected one ${description}, found ${matches.length}`)
  return matches[0]
}
const expected = new Set([
  selectOne('AppImage', (entry) => entry.endsWith('.AppImage')),
  selectOne('amd64 deb', (entry) => entry.endsWith('_amd64.deb')),
  selectOne('SBOM', (entry) => entry === 'wren.cdx.json')
])

const lines = (await readFile(path.join(dist, 'SHA256SUMS'), 'utf8')).trim().split('\n')
assert.equal(lines.length, expected.size, 'Checksum manifest has an unexpected entry count')

const seen = new Set()
for (const line of lines) {
  const match = /^([0-9a-f]{64})\s{2}([A-Za-z0-9._-]+)$/.exec(line)
  assert.ok(match, 'Invalid checksum manifest entry')
  const [, expectedDigest, artifact] = match
  assert.ok(expected.has(artifact), `Checksum manifest references unexpected artifact: ${artifact}`)
  assert.ok(!seen.has(artifact), `Checksum manifest repeats artifact: ${artifact}`)
  seen.add(artifact)

  const artifactPath = path.join(dist, artifact)
  const stats = await lstat(artifactPath)
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `Invalid release artifact: ${artifact}`)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(artifactPath)) digest.update(chunk)
  assert.equal(digest.digest('hex'), expectedDigest, `Checksum mismatch: ${artifact}`)
}

assert.deepEqual(seen, expected, 'Checksum manifest is incomplete')
console.log(`Verified checksums for ${[...expected].sort().join(', ')}`)
