import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'

const appIconPaths = [
  'asset/WrenIcon.png',
  'asset/png/WrenLogo512.png',
  'main/windows/AppIcon.png',
  'build/icons/512x512.png',
  'build/icons/icon.png',
  'asset/review/wren-brand-release-v1/wren-app-icon-512.png'
]

const [canonicalPath, ...copyPaths] = appIconPaths
const canonical = await readFile(path.resolve(canonicalPath))
const canonicalPng = PNG.sync.read(canonical)

assert.equal(canonicalPng.width, 512, `${canonicalPath} must be 512px wide`)
assert.equal(canonicalPng.height, 512, `${canonicalPath} must be 512px high`)

for (const copyPath of copyPaths) {
  const copy = await readFile(path.resolve(copyPath))
  const copyPng = PNG.sync.read(copy)
  assert.equal(copyPng.width, 512, `${copyPath} must be 512px wide`)
  assert.equal(copyPng.height, 512, `${copyPath} must be 512px high`)
  assert.deepEqual(copy, canonical, `${copyPath} must match the canonical generated app icon`)
}

const master = await readFile(path.resolve('asset/brand/wren-mark.svg'), 'utf8')
assert.match(master, /id="wren-silhouette"/, 'The brand master must define the shared silhouette')
assert.match(master, /id="wren-color"/, 'The brand master must define the full-color mark')

console.log('Coherent Wren app icon assets verified')
