# Smart account integration boundary

## Purpose and status

Wren does not currently support selectable smart accounts, ERC-4337 execution,
or ERC-6492 counterfactual signatures. These standards do not define one generic
account implementation or signature format. Wren rejects these requests until
it selects and pins the choices below.

**Planning status:** Wren does not plan these paths under its current backend-free
product model. Reconsider support only if user demand changes and a bundler strategy can meet
Wren’s privacy requirements. The requirements below define that future work.

## Implemented verification foundation

Wren has an internal ERC-1271 verifier for a future account adapter. It calls
`isValidSignature(bytes32,bytes)` through the configured chain RPC, accepts only
`0x1626ba7e`, bounds all untrusted bytes, and binds code and call evidence to one
canonical EIP-1898 block hash. It does not infer account families from bytecode,
produce account-defined signatures, or expose a user-facing validation flow.

## ERC-4337: decisions required before support

Implementation requires one reviewed configuration, not arbitrary dapp input:

- one account family and version, with implementation/factory addresses, runtime
  code hashes, exact `execute` ABI, signature format, and controller-ownership rule;
- supported chains and one EntryPoint version/address/code hash per chain, with
  its exact ABI, UserOperation RPC shape, packed-field encoding, and
  `getUserOpHash` semantics;
- a user-owned or Wren-configured bundler policy and supported-EntryPoint check;
- a funding policy: initially a prefunded EntryPoint deposit, or a separately
  reviewed paymaster/sponsorship trust boundary;
- a software controller policy (recommended first scope: Ring and Seed only);
- whether standard `eth_sendTransaction` is converted internally for a selected
  smart account (recommended), while dapp-authored full UserOperations remain
  rejected;
- which of `personal_sign`, dangerous `eth_sign`, and each typed-data version the
  adapter supports, with the exact digest and account-signature mapping; every
  unspecified signing method remains rejected because ERC-1271 validation does
  not produce a contract signature;
- a reviewed batch ABI, atomicity guarantee, and review mapping before
  `wallet_sendCalls` is accepted for a smart account; Wren's current sequential
  EOA path is not reused for one;
- bounded ERC-7769 access to `eth_supportedEntryPoints`,
  `eth_estimateUserOperationGas`, `eth_sendUserOperation`,
  `eth_getUserOperationByHash`, and `eth_getUserOperationReceipt`; returned
  sender, EntryPoint, and UserOperation hash must match Wren's reviewed snapshot,
  and a containing bundle receipt alone is not proof that the inner operation
  succeeded;
- persistence and reconciliation for accepted UserOperations. Restart never
  automatically resubmits one; replacement and cancellation remain unsupported
  until the selected family's nonce-key policy is defined.

The smallest safe first implementation is one deployed account family, with no
factory deployment, paymaster, aggregator, EIP-7702 marker, or automatic retry.
Both the `factory: 0x7702` marker and a distinct `eip7702Auth` tuple are rejected.
Review must show decoded inner calls, controller, EntryPoint, maximum cost,
funding, and simulation evidence before adapter-bound signing and bundler
submission.

## ERC-6492: decisions required before support

Counterfactual validation depends on the selected account adapter. It requires
an exact factory/prepare payload, deterministic sender derivation, allowlisted
factory and implementation code hashes, and a pinned universal-validator
deployment/code hash on each supported chain. Factory/prepare and ERC-1271
verification must execute atomically through that rollback-capable validator
in one `eth_call`, never as separate state reads or a broadcast transaction.
Wren must check the ERC-6492 suffix first, then ERC-1271 when code exists; if
a wrapped signature fails for an already deployed account, it must simulate
the supplied prepare call and retry ERC-1271.

EOA recovery is last and is attempted only when the signer has no contract
code.

## Finish condition

ERC-4337 or ERC-6492 may move from `Unsupported` only after Wren records these
choices, implements the complete adapter and execution path, rechecks
configured-chain evidence before signing or submission, and passes automated
lifecycle and failure tests. Parser-only code or mocked contract evidence is
insufficient.
