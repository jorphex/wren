import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'

const iconSpecs = [
  { name: 'Icon.png', size: 24 },
  { name: 'Icon@2x.png', size: 48 },
  { name: 'IconTemplate.png', size: 24, template: true },
  { name: 'IconTemplate@2x.png', size: 48, template: true },
  { name: 'LinuxTray.png', size: 24 },
  { name: 'LinuxTray@2x.png', size: 48 }
]

for (const { name, size, template = false } of iconSpecs) {
  const source = await readFile(path.resolve('main/windows', name))
  const compiled = await readFile(path.resolve('compiled/main/windows', name))
  assert.deepEqual(compiled, source, `${name} was not copied intact`)

  const icon = PNG.sync.read(source)
  assert.equal(icon.width, size, `${name} must be ${size}px wide`)
  assert.equal(icon.height, size, `${name} must be ${size}px high`)

  const alpha = []
  for (let offset = 3; offset < icon.data.length; offset += 4) alpha.push(icon.data[offset])

  const visiblePixels = alpha.filter((value) => value >= 32).length
  const opaquePixels = alpha.filter((value) => value >= 128).length
  const transparentPixels = alpha.filter((value) => value === 0).length
  const pixelCount = icon.width * icon.height

  assert.ok(visiblePixels >= pixelCount * 0.1, `${name} has too little visible artwork`)
  assert.ok(opaquePixels >= pixelCount * 0.08, `${name} is effectively transparent`)
  assert.ok(transparentPixels >= pixelCount * 0.5, `${name} must retain a transparent background`)

  if (template) {
    for (let offset = 0; offset < icon.data.length; offset += 4) {
      assert.equal(icon.data[offset], 0, `${name} must be monochrome`)
      assert.equal(icon.data[offset + 1], 0, `${name} must be monochrome`)
      assert.equal(icon.data[offset + 2], 0, `${name} must be monochrome`)
    }
  }
}

console.log('Cross-platform tray icons verified')
