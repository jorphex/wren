import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertNativeHost,
  assertSafeArchiveEntries,
  getPackageTarget,
  selectPackageArtifacts
} from '../../scripts/package-verification.mjs'
import { assertAdHocSignatureDetails } from '../../scripts/verify-macos-preview.mjs'

test('accepts only an ad-hoc macOS application identity without an Apple authority', () => {
  const details = [
    'Executable=/Volumes/Wren/Wren.app/Contents/MacOS/Wren',
    'Identifier=io.github.jorphex.wren',
    'Signature=adhoc',
    'TeamIdentifier=not set'
  ].join('\n')
  assert.doesNotThrow(() => assertAdHocSignatureDetails(details))
  assert.throws(() =>
    assertAdHocSignatureDetails(details.replace('Signature=adhoc', 'Signature=Developer ID'))
  )
  assert.throws(() => assertAdHocSignatureDetails(`${details}\nAuthority=Developer ID Application: Example`))
  assert.throws(() =>
    assertAdHocSignatureDetails(details.replace('TeamIdentifier=not set', 'TeamIdentifier=TEAM'))
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
