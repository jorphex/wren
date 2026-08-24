import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyNativePackage } from './package-verification.mjs'

export function assertAdHocSignatureDetails(details) {
  assert.match(details, /^Identifier=io\.github\.jorphex\.wren$/m, 'Unexpected macOS application identifier')
  assert.match(details, /^Signature=adhoc$/m, 'macOS preview must use an ad-hoc signature')
  assert.match(details, /^TeamIdentifier=not set$/m, 'macOS preview must not contain an Apple Team ID')
  assert.doesNotMatch(details, /^Authority=/m, 'macOS preview must not contain a signing authority')
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  assert.ifError(result.error)
  return result
}

export function verifyMacPreviewExecutable(executable) {
  const app = path.dirname(path.dirname(path.dirname(executable)))
  const verification = run('codesign', ['--verify', '--deep', '--strict', app])
  assert.equal(
    verification.status,
    0,
    `Invalid macOS ad-hoc code seal:\n${verification.stdout}${verification.stderr}`
  )

  const display = run('codesign', ['--display', '--verbose=4', app])
  assert.equal(display.status, 0, `Could not inspect macOS code seal:\n${display.stdout}${display.stderr}`)
  assertAdHocSignatureDetails(`${display.stdout}\n${display.stderr}`)

  const gatekeeper = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
  assert.notEqual(gatekeeper.status, 0, 'Ad-hoc macOS preview unexpectedly passed Gatekeeper assessment')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2]
  if (!['mac-x64', 'mac-arm64'].includes(target)) {
    throw new Error('Usage: node scripts/verify-macos-preview.mjs <mac-x64|mac-arm64>')
  }
  const verified = await verifyNativePackage(target, { verifyExecutable: verifyMacPreviewExecutable })
  console.log(
    `Verified native ${target} runtime, archive payloads, ad-hoc code seals, absent Apple identity, and Gatekeeper rejection for ${verified.artifacts.join(', ')}`
  )
}
