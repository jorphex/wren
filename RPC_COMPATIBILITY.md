# RPC Compatibility

For application developers connecting to Wren's local provider.

Wren serves JSON-RPC at `http://127.0.0.1:1248` and `ws://127.0.0.1:1248`. Loopback blocks remote access, but it does not authenticate local processes. HTTP origins and WebSocket metadata are client assertions, not process identities. Valid web origins are full, scheme-preserving URIs. Originless, opaque, malformed, oversized, and schemeless clients receive a server-generated identity scoped to their connection; see [Threat Model](THREAT_MODEL.md).

Wren either owns a method below or forwards it to the configured RPC for the selected chain.

## Wallet-owned methods

| Area           | Methods                                                                                                      | Behavior                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts       | `eth_accounts`, `eth_requestAccounts`, `eth_coinbase`                                                        | `eth_accounts` and `eth_coinbase` do not prompt: before permission they return `[]` and `null`. `eth_requestAccounts` requests access. After permission, all expose only the selected Wren account. Watch-only accounts can read but cannot sign.                                                                |
| Permissions    | `wallet_getPermissions`, `wallet_requestPermissions`                                                         | EIP-2255 `eth_accounts` with a Wren-issued finite caveat binding the selected account, permitted wallet methods, enabled-chain snapshot, invoker identity, and 30-day expiry. A bounded `requiredMethods` hint checks signer compatibility before prompting; it does not let a client widen the persisted grant. |
| Transactions   | `eth_sendTransaction`                                                                                        | Normalizes, decodes, checks, simulates, reviews, signs, and broadcasts legacy, type-1, and type-2 transactions. Successful single-transaction checks can include bounded configured-RPC native-balance and internal-call evidence. Type 3+, EIP-7702 authorization lists, and unknown fields are rejected.       |
| Signing        | `personal_sign`, `eth_sign`, `personal_ecRecover`, `eth_signTypedData`, `eth_signTypedData_v1`, `_v3`, `_v4` | Normalizes standard/legacy `personal_sign`, reviews UTF-8 or opaque bytes, recognizes SIWE, and requires explicit consent for dangerous `eth_sign`. Typed data is strictly validated and reviewed; similarly named unsupported methods fail closed.                                                              |
| Chains         | `wallet_addEthereumChain`, `wallet_switchEthereumChain`, `wallet_getEthereumChains`                          | Adds after metadata validation and confirmation. An authorized origin can switch its own route to an enabled chain without another approval; untouched requests on its old route are cancelled. The getter is non-standard and returns enabled Wren chains.                                                      |
| Assets         | `wallet_watchAsset`, `wallet_getAssets`                                                                      | Legacy ERC-20 and bounded ERC-1046 ERC-20 suggestions; a non-standard selected-account asset getter. The getter does not prompt and returns `4100` before permission. ERC-1046 accepts inline JSON and IPFS metadata only; it does not fetch HTTP(S) metadata or images.                                         |
| Wallet calls   | `wallet_sendCalls`, `wallet_getCallsStatus`, `wallet_showCallsStatus`, `wallet_getCapabilities`              | EIP-5792 `2.0.0`, non-atomic sequential calls only. Status is persisted and scoped to origin/account; `atomic.status` is `"unsupported"`.                                                                                                                                                                        |
| Legacy routing | `caip_request`, `wallet_request`                                                                             | Permission-gated historical envelopes for one nested EVM request and optional canonical `eip155` CAIP-2 route. They are not current CAIP-27 `wallet_invokeMethod` support.                                                                                                                                       |
| Identity       | `eth_chainId`, `net_version`, `web3_clientVersion`                                                           | Return Wren's target chain/client identity, not blindly forwarded values.                                                                                                                                                                                                                                        |

Account, signing, transaction, chain mutation, asset, wallet-call, and legacy-envelope methods require an active capability covering the exact invoker, selected account, method, and routed chain. Passive account, asset, and capability probes do not open UI; they return empty results or `4100` without permission. Only `wallet_requestPermissions` and legacy `eth_requestAccounts` can open account-access consent. A grant is replaced through fresh consent after expiry or when newly enabled chains exceed its snapshot; revocation deletes it. Profiles upgraded from the former unscoped boolean model require fresh consent. `wallet_getPermissions` returns an empty list when absent.

The historical envelope `session` field is syntax only, not an authentication credential. Wren authorizes the asserted origin and selected account before mapping the nested request.

## Forwarded methods

Other names, including ordinary reads such as `eth_call`, `eth_getBalance`, and `eth_getBlockByNumber`, are forwarded to the configured connection after Wren removes internal origin and routing fields. Read-only trace extensions may also be forwarded.

Wren never forwards unknown `wallet_*`, `personal_*`, `account_*`, or `eth_sign*` methods. It blocks `admin_*`, `engine_*`, and `miner_*`. Only a fixed set of raw-inspection and trace `debug_*` methods is forwarded; other debug methods fail closed with EIP-1193 `4200`. `eth_sendRawTransaction` is permission-gated then forwarded unchanged: Wren cannot decode, review, or sign an already signed transaction. A forwarded method does not imply Wren wallet support.

## Routing and errors

- A top-level `chainId` must be a canonical hexadecimal quantity and routes to an enabled Wren chain. If omitted, Wren uses the requesting origin's assigned chain.
- Unknown or disconnected chains return `4901`; unauthorized wallet methods return `4100`; user rejection returns `4001`.
- Unsupported capabilities/types return `4200` or the method-specific EIP-5792 error. Invalid JSON-RPC/parameters return `-32600`, `-32601`, or `-32602`; internal failures return `-32603`.
- After transport disconnect, the JavaScript EIP-1193 wrapper rejects pending/future requests with `4900` and normalizes errors to `ProviderRpcError`.

## Events and subscriptions

The EIP-1193 wrapper emits `connect`, `disconnect`, `chainChanged`, `accountsChanged`, and `message` only for actual state changes. Account compatibility properties update before listeners run. Legacy/custom Wren events include `networkChanged`, `chainsChanged`, and `assetsChanged`.

Wren owns subscriptions named `accountsChanged`, `chainChanged`, `chainsChanged`, `networkChanged`, and `assetsChanged`; delivery requires account permission. Other `eth_subscribe` requests are forwarded. Wren returns a transport-generated opaque subscription ID, rewrites notifications to it, and translates `eth_unsubscribe` only for the owning socket or HTTP origin and original chain. HTTP clients can use non-standard `eth_pollSubscriptions` with a bounded `pollId` scoped to canonical origin. The poll token is not process authentication.

## Transport and origin boundaries

- JSON-RPC requests are limited to 1 MiB.
- HTTP accepts only `POST` and `OPTIONS`; it bounds headers, body time, connections, request rate, subscriptions, events, and poll state. CORS allows any origin. Overflow closes affected subscriptions.
- WebSocket bounds payloads, clients, message rate, subscriptions, and buffered deliveries; per-message compression is disabled.
- HTTP(S), WS(S), and extension origins keep scheme, host, and non-default port. Existing host-only browser grants are not assigned an invented scheme; browser dapps need a new full-URI approval.
- Direct local clients and authenticated Companion installations have separate permission identities even when they claim the same web origin; different Companion credentials are separate as well.
- Invalid/originless clients cannot reuse another connection's permission identity. Their grants are removed during startup recovery.
- A same-user malicious process can assert browser-like direct origin metadata; direct-client permission remains consent and capability scope, not process authentication. It cannot consume a grant issued through an authenticated Companion credential.
- Companion protocol v2 requires a challenge-bound P-256 proof and explicit six-digit comparison before Wren accepts a new browser installation's proxied origins. Known page sessions reuse the approved public credential but cannot create pairing prompts; credentials can be rotated or revoked. This authenticates Companion to Wren, not Wren to Companion or a native localhost process.

The [browser companion](https://github.com/jorphex/wren-companion) is a separate project with its own compatibility artifact. Browser-wide injection and EIP-6963 discovery are qualified there. Wren's embedded-dapp injector announces EIP-6963 and keeps the same object as legacy `window.ethereum`.
