# Signer And Platform Support

## Status Definitions

- **Physical**: exercised on a real device with this fork.
- **Automated**: covered by unit or adapter tests, usually with mocks.
- **Implemented**: a code path exists but has not been regression-qualified for
  this fork.
- **Unsupported**: no maintained implementation is present.

These statuses describe available evidence, not a security certification.

Signer summaries also expose a deterministic `signingCapabilities` profile for
implemented transaction envelopes, typed-data versions, messages, address
display, and transport. That runtime profile routes wallet behavior; it does not
upgrade automated or implemented evidence to physical qualification.

## Current Matrix

| Signer or platform                 | Transport/package             | Evidence in this fork                                                                                                        | Release status                              |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Trezor Safe 7                      | USB through Trezor Connect    | Physical address, message, EIP-712, transaction, broadcast, rejection, and reconnect on Linux x64; automated bridge coverage | Workable, use at your own risk              |
| Trezor Model One                   | USB through Trezor Connect    | Physical address, message, hash-only EIP-712, rejection, and reconnect on firmware 1.13.1                                    | Qualified with limitations on Linux x64     |
| Other Trezor models                | USB through Trezor Connect    | Shared implementation and automated bridge coverage                                                                          | Implemented, not physically requalified     |
| Trezor Safe 7 Bluetooth            | Bluetooth                     | No Wren transport                                                                                                            | Unsupported                                 |
| Ledger                             | USB HID                       | Automated adapter/device coverage                                                                                            | Implemented, not physically requalified     |
| GridPlus Lattice1                  | Vendor SDK/network            | Automated adapter/device coverage                                                                                            | Implemented, not physically requalified     |
| Software seed/private key/keystore | Local encrypted signer worker | Live packaged import, unlock, signing, restart, and removal runs plus automated signer coverage                              | Qualified on Linux x64; legacy limits apply |
| Linux x64 AppImage and deb         | Electron package              | Automated package verification plus live fresh/migrated AppImage and deb-upgrade runs                                        | Current release target                      |
| macOS x64/arm64                    | Electron package              | Inherited build configuration only                                                                                           | Unverified and unsigned by this fork        |
| Windows x64                        | Electron package              | Inherited build configuration only                                                                                           | Unverified and unsigned by this fork        |
| Linux arm64, snap, tarball         | Electron package              | Legacy configuration only                                                                                                    | Not produced by current CI                  |

The `0.8.0` qualification exercised fresh Safe 7 pairing, full address display,
request rejection, personal signing, and structured EIP-712 review on an initial
candidate. After targeted transaction-state and balance-rendering fixes, the
post-fix candidate reused that isolated profile's trust and repeated physical
address verification, Base Sepolia transaction signing/broadcast, and USB
reconnect without a reload loop. Pairing event/response behavior also remains
covered by automated bridge tests.

Trezor Suite is not required for the verified Safe 7 USB flow. Running another
application that owns the device transport may cause contention. Bluetooth
communication through Trezor Suite is not exposed to Wren as a supported signer
transport.

Model One displays EIP-712 domain and message hashes rather than the structured
fields. Wren warns about this before typed-data and permit approval, so users
must verify every structured field in Wren before comparing the hashes on the
device. Strict Trezor safety checks also reject a transaction when the selected
account's derivation coin type does not match the signed network definition. For
example, Base Sepolia declares coin type 1 while Wren's standard Ethereum path
uses coin type 60. Wren leaves the device setting unchanged and reports the
request as unsigned. Use a network-matching account, or choose Prompt safety
checks in Trezor Suite only if you understand the mismatched coin-key risk.

## Manual Safe 7 Regression

Use a test-only account and a test network with no valuable assets.

1. Start from a packaged Linux x64 artifact and ensure no second Wren process is
   running.
2. Connect a Safe 7 over USB with current stable firmware. Record the firmware,
   Trezor Connect package version, OS, kernel, and artifact checksum.
3. Confirm Wren detects the device and pairing-code entry completes. Reconnect
   once and confirm the signer recovers without a reload loop.
4. Derive an expected Ethereum address and use on-device address verification.
   Compare the full device address with an independently recorded test address.
5. Sign a personal message and EIP-712 test fixture when supported. Verify each
   signature independently without using a production dapp.
6. On a test network, review and sign a zero-value self-transfer. Confirm chain,
   address, value, calldata, and fees on both Wren and the device before
   broadcasting.
7. Lock, disconnect, reconnect, and quit Wren. Confirm no request remains stuck
   and no plaintext secret appears in logs.

Any mismatch, blind-signing requirement, unexplained reload, or device-call loop
is a failed regression. Do not publish a support claim from a partial run.
Record release-candidate hardware results in the consolidated
[`QUALIFICATION.md`](QUALIFICATION.md) matrix.

## Other Signer Regression

For Ledger or Lattice, use the same safety constraints and record exact model,
firmware/app version, transport, derivation path, and test fixture. At minimum,
verify discovery, address display, personal signing, typed-data behavior,
EIP-1559 transaction signing, rejection/cancellation, disconnect/reconnect, and
application shutdown.

GridPlus pairings currently retain the legacy `Frame[-tag]` permission ID so
existing devices do not silently lose access during migration. Wren labels this
identifier as legacy in signer details; changing it requires a separately
qualified re-pairing migration.

Automated tests must not broadcast, access a physical device by default, or share
ports/profile data with an installed Wren instance.

## EIP-2930 Access Lists

Wren validates and displays the complete ordered access list before signing.
Software, Ledger, and Lattice transaction paths preserve that list in the typed
transaction payload. Trezor Connect accepts access lists through its EIP-1559
type-2 signing path, which Wren covers with deterministic adapter tests.

Trezor Connect does not expose an EIP-2930 type-1 signing request in the installed
API, so Wren rejects type-1 transactions for Trezor instead of converting them
or signing different bytes. These access-list paths have not received new
physical-device qualification in this fork.
