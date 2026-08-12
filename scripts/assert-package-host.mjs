import assert from 'node:assert/strict'

const [platform, arch] = process.argv.slice(2)
assert.ok(platform && arch, 'Usage: node scripts/assert-package-host.mjs <platform> <arch>')
assert.equal(process.platform, platform, `Package build requires ${platform}`)
assert.equal(process.arch, arch, `Package build requires ${arch}`)
