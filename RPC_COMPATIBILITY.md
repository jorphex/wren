# RPC Compatibility Reference

This reference defines Wren's local JSON-RPC and EIP-1193 provider boundary. It
is for application developers that connect to Wren. It is not a tutorial and it
does not describe the separate [browser companion](https://github.com/jorphex/wren-companion).

## Navigation

- [Scope and routes](#scope-and-routes)
- [Wallet-owned methods](#wallet-owned-methods)
- [Forwarded methods](#forwarded-methods)
- [Routing and errors](#routing-and-errors)
- [Events and subscriptions](#events-and-subscriptions)
- [Transport and origin boundaries](#transport-and-origin-boundaries)

## Scope and routes

Wren serves browser-compatible JSON-RPC on:

```text
http://127.0.0.1:1248/
ws://127.0.0.1:1248/
```

Root routes require a canonical HTTP(S), WS(S), or browser-extension `Origin`.
The asserted origin is compatibility metadata, not process authentication.
Originless native and CLI clients must use the authenticated protocol-3 routes
described in [Transport and origin boundaries](#transport-and-origin-boundaries).
Unknown routes, malformed origins, reserved internal labels, and protocol-version
mismatches fail before provider dispatch or consent UI. See the [Threat Model](THREAT_MODEL.md).

Wren either owns a method listed below or forwards it to the configured RPC for
the selected chain.

## Wallet-owned methods

| Area         | Methods                                                                                                      | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts     | `eth_accounts`, `eth_requestAccounts`, `eth_coinbase`                                                        | `eth_accounts` and `eth_coinbase` do not prompt. Before permission they return `[]` and `null`. `eth_requestAccounts` requests access. After permission, all expose only the selected Wren account. Watch-only accounts can read but cannot sign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Permissions  | `wallet_getPermissions`, `wallet_requestPermissions`                                                         | EIP-2255 `eth_accounts` with a Wren-issued finite caveat that binds the selected account, permitted wallet methods, enabled-chain snapshot, invoker identity, and 30-day expiry. A bounded `requiredMethods` hint checks signer compatibility before prompting. It does not widen the persisted grant. Users may separately configure local account/invoker/chain guardrails; these never widen the EIP-2255 grant and are not disclosed as a dapp capability.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Transactions | `eth_sendTransaction`                                                                                        | Normalizes, decodes, checks, simulates, reviews, signs, and broadcasts legacy, type-1, and type-2 transactions. Immediately before invoking a signer, Wren checks the configured RPC's pending native balance against value plus the reviewed worst-case execution fee and any available Optimism L1 data fee. A shortfall retains the original request with exact evidence, funding-address copy/QR actions, and an explicit fee/balance/simulation recheck. Wallet-initiated Speed Up and Cancel create another normal review, never mutate the saved gas preference, and fail closed if the original receipt/nonce or minimum replacement fee changed. Type 3+, EIP-7702 authorization lists, and unknown fields are rejected.                                                                                                                                                     |
| Signing      | `personal_sign`, `eth_sign`, `personal_ecRecover`, `eth_signTypedData`, `eth_signTypedData_v1`, `_v3`, `_v4` | Normalizes standard and legacy `personal_sign`, reviews UTF-8 or opaque bytes, recognizes SIWE, and requires explicit consent for dangerous `eth_sign`. Typed data is strictly validated and reviewed. Similarly named unsupported methods fail closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Chains       | `wallet_addEthereumChain`, `wallet_switchEthereumChain`, `wallet_getEthereumChains`                          | Adds a chain after metadata validation and confirmation. An authorized origin can switch its own route to an enabled chain without another approval. Untouched requests on its old route are cancelled. The non-standard getter returns enabled Wren chains.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Assets       | `wallet_watchAsset`, `wallet_getAssets`                                                                      | Supports legacy ERC-20 and bounded ERC-1046 ERC-20 suggestions. Parameterized `wallet_getAssets` implements the ERC-7811 Draft response for selected-account native/ERC-20 assets, including explicit-asset, asset-type, and chain filters; all results are restricted to the invoker's granted chains. The historical no-parameter response is preserved. The passive getter does not prompt and returns `4100` before permission. Wren does not index NFTs or arbitrary asset types. ERC-1046 accepts inline JSON and IPFS metadata only and never fetches HTTP(S) metadata or images.                                                                                                                                                                                                                                                                                              |
| Wallet calls | `wallet_sendCalls`, `wallet_getCallsStatus`, `wallet_showCallsStatus`, `wallet_getCapabilities`              | Supports EIP-5792 `2.0.0` non-atomic sequential calls only. Before returning a batch ID or invoking any signer, Wren repeats configured-RPC nonce, account-code/stateful-simulation, pending-balance, worst-case execution-fee, and Optimism L1 data-fee checks. A funding shortfall keeps the transient authorized review open with aggregate available/required/missing evidence and explicit Reject/Recheck actions; it never signs, broadcasts, funds, bridges, sponsors, or auto-retries. Status is persisted and scoped to origin/account, but payload and recovery evidence are not. If restart loses an unsigned transient review, its empty admission becomes failed instead of remaining resumable. `atomic.status` is `"unsupported"`. Signed or submitted batches resume evidence-only receipt and finality checks after restart and are never automatically rebroadcast. |
| Identity     | `eth_chainId`, `net_version`, `web3_clientVersion`                                                           | Return Wren's target-chain and client identity. Wren does not blindly forward these values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Account, signing, transaction, chain-mutation, asset, and wallet-call methods
require an active capability that covers the exact invoker, selected account,
method, and routed chain. Passive account, asset, and capability probes do not
open UI. Without permission, they return empty results or `4100`.

Optional guardrails are enforced at admission, when queued review resumes, and
immediately before every signer invocation. Block mode returns `4100`; warn mode adds
a fingerprint-bound acknowledgement to the ordinary review. Opaque calldata or
signing context fails closed only for configured restrictions that require the
missing field. Wallet Calls use aggregate native/token intent and recheck before each
sequential signature. The final signer boundary also revalidates the exact current
permission, method, chain, origin provenance, and Companion/native credential.
User-initiated Cancel remains available as a recovery action; Speed Up retains the
original dapp intent. Raw signed-transaction submission remains unsupported and cannot
bypass this boundary.

The Control Center's read-only inspector is not a provider route or dapp capability.
Its dashboard-only IPC accepts bounded unsigned transaction JSON, calldata with
explicit optional context, EIP-712 V3/V4 data, and only `eth_sendTransaction`,
`eth_call`, `eth_estimateGas`, or typed-data V3/V4 JSON-RPC wrappers. A pasted method
is mapped to an inspection subject and is never forwarded. Local standard-ABI decode
and typed-data risks are labeled as local evidence; simulation and trace evidence run
through Wren's current configured-RPC review path only when sender and chain context
are sufficient. Missing context remains explicit, and inspected payloads are neither
queued nor persisted.

Only `wallet_requestPermissions` and legacy `eth_requestAccounts` can open
account-access consent. A grant is replaced through fresh consent after expiry
or when newly enabled chains exceed its snapshot. Revocation deletes the grant.
Profiles upgraded from the former unscoped boolean model require fresh consent.
`wallet_getPermissions` returns an empty list when no grant exists.

The historical `caip_request` and `wallet_request` envelopes are removed and
always return `4200`. Send the inner EIP-1193 method directly and put a
canonical hexadecimal `chainId` at the top level. Wren does not claim current
CAIP-27 `wallet_invokeMethod` session or scope support.

## Forwarded methods

Other names, including ordinary reads such as `eth_call`, `eth_getBalance`, and
`eth_getBlockByNumber`, are forwarded to the configured connection after Wren
removes internal origin and routing fields. Read-only trace extensions can also
be forwarded.

Wren never forwards unknown `wallet_*`, `personal_*`, `account_*`, or
`eth_sign*` methods. It blocks `admin_*`, `engine_*`, and `miner_*`. Only a
fixed set of raw-inspection and trace `debug_*` methods is forwarded. Other
debug methods fail closed with EIP-1193 `4200`.

`eth_sendRawTransaction` is permission-gated and then forwarded unchanged for
supported transaction families. Wren cannot review or sign an already signed
transaction. It rejects type-3 and type-4 payloads. Forwarding a method does
not imply Wren wallet support.

## Routing and errors

- A top-level `chainId` must be a canonical hexadecimal quantity and must route to an enabled Wren chain. If it is omitted, Wren uses the requesting origin's assigned chain.
- An unknown or disconnected chain returns `4901`. An unauthorized wallet method returns `4100`. User rejection returns `4001`.
- An unsupported capability or type returns `4200` or the method-specific EIP-5792 error. Invalid JSON-RPC or parameters return `-32600`, `-32601`, or `-32602`. Internal failures return `-32603`.
- After transport disconnect, the JavaScript EIP-1193 wrapper rejects pending and future requests with `4900` and normalizes errors to `ProviderRpcError`.

## Events and subscriptions

The EIP-1193 wrapper emits `connect`, `disconnect`, `chainChanged`,
`accountsChanged`, and `message` only for actual state changes. Account
compatibility properties update before listeners run. Legacy or custom Wren
events include `networkChanged`, `chainsChanged`, and `assetsChanged`.

Wren owns subscriptions named `accountsChanged`, `chainChanged`,
`chainsChanged`, `networkChanged`, and `assetsChanged`. Delivery requires
account permission. Other `eth_subscribe` requests are forwarded.

Wren returns a transport-generated opaque subscription ID and rewrites
notifications to it. It translates `eth_unsubscribe` only for the owning
socket or HTTP origin and original chain. HTTP clients can use non-standard
`eth_pollSubscriptions` with a bounded `pollId` scoped to the canonical origin.
The poll token is not process authentication.

## Transport and origin boundaries

- JSON-RPC requests are limited to 1 MiB.
- HTTP accepts only `POST` and `OPTIONS`. It bounds headers, body time, connections, request rate, subscriptions, events, and poll state. CORS allows any origin. Overflow closes affected subscriptions.
- WebSocket bounds payloads, clients, message rate, subscriptions, and buffered deliveries. Per-message compression is disabled.
- Originless native protocol-v3 clients use signed P-256 challenge/ack handshakes. HTTP requests bind a short-lived session, nonce, expiry, path, and body hash. WebSocket authentication is additionally bound to the exact socket, and every message is signed. New keys require six-digit comparison. Settings can revoke their source-bound grants and active work.
- HTTP(S), WS(S), and extension origins keep scheme, host, and non-default port. Existing host-only browser grants are not assigned an invented scheme. Browser dapps need a new full-URI approval.
- Direct browser-compatible clients and authenticated Companion installations have separate permission identities even when they claim the same web origin. Different Companion credentials are separate as well.
- Originless, opaque, malformed, schemeless, and reserved-origin root clients receive `4100`. They must pair through native protocol 3. They cannot create a permission identity or open access UI.
- A same-user malicious process can assert browser-like direct-origin metadata. Direct-client permission remains consent and capability scope, not process authentication. It cannot consume a grant issued through an authenticated Companion credential.
- Companion protocol v3 mutually authenticates Wren and an atomic control/page key bundle with signed, role-bound, expiring transcripts and an explicit six-digit comparison. Page sessions cannot pair. Rotation is acknowledgement-safe. Revocation removes source-bound grants, requests, subscriptions, and transports. Protocol-v2 clients must upgrade and cannot downgrade silently.

The [browser companion](https://github.com/jorphex/wren-companion) is a separate
project with its own compatibility artifact. Browser-wide injection and EIP-6963
discovery are qualified there. Wren's embedded-dapp injector announces EIP-6963
and keeps the same object as legacy `window.ethereum`.
