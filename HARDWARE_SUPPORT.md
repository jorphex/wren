# Signer and platform support reference

This reference records signer and platform tests. For each release candidate,
use the [qualification checklist](QUALIFICATION.md) and [release procedure](RELEASE.md).
See [OS-backed signer protection](OS_SIGNER_PROTECTION.md) for software-signer storage.

## Evidence labels

**Physical** means tested on a real device. **Automated** means covered by tests,
usually with simulated devices. **Implemented** means code exists but qualification
is incomplete. The runtime `signingCapabilities` profile controls available features;
it does not record physical testing.

## Current support matrix

| Signer or platform              | Transport/package             | Evidence and release boundary                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trezor Safe 7                   | USB, Trezor Connect 10        | User-tested transaction signing, cancellation, and reconnect on Linux x64; automated bridge coverage. Earlier address and message tests are in the [qualification record](QUALIFICATION.md#historical-080-linux-x64-evidence). |
| Trezor Model One                | USB, Trezor Connect 10        | User-tested with Connect 10; automated bridge coverage. Earlier firmware 1.13.1 tests are in the [qualification record](QUALIFICATION.md#historical-080-linux-x64-evidence).                                                   |
| Other Trezor models             | USB, Trezor Connect           | Shared implementation and automated bridge coverage; not physically requalified.                                                                                                                                               |
| Trezor Safe 7 Bluetooth         | Bluetooth                     | No Wren transport; unsupported.                                                                                                                                                                                                |
| Ledger                          | USB HID                       | Automated adapter/device coverage; not physically requalified.                                                                                                                                                                 |
| GridPlus Lattice1               | Vendor SDK/network            | Automated adapter/device coverage; not physically requalified.                                                                                                                                                                 |
| Seed, private key, keystore     | Local encrypted signer worker | Packaged import, unlock, signing, restart, removal, and automated signer coverage. Qualified on Linux x64; legacy limits apply.                                                                                                |
| Windows DPAPI signer protection | Electron `safeStorage`        | Implemented with unit, migration, backup, UI, and native package-probe coverage; native Windows VM checklist pending, so not platform-qualified.                                                                               |
| Linux x64 AppImage/deb          | Electron package              | Package verification and live fresh, migrated AppImage, and deb-upgrade runs. Current release target.                                                                                                                          |
| Windows x64                     | Electron/NSIS package         | Unsigned preview. The release workflow checks runtime and unsigned state; Windows is not platform-qualified.                                                                                                                   |
| macOS x64/arm64                 | Electron DMG                  | Unqualified previews. The release workflow checks runtime, ad-hoc seals, and no Apple identity; physical qualification remains separate.                                                                                       |
| Linux arm64 AppImage/tar.gz     | Electron package              | Real unsigned native CI smoke packages pass archive/runtime verification; not released or platform-qualified.                                                                                                                  |

Trezor Suite is not required for the Safe 7 USB flow. Another app
using the USB connection can block Wren’s access.

## Trezor limitations

Wren 0.1.11 user testing covered Safe 7 mainnet signing, cancellation and USB
reconnect with Connect 10. Model One was also user-tested with Connect 10.
The full Safe 7 pairing, address, message and EIP-712 checks were not repeated.
The planned 0.1.12 release needs its own candidate checks.

Connect 10 already handles firmware clear-signing definition requests. Trezor
lists Model T, Safe 3, Safe 5, and Safe 7 with Universal firmware 2.12.4 or later
for registered-contract clear signing; Model One does not support that display
feature. Wren-specific display qualification remains separate from the signing
tests above. See the [investigation and proposed checks](TREZOR_CLEAR_SIGNING.md)
and [vendor coverage](https://trezor.io/guides/sending-receiving-staking-funds/interacting-with-smart-contracts/clear-signing-on-trezor).

Connect 10.0.1 sends v1 external metadata; Model One firmware 1.14.2 or later
requires v2. Built-in metadata can bypass this path. Compatibility work for
external metadata remains pending; see the investigation above.

The following physical results apply to earlier builds.

The pre-separation `0.8.0` qualification covered fresh Safe 7 pairing, full
address display, rejection, personal signing, and EIP-712 review. After
transaction-state and balance-rendering fixes, Wren repeated physical address
verification, Base Sepolia signing/broadcast, and USB reconnect without a
reload loop. Bridge tests cover pairing events and responses.

On Model One, EIP-712 displays domain and message hashes rather than
structured fields. Wren warns before typed-data or permit approval; verify
every field in Wren before comparing device hashes. Trezor safety checks can
reject a transaction whose account coin type differs from the network
definition. For example, Base Sepolia uses coin type 1 while Wren's Ethereum
path uses 60. Wren leaves the device setting unchanged and reports the request
unsigned. Use a network-matching account, or select Prompt safety checks in
Trezor Suite only if you understand the mismatched-coin-key risk.

## Access lists

Wren validates, simulates, displays, and preserves complete ordered EIP-2930
access lists. Software, Ledger, and Lattice preserve them in typed
transactions. Trezor accepts them in EIP-1559 type-2 signing, which has
deterministic adapter coverage. The installed Trezor Connect API has no type-1
request, so Wren rejects type-1 Trezor transactions rather than changing their
bytes. These paths have not received new physical-device qualification.

## Lattice transaction review

On current main, Wren uses generic EVM requests with firmware 0.15 or later. They preserve
transaction bytes, including fees and ordered access lists.

Decoders use bundled standard ABIs without external lookups. Unknown or malformed
calldata stays raw for device review.

Signing uses the configured Lattice relay. Tests prepare requests with the real
SDK and use simulated signatures. Physical signing and device display remain
unverified.

## Regression guidance

Use a test account and network with no valuable assets. For a Safe 7 test:

1. Use a packaged Linux x64 artifact.
2. Record firmware, Connect version, OS, kernel, and artifact checksum.
3. Pair and reconnect once.
4. Verify the full address on the device.
5. Sign independently verified personal-message and supported EIP-712 fixtures.
6. Review and sign a zero-value testnet transfer to the same account.
7. Lock, disconnect, reconnect, and quit Wren.

No request should remain stuck. No plaintext secret should appear in logs.

For Ledger or Lattice, also record model, firmware/app version, transport,
derivation path, and fixture. At minimum test discovery, address display,
personal signing, typed data, EIP-1559 signing, rejection, reconnect, and
shutdown. Automated tests must not broadcast, use physical devices by default,
or share ports/profile data with an installed Wren instance.

GridPlus pairings retain the legacy `Frame[-tag]` permission ID so existing
devices do not silently lose access. Wren labels it as legacy; changing it
needs a separately qualified re-pairing migration. Record candidate hardware
evidence in [QUALIFICATION.md](QUALIFICATION.md).
