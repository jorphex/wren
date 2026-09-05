# Migration fixtures

These JSON files are synthetic persisted-state inputs for application-level
migration tests. They are test data, not sample profiles.

## Safety contract

Every fixture must declare:

- `metadata.formatVersion: 1`;
- `metadata.synthetic: true`;
- a non-empty `metadata.title`;
- `metadata.sourceVersion` equal to `state.main._version`.

Validation rejects malformed objects, future versions, secret-shaped keys and
values, raw or extended private-key-shaped values, mnemonics, encrypted signer
payloads, and credential-bearing URLs. Never copy a real profile, signer file,
account history, RPC credential, or device identifier here.

## Current coverage

The test validates these fixtures individually:

- `v3-pre-cross-chain-state.json` — crosses the raw gas/connection and
  account/address boundaries.
- `v12-wallet-state.json` — representative application migration.
- `v37-network-state.json` — network migration with custom state.
- `v41-current-state.json` — historical boundary name; it does not claim that
  version 41 is current.
- `v52-pylon-network-state.json` — provider preset migration.
- `v68-release-boundary-state.json` — the published Wren 0.1.2 schema
  boundary, including its legacy Ethereum label and internal-origin records.
- `v69-safe-current-state.json` — previous safe profile coverage with contact
  provenance, dapp guardrails, opt-in recent recipients, and
  metadata-minimized Companion credentials.

The test loads each fixture through the application state initializer from a
temporary mode-`0600` persistence envelope. It verifies migration, reload
stability, and, where applicable, idempotence. The temporary profile and its
files are removed after the test.

Run the focused test with:

```sh
npx jest --runInBand --env=node test/main/store/migrate/persistedState.test.js
```

## Maintenance procedure

When a new migration needs coverage, add or update the smallest representative
synthetic fixture that exercises the boundary. Keep the source version in the
metadata and state aligned. Use stable placeholder accounts and endpoints; do
not add real credentials or secret-shaped data. Add assertions to
`test/main/store/migrate/persistedState.test.js` when the migration has a
specific invariant to preserve.

Review the fixture diff and run the focused test. Also review the fixture’s
migration assertions. Passing validation alone is
not enough.
