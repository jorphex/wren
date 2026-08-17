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

const markBounds = { minX: canonicalPng.width, minY: canonicalPng.height, maxX: -1, maxY: -1 }
for (let y = 0; y < canonicalPng.height; y += 1) {
  for (let x = 0; x < canonicalPng.width; x += 1) {
    const offset = (y * canonicalPng.width + x) * 4
    const pixel = canonicalPng.data.subarray(offset, offset + 4)
    if (pixel[3] > 0 && Math.max(pixel[0], pixel[1], pixel[2]) > 80) {
      markBounds.minX = Math.min(markBounds.minX, x)
      markBounds.minY = Math.min(markBounds.minY, y)
      markBounds.maxX = Math.max(markBounds.maxX, x)
      markBounds.maxY = Math.max(markBounds.maxY, y)
    }
  }
}

const markWidth = markBounds.maxX - markBounds.minX + 1
const markHeight = markBounds.maxY - markBounds.minY + 1
assert.ok(markWidth >= 390 && markWidth <= 394, `${canonicalPath} app mark must retain its 110% scale`)
assert.ok(markHeight >= 247 && markHeight <= 250, `${canonicalPath} app mark height is out of range`)
assert.ok(
  markBounds.minX >= 60 && markBounds.maxX <= 462,
  `${canonicalPath} app mark must retain safe taskbar side insets`
)

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
