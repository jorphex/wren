# Migration fixtures

**Purpose:** synthetic persisted-state inputs for application-level migration tests.

**Status:** every JSON fixture declares format version 1, `synthetic: true`, a title, and a source
version matching `state.main._version`. Validation rejects malformed fixtures, future versions,
secret-shaped keys and values, mnemonics, encrypted signer payloads, and credential-bearing URLs.
It is a guardrail, not a substitute for fixture-diff review.

**Coverage:** `v3-pre-cross-chain-state.json`, `v12-wallet-state.json`,
`v37-network-state.json`, `v41-current-state.json`, `v52-pylon-network-state.json`, and
`v64-safe-current-state.json` are validated individually. The migration tests load them through the
application state initializer from a temporary mode-`0600` persistence envelope and verify migration,
reload stability, and—where applicable—idempotence. The v3 fixture crosses the raw gas/connection and
account/address boundaries; v64 is the current no-migration invariant. The v41 filename is a historical
boundary name, not a claim that 41 remains current.

Never copy a real profile, signer file, account history, RPC credential, or device identifier here.
For a new migration, add or update the smallest representative synthetic fixture that exercises it.
