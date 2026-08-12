import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertNativeHost,
  getPackageTarget,
  packageTargets,
  selectPackageArtifacts
} from '../../scripts/package-verification.mjs'

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
      ['Wren-0.1.0-arm64.AppImage', 'Wren-0.1.0-arm64.tar.gz'],
      getPackageTarget('linux-arm64'),
      '0.1.0'
    ),
    ['Wren-0.1.0-arm64.AppImage', 'Wren-0.1.0-arm64.tar.gz']
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
    selectPackageArtifacts(['Wren Setup 0.1.0.exe'], getPackageTarget('windows-x64'), '0.1.0'),
    ['Wren Setup 0.1.0.exe']
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
