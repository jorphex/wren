# Transaction preview fallback

Single transactions use `eth_simulateV1` when the configured RPC supports it.
An explicit unsupported-method reply falls back to `eth_call`. Reverts, rate
limits, invalid parameters, and malformed replies remain errors.

## Trace events

After a successful fallback, Wren can collect token events from its existing
`callTracer` request. Execution stays labelled `eth_call`; token details show
**RPC trace** and the block number. The summary uses the existing Estimated
changes section. Broad-approval consent uses these events too.

Execution and traces use the same canonical block hash and reviewed call fields.
The header lookup takes at most one second within the existing review deadline.
If headers or hash selectors are unsupported, basic execution can continue
without merged traces. A reorg or execution failure does not trigger a retry
against a different block.

Accepted logs require a matching sender, destination, value, calldata, and gas.
Wren excludes reverted subtrees and retains the execution address for delegate
calls. Ordering uses consistent global indices or validated child-call positions.
Mixed or ambiguous ordering leaves token evidence unavailable.

Collection is bounded to 512 frames, depth 32, 256 logs, 1 MiB of log payload,
and 100 displayed effects. Capped results are marked partial. Missing logs do
not establish that no assets can change. Events describe reported transfers or
approvals, not verified net balances. Existing `eth_simulateV1` effects remain
unchanged. Sequential Wallet Calls still require stateful simulation.
Contract-creation events stay unavailable in this fallback because `eth_call`
does not bind the reviewed creation nonce.

No dependency, injected code, compiler, indexer, or hosted service was added.
The [Geth callTracer reference](https://geth.ethereum.org/docs/developers/evm-tracing/built-in-tracers#calltracer)
describes log collection.

## Public endpoint checks

Checked 26 October 2026 with synthetic, zero-value read calls. Compiled Wren
completed a preview on all ten endpoints. These are endpoint measurements;
other providers on the same chain can differ.

| Network         | Endpoint                        | `eth_simulateV1` | Trace result                    |
| --------------- | ------------------------------- | ---------------- | ------------------------------- |
| Ethereum        | ethereum-rpc.publicnode.com     | Available        | Unavailable                     |
| Optimism        | optimism-rpc.publicnode.com     | Available        | Unavailable                     |
| Polygon         | polygon-bor-rpc.publicnode.com  | Available        | Unavailable                     |
| Base            | base-rpc.publicnode.com         | Available        | Unavailable                     |
| Arbitrum One    | arbitrum-one-rpc.publicnode.com | Available        | Unavailable                     |
| Robinhood       | rpc.mainnet.chain.robinhood.com | Available        | Unavailable                     |
| BNB Smart Chain | bsc-dataseed.bnbchain.org       | Available        | Unavailable                     |
| Avalanche C     | api.avax.network/ext/bc/C/rpc   | Unsupported      | Unavailable                     |
| ZKsync Era      | mainnet.era.zksync.io           | Unsupported      | Rejected hash selector          |
| Linea           | rpc.linea.build                 | Unsupported      | Available; uses child positions |

A separate read-only token approval on Linea produced the expected event through
Wren's fallback. No transaction was signed or broadcast. RPCs without usable
simulation or tracing retain limited previews.

## Verification

Run `npm run test:e2e` for isolated HTTP RPC integration cases. They cover method
errors, canonical snapshots, unchanged call fields, reverts, emitters, ordering,
missing evidence, caps, deadlines, and the Wallet Calls boundary. The suite writes
`compiled/simulation-fallback-e2e.json`; retain its Jest result with that artifact.

Four additional cases ran compiled Wren against isolated Geth 1.17.10: nested
logs, child reverts, root reverts, and delegate-call emitters. Synthetic state
overrides supplied fixtures only; no deployment or broadcast was used. The image
was pinned to `ethereum/client-go@sha256:5015dcab74ec5c9ef6584ada930ea353264a1c4e72383f256802e3178e10918c`.
Renderer checks cover the summary and details at 100%, 125%, and 150%.
Local transcripts, source hashes, and screenshots are retained in
`.git/simulation-fallback/20261026/`.

## Why sender-code simulation was rejected

A relay inserted into the sender changes observable code and execution costs.
Our earlier EVM fixture sent 7 Wei directly and nothing through the relay because
the target inspected its caller's code. Balance measurements also warmed state
and changed gas behaviour. [State overrides](https://geth.ethereum.org/docs/interacting-with-geth/rpc/objects#state-override-set)
are useful for controlled fixtures, but altered execution cannot establish the
original transaction's effects. [Access lists](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth#eth_createaccesslist)
report touched state, not complete asset changes.
