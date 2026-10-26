# Trezor clear signing investigation

Checked 26 October 2026. Wren uses Connect 10.0.1, the current stable release.
Its existing signing path already handles clear-signing definition requests.
Qualify that path and its lookup behavior before choosing an SDK change.
No signer code or dependency changed in this investigation.

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

## Gaps to qualify

- **Lookup privacy:** Connect contacts `data.trezor.io` with chain ID,
  target/token address, and sometimes the function selector. The service also
  sees the IP address. These GETs omit amounts, full calldata, and private keys.
- **Latency and cancellation:** the installed loader passes no timeout, response
  size limit, or abort signal to its fetch calls. Wren queues bridge requests.
  A stalled lookup may delay signing; cancellation through this stage needs a
  full bridge test. This is a source-based concern, not a reproduced device hang.
- **Definition formats:** upstream now selects formats for Core 2.13.0 and
  Model One 1.14.2. Released 10.0.1 lacks that negotiation. The original v1
  endpoint still responds. This alone does not prove a compatibility failure;
  qualify each firmware before choosing an SDK change.

The installed public API exposes a definition channel, but no definition-fetch
client, per-call deadline, or caller-supplied display definitions. Avoid global
fetch interception or a second loader. Follow the
[upstream format work](https://github.com/trezor/trezor-suite/blob/ed0d52316faaa89ddefc5eb032e50625d8b7874b/packages/connect-common/src/utils/definitionsUtils.ts)
and [definition trust rules](https://docs.trezor.io/trezor-firmware/common/external-definitions.html).

## Proposed work

1. Add an isolated emulator/bridge qualification for the existing SDK path.
   Cover legacy/type-2 signing, token transfer, exact/unlimited approval, a
   registered contract call, and an unsupported contract. Check returned signed
   bytes against the reviewed transaction. Preserve type-1 rejection.
2. Exercise missing, malformed, stale, incorrectly signed, and wrong-chain
   definitions; slow replies; cancellation; disconnect; and reconnect. Invalid
   evidence must not cause an automatic retry with weaker review.
3. Test two approvals in a sequence and a token call carrying native ETH.
   Include the [vendor's native-value display fix](https://trezor.io/vulnerability/erc-20-clear-signing-hides-non-zero-eth-value-on-trezor-firmware).
   Keep structured EIP-712 and Model One hash signing as separate regressions.
4. If lookup delay is confirmed, use a supported upstream mechanism for bounded,
   cancellable requests, with a pinned dependency change only when needed.
   Keep definition lookup separate from RPC simulation and Wren token metadata.
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
