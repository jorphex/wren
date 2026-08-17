import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'

const iconSpecs = [
  { name: 'Icon.png', size: 24 },
  { name: 'Icon@2x.png', size: 48 },
  { name: 'IconTemplate.png', size: 24, template: true },
  { name: 'IconTemplate@2x.png', size: 48, template: true },
  { name: 'LinuxTray.png', size: 24, linux: true },
  { name: 'LinuxTray@2x.png', size: 48, linux: true }
]

for (const { name, size, template = false, linux = false } of iconSpecs) {
  const source = await readFile(path.resolve('main/windows', name))
  const compiled = await readFile(path.resolve('compiled/main/windows', name))
  assert.deepEqual(compiled, source, `${name} was not copied intact`)

  const icon = PNG.sync.read(source)
  assert.equal(icon.width, size, `${name} must be ${size}px wide`)
  assert.equal(icon.height, size, `${name} must be ${size}px high`)

  const alpha = []
  const visibleBounds = { minX: size, minY: size, maxX: -1, maxY: -1 }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = icon.data[(y * size + x) * 4 + 3]
      alpha.push(value)
      if (value >= 32) {
        visibleBounds.minX = Math.min(visibleBounds.minX, x)
        visibleBounds.minY = Math.min(visibleBounds.minY, y)
        visibleBounds.maxX = Math.max(visibleBounds.maxX, x)
        visibleBounds.maxY = Math.max(visibleBounds.maxY, y)
      }
    }
  }

  const visiblePixels = alpha.filter((value) => value >= 32).length
  const opaquePixels = alpha.filter((value) => value >= 128).length
  const transparentPixels = alpha.filter((value) => value === 0).length
  const pixelCount = icon.width * icon.height

  assert.ok(visiblePixels >= pixelCount * 0.1, `${name} has too little visible artwork`)
  assert.ok(opaquePixels >= pixelCount * 0.08, `${name} is effectively transparent`)
  assert.ok(transparentPixels >= pixelCount * 0.5, `${name} must retain a transparent background`)

  if (linux) {
    const visibleWidth = visibleBounds.maxX - visibleBounds.minX + 1
    const visibleHeight = visibleBounds.maxY - visibleBounds.minY + 1
    assert.ok(visibleWidth >= size * 0.9, `${name} must fill its logical panel width`)
    assert.ok(visibleHeight >= size * 0.6, `${name} must retain its optical panel height`)
    assert.ok(visibleBounds.minX >= 1, `${name} must retain a left raster margin`)
    assert.ok(visibleBounds.maxX <= size - 2, `${name} must retain a right raster margin`)
  }

  if (template) {
    for (let offset = 0; offset < icon.data.length; offset += 4) {
      assert.equal(icon.data[offset], 0, `${name} must be monochrome`)
      assert.equal(icon.data[offset + 1], 0, `${name} must be monochrome`)
      assert.equal(icon.data[offset + 2], 0, `${name} must be monochrome`)
    }
  }
}

console.log('Cross-platform tray icons verified')
