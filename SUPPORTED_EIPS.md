# Supported Ethereum Standards Reference

This reference describes current desktop support. For methods, transport, permissions
and origins, see [RPC Compatibility](RPC_COMPATIBILITY.md). Companion is released separately.

## Navigation

- [Status definitions](#status-definitions)
- [Provider and wallet interfaces](#provider-and-wallet-interfaces)
- [Signing and account intent](#signing-and-account-intent)
- [Transactions and execution](#transactions-and-execution)
- [Simulation evidence](#simulation-evidence)
- [Chain-agnostic compatibility](#chain-agnostic-compatibility)

## Status definitions

- **Implemented**: Wren owns the path and has automated regression coverage.
- **Partial**: Wren supports part of the standard. The table states what is missing.
- **Review-only**: Wren recognizes and reviews protocol messages. The app or
  contract handles execution or session validation.
- **Awareness-only**: Wren detects state but cannot change it.
- **Unsupported**: Wren has no maintained implementation.

**Implemented** refers to a usable wallet path. Internal helpers alone do not
change an **Unsupported** status.

## Provider and wallet interfaces

| Standard                                            | Status      | Wren behavior and limit                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) | Implemented | Provides `request`, `ProviderRpcError`, account/chain/connection events, subscriptions and legacy methods. Account state updates before listeners run. Transport and origin rules are in [RPC Compatibility](RPC_COMPATIBILITY.md).                                                                                                               |
| [EIP-1102](https://eips.ethereum.org/EIPS/eip-1102) | Implemented | Account exposure is permission-gated. `eth_requestAccounts` returns the selected account.                                                                                                                                                                                                                                                         |
| [EIP-2255](https://eips.ethereum.org/EIPS/eip-2255) | Implemented | Provides `wallet_getPermissions` and `wallet_requestPermissions` for `eth_accounts`. Grants last 30 days and bind the invoker, account, protected methods and enabled chains. Each use is rechecked, including queued work. Native and Companion credentials have separate revocable identities. Direct browser origins remain client assertions. |
| [EIP-3085](https://eips.ethereum.org/EIPS/eip-3085) | Implemented | Validates chain IDs and metadata, checks the supplied RPC chain and requires approval. RPC, explorer and icon URLs must use HTTPS without credentials.                                                                                                                                                                                            |
| [EIP-3326](https://eips.ethereum.org/EIPS/eip-3326) | Implemented | Known origins can switch to enabled chains without new account access. Untouched requests on the old route are cancelled. Unknown origins and unavailable chains are rejected.                                                                                                                                                                    |
| [EIP-747](https://eips.ethereum.org/EIPS/eip-747)   | Implemented | Supports checksummed legacy and ERC-1046 ERC-20 suggestions. Inline JSON and IPFS metadata have size limits and must agree with contract reads. HTTP(S) metadata and images are rejected.                                                                                                                                                         |
| [ERC-7811](https://eips.ethereum.org/EIPS/eip-7811) | Partial     | Parameterized `wallet_getAssets` returns native and ERC-20 balances for the authorized account and granted chains. Supports asset, type and chain filters, and `assetDiscovery`. Empty-parameter calls keep the legacy Wren response. NFT indexing is unsupported.                                                                                |
| [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) | Partial     | The embedded injector announces fixed provider metadata and preserves `window.ethereum`. Companion handles discovery in browsers.                                                                                                                                                                                                                 |

## Signing and account intent

| Standard                                            | Status      | Wren behavior and limit                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EIP-712](https://eips.ethereum.org/EIPS/eip-712)   | Implemented | Validates and reviews V3/V4 typed data and nested fields. Reports domain-chain risks. Preserves the flat Hyperliquid `ApproveAgent` message as a compatibility extension. Rejects nested namespaced structs before signing. V1 arrays use the legacy path. Hardware support varies.                                                                      |
| [EIP-2612](https://eips.ethereum.org/EIPS/eip-2612) | Review-only | Detects exact signed permits, including owner, spender, amount, expiry, nonce, chain, and contract. It does not implement permit contracts.                                                                                                                                                                                                              |
| [Permit2](https://github.com/Uniswap/permit2)       | Review-only | Summarizes exact allowance, transfer, batch, and witness declarations without changing payloads. Explicit consent is required for authority, maximum amounts, and noncanonical contracts. Uses matching RPC token decimals first, then local metadata; otherwise shows exact base units. Raw signed data remains available. It does not execute Permit2. |
| [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009) | Review-only | Summarizes exact V4 transfer, receive, and cancellation authorizations. It enforces signer authorization and transfer consent. Uses matching RPC or local token metadata for amounts and keeps raw signed data available. It does not execute ERC-3009 or infer token support.                                                                           |
| [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) | Review-only | Parses and reviews SIWE-shaped `personal_sign` messages and warns about origin, account, chain, time, and malformed data. It does not authenticate sessions or verify server nonces.                                                                                                                                                                     |
| [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) | Unsupported | An internal `isValidSignature` verifier exists. Selectable contract accounts, contract-signature production and a user validation flow are unavailable. See [Smart Accounts](SMART_ACCOUNTS.md).                                                                                                                                                         |
| [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) | Unsupported | Counterfactual signatures need a pinned validator and account adapter. See [Smart Accounts](SMART_ACCOUNTS.md) for validation order and deployment requirements.                                                                                                                                                                                         |

Raw `eth_sign` requires separate consent and has no EIP-712 message structure.
See [RPC Compatibility](RPC_COMPATIBILITY.md) for the method rules.

## Transactions and execution

| Standard                                            | Status      | Wren behavior and limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EIP-155](https://eips.ethereum.org/EIPS/eip-155)   | Implemented | Chain-binds legacy transactions before signing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [EIP-2718](https://eips.ethereum.org/EIPS/eip-2718) | Partial     | Handles legacy, type-1, and type-2 envelopes. It rejects explicit unsupported or unknown types rather than rewriting them.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [EIP-2930](https://eips.ethereum.org/EIPS/eip-2930) | Implemented | Strictly validates, bounds, simulates, displays, and preserves ordered access lists. Trezor rejects type-1 because installed Connect has no request. Type-2 supports access lists.                                                                                                                                                                                                                                                                                                                                                                                                     |
| [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559) | Implemented | Supports type-2 signing, fee estimates, editing and reviewed Speed Up/Cancel actions. Replacement fees use the greater of current fees and the same-nonce minimum. Receipts and nonces are rechecked before signing. Cancel races the original transaction with a zero-value self-transfer. Legacy hardware fallback requires no access list.                                                                                                                                                                                                                                          |
| [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844) | Unsupported | Rejects type-3 transactions and blob fields. Support needs KZG, complete blob sidecars, fee accounting, chain activation and signer/broadcast handling. See [Advanced Execution](EXECUTION_BOUNDARIES.md).                                                                                                                                                                                                                                                                                                                                                                             |
| [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) | Partial     | Supports non-atomic `2.0.0` Wallet Calls with status lookup and review. Calls run sequentially after funding, fee, nonce, account-code and stateful simulation checks. Missing funding keeps the review open for funding, recheck or rejection. Unsigned review payloads are not saved; empty admissions fail after restart. Completion needs a canonical receipt for every call. Monitoring resumes after restart without rebroadcast. Atomic calls remain unavailable. See [RPC Compatibility](RPC_COMPATIBILITY.md#wallet-calls) and [Advanced Execution](EXECUTION_BOUNDARIES.md). |
| [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) | Partial     | Reads exact delegation indicators through the configured RPC and supports wallet-owned zero-address revocation for Ring and Seed accounts. It provides review, restart-safe evidence-only monitoring, reorg handling, and block-bound clearance evidence. Externally supplied type-4 or authorization input, creation or replacement without a pinned audited delegate, and hardware revocation remain unsupported. See [Advanced Execution](EXECUTION_BOUNDARIES.md).                                                                                                                 |
| [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) | Unsupported | UserOperations, bundlers, EntryPoints, paymasters and a smart-account lifecycle are unavailable. See [Smart Accounts](SMART_ACCOUNTS.md) for the required choices.                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Simulation evidence

Wren uses configured-RPC `eth_simulateV1` when available. An unsupported-method
reply falls back to bounded `eth_call` for single transactions. Successful
calls can also request bounded `debug_traceCall` prestate and call traces.
Fallback token events require execution and traces at the same canonical block
hash. Missing tracing or block-selector support leaves the preview limited.
See [Simulation fallback](SIMULATION_FALLBACK.md) for coverage and tested endpoints.

Wren can show native Wei deltas and summarized nested calls or creations. The
results can omit fees or details and remain RPC claims. Wren hides raw trace
input and return data. Standard token and NFT logs are reported effects, not
complete or independently verified balance changes. Stateful wallet-call
batches have no independent traces because a trace cannot represent state
between calls. Hardware evidence is in [Hardware Support](HARDWARE_SUPPORT.md).

EIP-7702 delegation and delegate-code checks are configured-RPC evidence, not
an audit. A call to a delegated recipient or target runs the first delegate's
code in that account's context. An ordinary outbound transaction from a
delegated sender does not automatically run its delegate.

## Chain-agnostic compatibility

| Standard                                                               | Status      | Wren behavior and limit                                                                                                                                                 |
| ---------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CAIP-2](https://standards.chainagnostic.org/CAIPs/caip-2)             | Unsupported | Wren's removed historical envelopes no longer expose CAIP-2 routing. Use the top-level canonical hexadecimal EIP-1193 `chainId`.                                        |
| [CAIP-27](https://standards.chainagnostic.org/CAIPs/caip-27)           | Unsupported | Historical `caip_request` and `wallet_request` envelopes are removed and return `4200`. Wren does not implement current `wallet_invokeMethod` session or scope support. |
| [EIP-155 namespace](https://namespaces.chainagnostic.org/eip155/caip2) | Unsupported | Wren does not expose CAIP-2 namespace routing. EVM requests use a top-level canonical hexadecimal `chainId`.                                                            |
