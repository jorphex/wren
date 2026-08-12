import assert from 'node:assert/strict'
import test from 'node:test'
import { npmCliInvocation } from '../../scripts/toolchain.mjs'

test('runs the npm CLI through Node without relying on platform command shims', () => {
  assert.deepEqual(npmCliInvocation('/runtime/node.exe', 'C:\\npm\\npm-cli.js'), {
    executable: '/runtime/node.exe',
    args: ['C:\\npm\\npm-cli.js', '--version']
  })
  assert.throws(() => npmCliInvocation('/runtime/node', ''), /run this check through npm/)
})
