import { generatePeerAuthKeyPair, peerAuthClientBundleFingerprint } from '../../../../../main/api/peerAuth'
import migration from '../../../../../main/store/migrate/migrations/68'
import migrations from '../../../../../main/store/migrate'
import { createState } from '../setup'

function transportCredential() {
  const control = generatePeerAuthKeyPair()
  const page = generatePeerAuthKeyPair()
  const publicKeys = { control: control.publicKey, page: page.publicKey }
  return {
    protocolVersion: 3 as const,
    installationId: '7a86842f-7c01-4d0d-b0f7-fc04e0acfd8f',
    browser: 'firefox' as const,
    extensionId: '4be0643f-1d98-573b-97cd-ca98a65347dd',
    publicKeys,
    fingerprint: peerAuthClientBundleFingerprint(publicKeys),
    pairedAt: 1000
  }
}

test('strips browser transport metadata while preserving the signed Companion principal', () => {
  const state = createState(67)
  const credential = transportCredential()
  state.main['extensionCredentials'] = { [credential.fingerprint]: credential }
  state.main['origins'] = {
    companion: { provenance: 'companion', sourceId: credential.fingerprint }
  }

  const migrated = migration.migrate(state)

  expect(migrated.main.extensionCredentials).toEqual({
    [credential.fingerprint]: {
      protocolVersion: 3,
      installationId: credential.installationId,
      publicKeys: credential.publicKeys,
      fingerprint: credential.fingerprint,
      pairedAt: credential.pairedAt
    }
  })
  expect(migrated.main.origins).toEqual(state.main.origins)
  expect(JSON.stringify(migrated.main.extensionCredentials)).not.toContain('extensionId')
  expect(JSON.stringify(migrated.main.extensionCredentials)).not.toContain('firefox')
  expect(migrations.apply(state).main._version).toBe(69)
})

test('drops malformed or incorrectly keyed credentials and leaves invalid state unchanged', () => {
  const state = createState(67)
  const credential = transportCredential()
  state.main['extensionCredentials'] = {
    wrong: credential,
    [credential.fingerprint]: { ...credential, fingerprint: 'x'.repeat(43) }
  }

  expect(migration.migrate(state).main.extensionCredentials).toEqual({})
  expect(migration.migrate(null)).toBeNull()
})
