import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  releaseArtifactNames,
  verifyReleaseChecksums,
  writeReleaseChecksums
} from '../../scripts/release-manifest.mjs'

const version = '0.1.3'

async function withReleaseFiles(run) {
  const dist = await mkdtemp(path.join(tmpdir(), 'wren-release-manifest-'))
  try {
    for (const artifact of releaseArtifactNames(version, { includeMacos: true, includeWindows: true })) {
      await writeFile(path.join(dist, artifact), `fixture:${artifact}`)
    }
    await run(dist)
  } finally {
    await rm(dist, { recursive: true, force: true })
  }
}

test('writes and verifies one manifest across Linux, Windows, and macOS release files', async () => {
  await withReleaseFiles(async (dist) => {
    const options = { dist, version, includeMacos: true, includeWindows: true }
    const written = await writeReleaseChecksums(options)
    assert.deepEqual(written, releaseArtifactNames(version, options))
    assert.deepEqual(await verifyReleaseChecksums(options), written)
  })
})

test('rejects missing, unexpected, repeated, and modified checksum entries', async () => {
  await withReleaseFiles(async (dist) => {
    const options = { dist, version, includeMacos: true, includeWindows: true }
    await writeReleaseChecksums(options)
    const manifestPath = path.join(dist, 'SHA256SUMS')
    const original = await readFile(manifestPath, 'utf8')

    await writeFile(manifestPath, original.replace(/^[^\n]+\n/, ''))
    await assert.rejects(
      verifyReleaseChecksums(options),
      /unexpected entry count/
    )

    const [first] = original.trim().split('\n')
    await writeFile(manifestPath, `${first}\n${first}\n${first}\n${first}\n${first}\n${first}\n`)
    await assert.rejects(verifyReleaseChecksums(options), /repeats artifact/)

    await writeFile(manifestPath, original.replace('Wren-0.1.3.AppImage', 'unexpected.exe'))
    await assert.rejects(
      verifyReleaseChecksums(options),
      /unexpected artifact/
    )

    await writeFile(manifestPath, original)
    await writeFile(path.join(dist, 'Wren-0.1.3.AppImage'), 'modified')
    await assert.rejects(verifyReleaseChecksums(options), /Checksum mismatch/)
  })
})
