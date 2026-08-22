import assert from 'node:assert/strict'
import test from 'node:test'
import { releaseSbomSerial } from '../../scripts/sbom-identity.mjs'

test('uses the same SBOM identity for LF and CRLF lockfiles', () => {
  const lf = '{\n  "name": "wren",\n  "packages": {}\n}\n'
  const crlf = lf.replaceAll('\n', '\r\n')
  const identity = (source) =>
    releaseSbomSerial({
      name: 'wren',
      version: '0.1.3',
      sourceCommit: 'a'.repeat(40),
      packageLock: JSON.parse(source)
    })

  assert.equal(identity(lf), identity(crlf))
  assert.match(identity(lf), /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
