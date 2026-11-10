# Trezor Suite connection

Wren uses Trezor Suite Desktop for Trezor access. Suite must be running on the
same computer. Wren keeps account management, transaction review and submission.
Suite handles device selection, PIN, passphrase, pairing and device confirmation.

## Use

1. Open Suite Desktop and connect your Trezor.
2. In Wren, open Accounts, Add account, Trezor device. Select **Connect with Suite**.
3. Allow Wren in Suite and select the wallet. Existing Wren accounts match by address.
4. Review requests in Wren. Continue in Suite and approve on the Trezor.

To reconnect an existing signer, select **Connect with Suite** in its details.
After a restart, connect once to load the Trezor accounts again. Saved account
names, addresses and settings stay in Wren. Each passphrase wallet has its own
signer. Changing the address path requires a new connection.

Cancel in Wren to end the current connection attempt or transaction signing.
Wren ignores late replies to canceled requests. You can also reject a request
in Suite or on the device. After a connection error, open Suite and connect again.

## Implementation

Wren pins `@trezor/connect-web` and `@trezor/connect-common` to 10.0.1. Their
published packages contain MIT licenses. Wren imports the exported desktop
implementation, `CoreInSuiteDesktop`, and uses its Connect methods over
`ws://127.0.0.1:21335/connect-ws` from the main process. Suite identifies the
calling process and requests permission. Wren does not grant that permission.

The automatic web client can fall back to Suite Web, whose popup implementation
does not support the Electron environment. Wren uses the desktop implementation
directly and shows a connection error instead. No remote page runs in Wren.
Companion has no Trezor role. The extension and mobile packages are not needed.

Wren serializes requests, keeps Suite's device and wallet session reference,
checks response shapes and verifies signatures against the selected account.
The reference includes Suite's wallet instance. Connection setup blocks other
Trezor signing and address checks until it finishes. Removing a signer cancels
pending setup, so a late reply cannot add it back.
Pending removal blocks signer replacement. If the initial status update fails,
setup ends before Wren contacts Suite.
Verified wallet addresses identify live signers independently of Suite's USB
paths. Wren does not store PINs, passphrases or Suite session references on disk.
Opening the Suite connection has a four-second limit. Device requests have a
five-minute limit; address verification has a one-minute limit. Cancellation, timeout and
shutdown settle callers and prevent old replies from completing a new request.

Wren no longer bundles `@trezor/connect`, `@trezor/connect-core` or a direct
Trezor USB transport. Suite controls device access, firmware metadata lookups
and clear-signing support. No Connect source is modified.

The dependency tree also includes `@trezor/crypto-utils`, whose published
package omits its referenced license file. The desktop client does not use it.
Installers exclude it; the client checks reject any import of it.

Source references, checked against the published 10.0.1 client:

- [Package roles](https://docs.trezor.io/trezor-suite/packages/connect/index.html)
- [Desktop client](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect-web/src/impl/core-in-suite-desktop.ts)
- [Suite WebSocket host](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/suite/desktop-app-main/src/libs/connect-ws.ts)
- [Client license](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect-web/LICENSE.md)

## Verification

Run `npm run test:trezor-suite`. It exercises Wren's signer and the published
client against an isolated loopback Suite fixture. The fixture creates synthetic
signatures. It does not open a hardware device or use a wallet profile.
Results and source hashes are written to
`.git/trezor-suite-client/qualification.json`.

Physical checks remain separate: import and reconnect an existing account;
verify an address; sign a transfer, message and EIP-712 request; reject and
cancel; close Suite during a request; restart both apps. Repeat on Model One
and Safe 7 before qualifying this path. Previous physical results apply to the
earlier direct USB integration, as recorded in [hardware support](HARDWARE_SUPPORT.md).
