import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve('dist')
const entries = await readdir(dist)
const selectOne = (description, predicate) => {
  const matches = entries.filter(predicate)
  assert.equal(matches.length, 1, `Expected one ${description}, found ${matches.length}`)
  return matches[0]
}
const artifacts = [
  selectOne('AppImage', (entry) => entry.endsWith('.AppImage')),
  selectOne('amd64 deb', (entry) => entry.endsWith('_amd64.deb')),
  selectOne('SBOM', (entry) => entry === 'wren.cdx.json')
].sort()

const lines = []
for (const artifact of artifacts) {
  const artifactPath = path.join(dist, artifact)
  const stats = await lstat(artifactPath)
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `Invalid release artifact: ${artifact}`)

  const digest = createHash('sha256')
  for await (const chunk of createReadStream(artifactPath)) digest.update(chunk)
  lines.push(`${digest.digest('hex')}  ${artifact}`)
}

await writeFile(path.join(dist, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o600 })
console.log(`Checksummed ${artifacts.join(', ')}`)
