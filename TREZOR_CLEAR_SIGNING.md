# Trezor clear signing investigation

Historical findings for the bundled Connect 10.0.1 integration. Wren now uses
[Trezor Suite Desktop](TREZOR_SUITE.md) and does not bundle the execution engine.
Suite controls metadata requests and device prompts. These findings do not
describe or qualify a current Suite release.

Checked 26 October 2026 against Connect 10.0.1. Its signing path handles
clear-signing definition requests. Wren settles active and queued callers when
the bridge closes, including during a metadata lookup.
At that time, SDK lookup cancellation and format selection remained pending. The bridge fix does
not modify the SDK.

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

<a name="sdk-license-prerequisite"></a>

## SDK license clarification

The official Connect and connect-core 10.0.1 packages include T-RSL. Its grant
covers read-only reference use and excludes redistribution. Connect 9.7.3 has
the same terms. No separate Wren grant is recorded. The applicable terms for
bundling Connect in Wren need clarification. Review any integration agreement
and confirm rights before preparing a distributable SDK patch.
See the [SDK license](https://github.com/trezor/trezor-suite/blob/2ee7bd0636889196bab33e6069e2736393a58f3c/packages/connect/LICENSE.md).

The SDK source is unmodified. Bridge shutdown handling does not depend on the
proposed SDK patch. Connect 9.7.3 carries the same terms. Review the
license of any replacement before adopting it.

## Historical bridge checks

The earlier diagnostic exercised an isolated Connect core with no USB device.
It reproduced lookup cancellation and format gaps, and verified that Wren
settled callers on bridge shutdown. The in-process diagnostic was removed with
that integration. Current client checks are in [Trezor Suite verification](TREZOR_SUITE.md#verification).
