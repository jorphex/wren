import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink, readdir } from 'node:fs/promises'
import path from 'node:path'

export function parseSourceDateEpoch(value) {
  assert.match(value ?? '', /^[1-9]\d*$/, 'SOURCE_DATE_EPOCH must be a positive integer')
  const epoch = Number(value)
  assert.ok(Number.isSafeInteger(epoch), 'SOURCE_DATE_EPOCH exceeds the safe integer range')
  return epoch
}

async function hashFile(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

export async function createFileManifest(root) {
  const entries = []
  const visit = async (directory, relativeDirectory = '') => {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const child of children) {
      const relative = path.posix.join(relativeDirectory, child.name)
      const absolute = path.join(directory, child.name)
      const stats = await lstat(absolute)
      const mode = stats.mode & 0o777
      if (stats.isDirectory()) {
        entries.push({ path: `${relative}/`, type: 'directory', mode })
        await visit(absolute, relative)
      } else if (stats.isSymbolicLink()) {
        entries.push({ path: relative, type: 'symlink', mode, target: await readlink(absolute) })
      } else if (stats.isFile()) {
        entries.push({
          path: relative,
          type: 'file',
          mode,
          size: stats.size,
          sha256: await hashFile(absolute)
        })
      } else {
        assert.fail(`Unsupported generated file type: ${relative}`)
      }
    }
  }
  await visit(root)
  return entries
}

export function compareFileManifests(left, right, limit = 100) {
  const leftByPath = new Map(left.map((entry) => [entry.path, entry]))
  const rightByPath = new Map(right.map((entry) => [entry.path, entry]))
  const paths = [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort()
  const differences = []
  for (const entryPath of paths) {
    const leftEntry = leftByPath.get(entryPath)
    const rightEntry = rightByPath.get(entryPath)
    if (JSON.stringify(leftEntry) !== JSON.stringify(rightEntry)) {
      if (differences.length < limit)
        differences.push({ path: entryPath, left: leftEntry, right: rightEntry })
    }
  }
  return {
    equal: differences.length === 0 && left.length === right.length,
    differences,
    entryCount: paths.length
  }
}

export function nativeModuleManifest(manifest) {
  return manifest.filter((entry) => entry.type === 'file' && entry.path.endsWith('.node'))
}
