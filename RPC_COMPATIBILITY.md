# RPC Compatibility

Wren exposes JSON-RPC over `http://127.0.0.1:1248` and
`ws://127.0.0.1:1248`. The loopback interface prevents direct remote access but
does not authenticate local processes. HTTP origins and WebSocket metadata are
asserted by clients and are not native process identities. Valid web origins are
canonicalized as full, scheme-preserving URIs. Originless, opaque, malformed,
oversized, and schemeless clients receive server-generated identities scoped to
one transport connection; see the [threat model](THREAT_MODEL.md).

This document separates methods implemented by Wren from methods forwarded to
the configured chain connection.

## Wallet-Owned Methods

| Area            | Methods                                                                                         | Behavior                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts        | `eth_accounts`, `eth_requestAccounts`, `eth_coinbase`                                           | `eth_accounts` and `eth_coinbase` are passive: before permission they return `[]` and `null` without prompting. `eth_requestAccounts` explicitly requests access, and all three expose only the selected Wren account after the origin has permission. Watch-only accounts remain available for reads, but Wren rejects their signing requests before pending submission state. |
| Permissions     | `wallet_getPermissions`, `wallet_requestPermissions`                                            | Support only the EIP-2255 `eth_accounts` permission. Requests may use a bounded `requiredMethods` compatibility hint, which is checked against the selected signer before prompting but is not persisted as a granted caveat.                                                                                                                                                   |
| Transactions    | `eth_sendTransaction`                                                                           | Normalizes, decodes, checks, simulates, reviews, signs, and broadcasts legacy/type-1/type-2 transactions. Successful single-transaction checks optionally include bounded configured-RPC native balance and internal-call evidence. Explicit type 3+, EIP-7702 authorization lists, and unknown transaction fields are rejected.                                                |
| Message signing | `personal_sign`, `eth_sign`, `personal_ecRecover`                                               | Normalizes standard/legacy `personal_sign` parameter order, reviews UTF-8 or opaque bytes, identifies SIWE, and places explicit consent in front of dangerous `eth_sign`.                                                                                                                                                                                                       |
| Typed signing   | `eth_signTypedData`, `eth_signTypedData_v1`, `eth_signTypedData_v3`, `eth_signTypedData_v4`     | Strictly validates the selected format and presents structured domain/message review. Unsupported similarly named signing methods fail closed rather than reaching the chain connection.                                                                                                                                                                                        |
| Chains          | `wallet_addEthereumChain`, `wallet_switchEthereumChain`, `wallet_getEthereumChains`             | Add-chain requests validate metadata and require confirmation. An authorized origin switches its own route to an enabled chain without another approval; untouched requests for its previous chain are canceled. The non-standard getter returns enabled Wren chains.                                                                                                           |
| Assets          | `wallet_watchAsset`, `wallet_getAssets`                                                         | Legacy ERC-20 and bounded ERC-1046 ERC-20 suggestions, plus a non-standard getter for the selected account's scanned native/ERC-20 assets. The getter does not prompt and returns `4100` before permission. ERC-1046 accepts inline JSON and IPFS metadata only; HTTP(S) and metadata images are not fetched.                                                                   |
| Wallet calls    | `wallet_sendCalls`, `wallet_getCallsStatus`, `wallet_showCallsStatus`, `wallet_getCapabilities` | EIP-5792 version `2.0.0`, non-atomic sequential calls only. Status is origin/account scoped and persisted; capabilities report `atomic.status = "unsupported"`.                                                                                                                                                                                                                 |
| Legacy routing  | `caip_request`, `wallet_request`                                                                | Permission-gated historical envelopes that map one nested EVM request and optional canonical CAIP-2 `eip155` chain into Wren's ordinary method pipeline. They are not current CAIP-27 `wallet_invokeMethod` support.                                                                                                                                                            |
| Identity        | `eth_chainId`, `net_version`, `web3_clientVersion`                                              | Return Wren's target chain and client identity rather than blindly forwarding.                                                                                                                                                                                                                                                                                                  |

Compatibility envelopes, `wallet_sendCalls`, signing, account, transaction,
chain mutation, asset, and wallet-owned status/capability methods require origin
permission. Passive account, asset, and capability probes reach their
provider-owned handlers without opening access UI, then return empty or `4100`
unless permission already exists. Interactive methods are protected at
HTTP/WebSocket ingress.
`wallet_requestPermissions` is intentionally callable before authorization so it
can create the permission prompt. `wallet_getPermissions` performs its own
origin/account lookup and returns an empty list when access is absent.

The `session` value accepted by a historical request envelope is syntactic only;
it is not a session-authentication credential. Wren authorizes the asserted
origin and selected account before mapping the nested request. Current CAIP-27
`wallet_invokeMethod` session/scope behavior is unsupported.

## Forwarded Methods

Other method names are forwarded to the configured connection for the target
chain after Wren removes its internal origin and chain-routing fields. This
includes ordinary reads such as `eth_call`, `eth_getBalance`, and
`eth_getBlockByNumber`, plus read-only client extensions such as trace methods.

Wren never forwards an unhandled `wallet_*`, `personal_*`, `account_*`, or
`eth_sign*` method. It also blocks the privileged `admin_*`, `engine_*`, and
`miner_*` namespaces. Within `debug_*`, Wren forwards an explicit set of current
raw-inspection and trace methods; other debug methods fail closed. Rejected
methods use EIP-1193 error `4200` so those node-account and privileged APIs
cannot become a path around Wren's review boundary.

`eth_sendRawTransaction` is permission-gated but then forwarded unchanged; Wren
cannot decode, review, or sign an already signed transaction. Callers must not
infer wallet support merely because the configured RPC node happens to implement
a forwarded method.

## Chains And Errors

- A top-level `chainId` routes a request to that enabled Wren chain. It must be a
  canonical hexadecimal quantity; omitted values use the requesting origin's
  assigned chain.
- Unknown or disconnected target chains return EIP-1193 error `4901`.
- Unauthorized wallet methods return `4100`; user rejection returns `4001`.
- Unsupported wallet capabilities or transaction types use `4200` or the
  method-specific EIP-5792 error where required.
- Malformed JSON-RPC or parameters use `-32600`, `-32601`, or `-32602` as
  applicable. Unexpected internal failures use `-32603`.
- The JavaScript EIP-1193 wrapper rejects pending/future requests with `4900`
  after transport disconnection and normalizes provider errors to
  `ProviderRpcError`.

## Events And Subscriptions

The EIP-1193 wrapper exposes `connect`, `disconnect`, `chainChanged`,
`accountsChanged`, and `message`. Canonical connection, chain, and account events
are emitted only for actual state transitions; account compatibility properties
are updated before listeners run. It also retains legacy/custom Wren events such
as `networkChanged`, `chainsChanged`, and `assetsChanged`.

Wren owns subscriptions named `accountsChanged`, `chainChanged`,
`chainsChanged`, `networkChanged`, and `assetsChanged`; delivery is checked
against the origin's account permission. Other `eth_subscribe` requests are
forwarded to the configured chain. WebSocket notifications are delivered on the
same authorized socket. Wren returns a transport-generated opaque subscription
ID rather than exposing the configured RPC's ID; notifications are rewritten to
that ID, and `eth_unsubscribe` is translated only for the owning socket or HTTP
origin and original chain. HTTP clients use Wren's non-standard
`eth_pollSubscriptions` polling bridge with a bounded caller-provided `pollId`
scoped by canonical origin. The poll token is compatibility state, not native
process authentication.

## Transport Limits

- JSON-RPC requests are limited to 1 MiB by the shared parser.
- HTTP accepts only `POST` and `OPTIONS`, bounds headers/body time, connections,
  per-socket requests, request rate, active poll clients, subscriptions per poll
  client, queued event count/bytes, and poll idle time, and permits CORS from any
  origin. Overflow closes the affected subscriptions instead of growing memory.
- WebSocket bounds payload size, active clients, and per-client message rate and
  subscription count, caps buffered subscription delivery, and disables
  per-message compression.
- HTTP(S), WS(S), and browser-extension origins retain their canonical scheme,
  host, and non-default port, so grants do not cross schemes. Existing host-only
  browser grants are intentionally not assigned an invented scheme; browser dapps
  require a new approval under their full URI after this migration.
- Originless, opaque, malformed, oversized, and schemeless HTTP/WebSocket clients
  cannot reuse another connection's permission identity. Their generated origins
  and permissions are removed during startup recovery; a new connection may
  require a new approval.
- Origin permission is not proof of local process identity. A malicious process
  running as the same OS user can assert browser-like origin metadata.
- Wren Companion protocol version 2 requires a challenge-bound P-256 proof and
  explicit six-digit comparison before Wren accepts proxied dapp origins from a
  new browser installation. Known page sessions reuse the approved public
  credential but cannot create pairing prompts. Credentials can be rotated or
  revoked. This authenticates Companion to Wren, not Wren to Companion or any
  native localhost process.

The [companion browser extension](https://github.com/jorphex/wren-companion) is
a separate project with its own compatibility artifact. Browser-wide provider
injection and EIP-6963 discovery are qualified there, not by this desktop
repository. Wren's embedded-dapp injector announces its provider with EIP-6963
and retains that same object as the legacy `window.ethereum` fallback.
