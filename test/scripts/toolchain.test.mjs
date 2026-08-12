import assert from 'node:assert/strict'
import test from 'node:test'
import { executableForPlatform } from '../../scripts/toolchain.mjs'

test('resolves command shims on Windows without changing Unix commands', () => {
  assert.equal(executableForPlatform('npm', 'win32'), 'npm.cmd')
  assert.equal(executableForPlatform('npm', 'linux'), 'npm')
  assert.equal(executableForPlatform('npm', 'darwin'), 'npm')
})
