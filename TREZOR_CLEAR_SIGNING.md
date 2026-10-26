# Trezor clear signing investigation

Checked 26 October 2026. Wren uses Connect 10.0.1, the current stable release.
Its existing signing path already handles clear-signing definition requests.
Wren now settles active and queued bridge callers on close, even during a
metadata lookup. SDK lookup cancellation and format selection remain pending.
No upstream SDK or dependency changed.

## What already works in code

Wren sends the reviewed transaction through `TrezorBridge.signTransaction` to
Connect. Both legacy and type-2 SDK helpers advertise definition-request support.
When firmware asks for network, token, or contract display data, Connect retrieves
it and sends `EthereumDefinitionAck`, then continues the original calldata flow.
Wren does not need to decode ERC-7730 descriptors itself.

This is present in the [released SDK source](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect-core/src/api/ethereum/ethereumSignTx.ts)
and [definition loader](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect-core/src/api/ethereum/ethereumDefinitions.ts).

| Feature                   | Meaning                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Network/token definitions | Signed metadata for names, units, and network identity; separate from contract decoding.                                    |
| Contract clear signing    | Firmware renders supported calls using registry display definitions. Coverage depends on the contract, firmware, and model. |
| EIP-712                   | Wren already sends structured data to Core models and hashes to Model One. This is a separate signing path.                 |
| Wren transaction preview  | Host-side evidence. It does not attest what the hardware screen displayed.                                                  |

Trezor lists Model T, Safe 3, Safe 5, and Safe 7 with Universal firmware 2.12.4
or later for registered-contract clear signing. Model One does not support that
display feature. Its user-tested Wren signing support remains unchanged.
See the [vendor coverage guide](https://trezor.io/guides/sending-receiving-staking-funds/interacting-with-smart-contracts/clear-signing-on-trezor)
and [Wren hardware evidence](HARDWARE_SUPPORT.md).

## Known gaps

- **Lookup privacy:** Connect contacts `data.trezor.io` with chain ID,
  target/token address, and sometimes the function selector. The service also
  sees the IP address. These GETs omit amounts, full calldata, and private keys.
- **Latency and cancellation:** the installed loader passes no timeout, response
  size limit, or abort signal to its fetch calls. Bridge checks confirm that
  cancelling during an initial network or token lookup leaves both queues
  waiting for HTTP completion. The cancelled call then reaches device selection.
- **Definition formats:** Connect 10.0.1 always requests v1. Core 2.13.0 accepts
  v1 and v2; Model One 1.14.2 requires v2 for external definitions. This is a
  source-confirmed mismatch for Model One external metadata, not a failure of all
  Model One signing. Built-in metadata can bypass external definitions.

The installed public API exposes a definition channel, but no definition-fetch
client, per-call deadline, or caller-supplied display definitions. Avoid global
fetch interception or a second loader. Follow the
[upstream format work](https://github.com/trezor/trezor-suite/blob/ed0d52316faaa89ddefc5eb032e50625d8b7874b/packages/connect-common/src/utils/definitionsUtils.ts)
and [definition trust rules](https://docs.trezor.io/trezor-firmware/common/external-definitions.html).
The format check uses released
[Core 2.13.0 source](https://github.com/trezor/trezor-firmware/blob/037e506db454691bda188df2803df2fc26c75f36/core/embed/rust/src/definitions/constants.rs)
and [Model One 1.14.2 source](https://github.com/trezor/trezor-firmware/blob/037e506db454691bda188df2803df2fc26c75f36/legacy/firmware/ethereum_definitions_constants.h.mako).

## SDK license prerequisite

The official Connect and connect-core 10.0.1 packages include T-RSL. Its grant
covers read-only reference use and excludes redistribution. Connect 9.7.3 has
the same terms. No separate Wren grant is recorded, and the maintainer has not
confirmed one. Confirm modification and redistribution rights with Trezor before
preparing a distributable SDK patch or publishing packages that include it.
See the [SDK license](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect/LICENSE.md).

SDK code remains unchanged. Wren-owned shutdown handling is independent of that
patch. A downgrade or copying upstream development code does not resolve the
license prerequisite.

## Bridge lookup qualification

Run `node scripts/qualify-trezor-lookups.mjs`. The script exercises Wren's bridge
source and Connect's public method factory and real in-process core. An empty
in-memory transport replaces USB; no device or account is opened. All HTTP is
intercepted. This diagnostic reproduces known gaps; a zero exit code means the
observations match and shutdown callers settle; lookup cancellation is still
unfixed.

Eight cases cover a native transfer without a lookup, decodable host metadata
with a type-2 call, missing metadata, HTTP 503, malformed HTTP-200 metadata,
cancellation during network and token lookups, and close/reinitialization during
a lookup. Decodable, missing, or unavailable metadata reaches
device selection. Malformed metadata rejects before device selection; the next
request still runs. Cancellation remains pending during a held reply and does
not prevent later device selection. Closing settles active and queued Wren
callers before HTTP completion, prevents queued work from dispatching, and
leaves a fresh core usable. It does not claim to abort the SDK's network fetch.

Results and source hashes are saved in
`.git/trezor-clear-signing/lookup-qualification.json`. No wire call or real
signature occurs. The decodable metadata fixture is unsigned. These checks do
not cover descriptor-stage cancellation,
firmware signature validation, on-device fallback/display, or physical reconnect.
The public network endpoints separately returned `trzd1` and `trzd2` as expected.
HTTP success alone does not establish firmware acceptance.

## Proposed work

1. Resolve the SDK license prerequisite, then address lookup gaps at the SDK
   boundary: bound lookup time and
   size, cancel the fetch and signing operation together, settle pending calls
   on disposal, and select the firmware's supported format. Qualify any pinned
   SDK change before adoption. A wrapper timeout alone does not stop the SDK
   from continuing towards a device. Keep definition lookup separate from RPC
   simulation and Wren token metadata.
2. Add an isolated firmware emulator qualification for the existing SDK path.
   Cover legacy/type-2 signing, token transfer, exact/unlimited approval, a
   registered contract call, and an unsupported contract. Check returned signed
   bytes against the reviewed transaction. Preserve type-1 rejection.
3. Exercise missing, malformed, stale, incorrectly signed, and wrong-chain
   definitions; slow replies; cancellation; disconnect; and reconnect. Invalid
   evidence must not cause an automatic retry with weaker review.
4. Test two approvals in a sequence and a token call carrying native ETH.
   Include the [vendor's native-value display fix](https://trezor.io/vulnerability/erc-20-clear-signing-hides-non-zero-eth-value-on-trezor-firmware).
   Keep structured EIP-712 and Model One hash signing as separate regressions.
5. Qualify a packaged Linux build on Safe 7 with recorded firmware and fixtures.
   Confirm on-device action, amounts, spender/recipient, native value, fallback,
   cancellation, and reconnect. Use a no-value test setup. Record evidence before
   making a Wren clear-signing support claim.

Keep the existing review UI. No global clear-signing badge, extra confirmation
screen, firmware setting change, or new backend is proposed.

## Evidence from this investigation

Nine isolated checks passed against the installed SDK: legacy/type-2 definition
round trips with HTTP 200, 404, and 503; calldata continuation; and three initial
lookup decisions. Network access was blocked and definition/signature bytes were
synthetic. These checks establish SDK message flow, not firmware validation,
device display accuracy, or a real signature.

Repeat with `node .git/trezor-clear-signing/20261026/probe.mjs`.
The local evidence directory holds results, source revisions, and hashes.
Existing Model One and Safe 7 user tests remain recorded in `HARDWARE_SUPPORT.md`.
