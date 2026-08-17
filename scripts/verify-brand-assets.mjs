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

const getWarmMarkMetrics = (png) => {
  const bounds = { minX: png.width, minY: png.height, maxX: -1, maxY: -1 }
  let farthestFromCenter = 0
  let pixelCount = 0
  let xTotal = 0
  let cropSafePixelCount = 0
  const pixelCountByThird = [0, 0, 0]
  const centerX = (png.width - 1) / 2
  const centerY = (png.height - 1) / 2

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4
      const [red, green, blue] = png.data.subarray(offset, offset + 3)
      if (red > 80 && red - green > 18 && green - blue > 8) {
        bounds.minX = Math.min(bounds.minX, x)
        bounds.minY = Math.min(bounds.minY, y)
        bounds.maxX = Math.max(bounds.maxX, x)
        bounds.maxY = Math.max(bounds.maxY, y)
        farthestFromCenter = Math.max(farthestFromCenter, Math.hypot(x - centerX, y - centerY))
        pixelCount += 1
        xTotal += x
        pixelCountByThird[Math.min(2, Math.floor((x / png.width) * 3))] += 1
        if (y >= 60 && y < png.height - 60) cropSafePixelCount += 1
      }
    }
  }

  assert.ok(bounds.maxX >= 0, 'The generated artwork must contain the warm full-color mark')
  return {
    ...bounds,
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
    farthestFromCenter,
    pixelCount,
    pixelCountByThird,
    meanX: xTotal / pixelCount,
    cropSafePixelRatio: cropSafePixelCount / pixelCount
  }
}

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
assert.ok(markWidth >= 424 && markWidth <= 428, `${canonicalPath} app mark must retain its 120% scale`)
assert.ok(markHeight >= 269 && markHeight <= 272, `${canonicalPath} app mark height is out of range`)
assert.ok(
  markBounds.minX >= 45 && markBounds.maxX <= 480,
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

const profilePath = 'asset/social/wren-profile-400.png'
const profile = await readFile(path.resolve(profilePath))
const profilePng = PNG.sync.read(profile)
const profileMark = getWarmMarkMetrics(profilePng)
assert.equal(profilePng.width, 400, `${profilePath} must be 400px wide`)
assert.equal(profilePng.height, 400, `${profilePath} must be 400px high`)
assert.ok(profile.byteLength < 2 * 1024 * 1024, `${profilePath} must remain below X's 2 MB profile limit`)
assert.ok(profileMark.width >= 247 && profileMark.width <= 251, `${profilePath} mark width is out of range`)
assert.ok(
  profileMark.height >= 156 && profileMark.height <= 160,
  `${profilePath} mark height is out of range`
)
assert.ok(
  profileMark.minY >= 118 && profileMark.maxY <= 279,
  `${profilePath} mark must retain its lowered optical center`
)
assert.ok(
  profileMark.farthestFromCenter <= 160,
  `${profilePath} full-color mark must fit inside the centered 320px crop-safe circle`
)

const headerMasterPath = 'asset/social/source/wren-night-rounds-v1.png'
const headerMasterPng = PNG.sync.read(await readFile(path.resolve(headerMasterPath)))
assert.equal(headerMasterPng.width, 2172, `${headerMasterPath} must retain its native 3:1 width`)
assert.equal(headerMasterPng.height, 724, `${headerMasterPath} must retain its native 3:1 height`)

const headerPath = 'asset/social/wren-x-header-1500x500.png'
const header = await readFile(path.resolve(headerPath))
const headerPng = PNG.sync.read(header)
const headerMark = getWarmMarkMetrics(headerPng)
assert.equal(headerPng.width, 1500, `${headerPath} must be 1500px wide`)
assert.equal(headerPng.height, 500, `${headerPath} must be 500px high`)
assert.ok(header.byteLength < 5 * 1024 * 1024, `${headerPath} must remain below X's 5 MB header limit`)
assert.ok(
  headerMark.pixelCountByThird[0] >= 4000,
  `${headerPath} left third must retain the gate and secondary lantern detail`
)
assert.ok(
  headerMark.pixelCountByThird[1] >= 1500,
  `${headerPath} middle third must retain the path and distant lantern detail`
)
assert.ok(
  headerMark.pixelCountByThird[2] >= 22000,
  `${headerPath} right third must retain the detailed wren and main lantern focal point`
)
assert.ok(headerMark.pixelCount >= 30000, `${headerPath} must retain the panorama's warm focal content`)
assert.ok(
  headerMark.meanX >= 1050,
  `${headerPath} hero focal content must remain right-weighted and clear of X's profile overlay`
)
assert.ok(
  headerMark.cropSafePixelRatio >= 0.95,
  `${headerPath} must retain at least 95% of its warm focal content after X's possible vertical crop`
)

console.log('Coherent Wren app icon and social assets verified')
