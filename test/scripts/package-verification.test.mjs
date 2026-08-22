import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'
import {
  assertNativeHost,
  assertSafeArchiveEntries,
  getPackageTarget,
  packageTargets,
  removeTemporaryPackageRoot,
  selectPackageArtifacts
} from '../../scripts/package-verification.mjs'

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('cleans and source-binds local package output before invoking electron-builder', () => {
  assert.match(packageJson.scripts.build, /node scripts\/prepare-package\.mjs/)
  assert.ok(
    packageJson.scripts.build.indexOf('node scripts/prepare-package.mjs') <
      packageJson.scripts.build.indexOf('electron-builder')
  )
})

test('defines explicit native package layouts for every applicable target', () => {
  assert.deepEqual(Object.keys(packageTargets).sort(), [
    'linux-arm64',
    'linux-x64',
    'mac-arm64',
    'mac-x64',
    'windows-x64'
  ])
  assert.deepEqual(getPackageTarget('linux-x64').executable, ['wren'])
  assert.deepEqual(getPackageTarget('mac-arm64').executable, ['Wren.app', 'Contents', 'MacOS', 'Wren'])
  assert.deepEqual(getPackageTarget('windows-x64').executable, ['Wren.exe'])
})

test('selects the exact versioned Linux x64 package pair', () => {
  assert.deepEqual(
    selectPackageArtifacts(
      ['Wren-0.1.0.AppImage', 'wren_0.1.0_amd64.deb', 'wren.cdx.json'],
      getPackageTarget('linux-x64'),
      '0.1.0'
    ),
    ['Wren-0.1.0.AppImage', 'wren_0.1.0_amd64.deb']
  )
})

test('selects native macOS, Windows, and Linux arm64 artifacts', () => {
  assert.deepEqual(
    selectPackageArtifacts(
      ['Wren-0.1.0-arm64.AppImage', 'wren-0.1.0-arm64.tar.gz'],
      getPackageTarget('linux-arm64'),
      '0.1.0'
    ),
    ['Wren-0.1.0-arm64.AppImage', 'wren-0.1.0-arm64.tar.gz']
  )
  assert.deepEqual(
    selectPackageArtifacts(['Wren-0.1.0.dmg', 'Wren-0.1.0-mac.zip'], getPackageTarget('mac-x64'), '0.1.0'),
    ['Wren-0.1.0.dmg', 'Wren-0.1.0-mac.zip']
  )
  assert.deepEqual(
    selectPackageArtifacts(
      ['Wren-0.1.0-arm64.dmg', 'Wren-0.1.0-arm64-mac.zip'],
      getPackageTarget('mac-arm64'),
      '0.1.0'
    ),
    ['Wren-0.1.0-arm64.dmg', 'Wren-0.1.0-arm64-mac.zip']
  )
  assert.deepEqual(
    selectPackageArtifacts(['Wren-Setup-0.1.0-unsigned-x64.exe'], getPackageTarget('windows-x64'), '0.1.0'),
    ['Wren-Setup-0.1.0-unsigned-x64.exe']
  )
})

test('rejects missing, duplicate, stale, and unknown package outputs', () => {
  const target = getPackageTarget('linux-x64')
  assert.throws(() => selectPackageArtifacts([], target, '0.1.0'), /Expected one AppImage/)
  assert.throws(
    () =>
      selectPackageArtifacts(
        ['Wren-0.1.0.AppImage', 'Wren-0.1.0.AppImage', 'wren_0.1.0_amd64.deb'],
        target,
        '0.1.0'
      ),
    /Expected one AppImage, found 2/
  )
  assert.throws(
    () => selectPackageArtifacts(['Wren-0.0.9.AppImage', 'wren_0.0.9_amd64.deb'], target, '0.1.0'),
    /Expected one AppImage, found 0/
  )
  assert.throws(() => getPackageTarget('plan9-x64'), /Unknown package verification target/)
  assert.throws(() => getPackageTarget('__proto__'), /Unknown package verification target/)
})

test('requires a matching native host before executing the package', () => {
  const target = getPackageTarget('mac-arm64')
  assert.doesNotThrow(() => assertNativeHost(target, { platform: 'darwin', arch: 'arm64' }))
  assert.throws(() => assertNativeHost(target, { platform: 'linux', arch: 'arm64' }), /requires macOS/)
  assert.throws(() => assertNativeHost(target, { platform: 'darwin', arch: 'x64' }), /requires arm64/)
})

test('rejects archive entries that could escape their disposable extraction root', () => {
  assert.doesNotThrow(() => assertSafeArchiveEntries(['Wren/', 'Wren/resources/app.asar']))
  assert.throws(() => assertSafeArchiveEntries([]), /archive is empty/)
  assert.throws(() => assertSafeArchiveEntries(['/etc/passwd']), /Absolute package archive entry/)
  assert.throws(() => assertSafeArchiveEntries(['C:\\Windows\\system.ini']), /Drive-qualified/)
  assert.throws(() => assertSafeArchiveEntries(['Wren/../../outside']), /escapes extraction root/)
  assert.throws(() => assertSafeArchiveEntries(['Wren/evil\0name']), /null byte/)
})

test('retries cleanup when a native package executable is briefly locked', async () => {
  const calls = []
  await removeTemporaryPackageRoot('temporary-package-root', async (...args) => calls.push(args))

  assert.deepEqual(calls, [
    ['temporary-package-root', { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }]
  ])
})
