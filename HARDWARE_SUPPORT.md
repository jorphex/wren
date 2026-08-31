# Signer and platform support reference

Use this reference to decide whether a signer or platform is within Wren's tested
boundary. Run the complete candidate checks in the [qualification checklist](QUALIFICATION.md);
see the [README](README.md) for orientation and the [release procedure](RELEASE.md)
for package and publication gates.

## Evidence labels

**Physical** means exercised on a real device in this project. **Automated** means
unit or adapter coverage, usually with mocks. **Implemented** means a code path
exists but has not been regression-qualified here. These labels are evidence, not
security certification. The runtime `signingCapabilities` profile controls
supported envelopes, typed-data versions, messages, address display, and
transport; it does not upgrade the evidence label.

## Current support matrix

| Signer or platform              | Transport/package             | Evidence and release boundary                                                                                                                      |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trezor Safe 7                   | USB, Trezor Connect           | Physical address, message, EIP-712, transaction, broadcast, rejection, and reconnect tests on Linux x64; automated bridge coverage.                |
| Trezor Model One                | USB, Trezor Connect           | Physical address, message, hash-only EIP-712, rejection, and reconnect on firmware 1.13.1. Qualified with limitations on Linux x64.                |
| Other Trezor models             | USB, Trezor Connect           | Shared implementation and automated bridge coverage; not physically requalified.                                                                   |
| Trezor Safe 7 Bluetooth         | Bluetooth                     | No Wren transport; unsupported.                                                                                                                    |
| Ledger                          | USB HID                       | Automated adapter/device coverage; not physically requalified.                                                                                     |
| GridPlus Lattice1               | Vendor SDK/network            | Automated adapter/device coverage; not physically requalified.                                                                                     |
| Seed, private key, keystore     | Local encrypted signer worker | Packaged import, unlock, signing, restart, removal, and automated signer coverage. Qualified on Linux x64; legacy limits apply.                    |
| Windows DPAPI signer protection | Electron `safeStorage`        | Implemented with unit, migration, backup, UI, and native package-probe coverage; native Windows VM checklist pending, so not platform-qualified.   |
| Linux x64 AppImage/deb          | Electron package              | Package verification and live fresh, migrated AppImage, and deb-upgrade runs. Current release target.                                              |
| Windows x64                     | Electron/NSIS package         | Unsigned preview with native archive/runtime and unsigned-state checks; not platform-qualified, and no trusted publisher is claimed.               |
| macOS x64/arm64                 | Electron DMG                  | 0.1.5 unqualified previews. Native CI verifies runtime, ad-hoc seals, no Apple identity, and Gatekeeper rejection; physical qualification pending. |
| Linux arm64 AppImage/tar.gz     | Electron package              | Real unsigned native CI smoke packages pass archive/runtime verification; not released or platform-qualified.                                      |
| Linux snap                      | Electron package              | Legacy configuration only; not produced by current CI.                                                                                             |

Trezor Suite is not required for the qualified Safe 7 USB flow. Another app holding the device transport can cause contention.

## Trezor limitations

The pre-separation `0.8.0` qualification covered fresh Safe 7 pairing, full address display, rejection, personal signing, and EIP-712 review. After transaction-state and balance-rendering fixes, Wren repeated physical address verification, Base Sepolia signing/broadcast, and USB reconnect without a reload loop. Bridge tests cover pairing events and responses.

On Model One, EIP-712 displays domain and message hashes rather than structured fields. Wren warns before typed-data or permit approval; verify every field in Wren before comparing device hashes. Trezor safety checks can reject a transaction whose account coin type differs from the network definition. For example, Base Sepolia uses coin type 1 while Wren's Ethereum path uses 60. Wren leaves the device setting unchanged and reports the request unsigned. Use a network-matching account, or select Prompt safety checks in Trezor Suite only if you understand the mismatched-coin-key risk.

## Access lists

Wren validates, simulates, displays, and preserves complete ordered EIP-2930 access lists. Software, Ledger, and Lattice preserve them in typed transactions. Trezor accepts them in EIP-1559 type-2 signing, which has deterministic adapter coverage. The installed Trezor Connect API has no type-1 request, so Wren rejects type-1 Trezor transactions rather than changing their bytes. These paths have not received new physical-device qualification.

## Regression guidance

Use a test-only account and network with no valuable assets. For a Safe 7 test: use a packaged Linux x64 artifact; record firmware, Connect version, OS, kernel, and artifact checksum; pair and reconnect once; verify a full address on device; sign an independently verified personal-message and supported EIP-712 fixture; then review and sign a zero-value testnet self-transfer. Lock, disconnect, reconnect, and quit Wren; no request should remain stuck and no plaintext secret should appear in logs.

For Ledger or Lattice, also record model, firmware/app version, transport, derivation path, and fixture. At minimum test discovery, address display, personal signing, typed data, EIP-1559 signing, rejection, reconnect, and shutdown. Automated tests must not broadcast, use physical devices by default, or share ports/profile data with an installed Wren instance.

GridPlus pairings retain the legacy `Frame[-tag]` permission ID so existing devices do not silently lose access. Wren labels it as legacy; changing it needs a separately qualified re-pairing migration. Record candidate hardware evidence in [QUALIFICATION.md](QUALIFICATION.md).
