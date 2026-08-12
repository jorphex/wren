import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  compareFileManifests,
  createFileManifest,
  nativeModuleManifest,
  parseSourceDateEpoch
} from '../../scripts/reproducibility.mjs'

test('accepts only safe positive source epochs', () => {
  assert.equal(parseSourceDateEpoch('1786509650'), 1786509650)
  for (const value of [undefined, '', '0', '-1', '1.5', 'abc', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(() => parseSourceDateEpoch(value), /SOURCE_DATE_EPOCH/)
  }
})

test('compares generated file contents, modes, paths, and symlinks deterministically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wren-repro-test-'))
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  try {
    for (const directory of [left, right]) {
      await mkdir(path.join(directory, 'native'), { recursive: true })
      await writeFile(path.join(directory, 'app.js'), 'same\n', { mode: 0o600 })
      await writeFile(path.join(directory, 'native', 'addon.node'), 'native\n', { mode: 0o600 })
      await symlink('app.js', path.join(directory, 'current'))
    }
    const leftManifest = await createFileManifest(left)
    const rightManifest = await createFileManifest(right)
    assert.deepEqual(compareFileManifests(leftManifest, rightManifest), {
      equal: true,
      differences: [],
      entryCount: 4
    })
    assert.deepEqual(
      nativeModuleManifest(leftManifest).map((entry) => entry.path),
      ['native/addon.node']
    )

    await writeFile(path.join(right, 'app.js'), 'changed\n', { mode: 0o600 })
    const changed = compareFileManifests(leftManifest, await createFileManifest(right))
    assert.equal(changed.equal, false)
    assert.deepEqual(
      changed.differences.map((difference) => difference.path),
      ['app.js']
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
