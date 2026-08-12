# Advanced Execution Boundaries

Wren implements only execution paths it can review, sign, submit, and reconcile
without dropping protocol data or trusting arbitrary execution code. The
programs below remain deliberately limited until their listed product and trust
boundaries are selected.

**Planning status:** these are fail-closed reference boundaries, not active tasks.
Generic delegation creation, atomic batches without an account-owned executor,
and wallet-authored blob transactions are not planned under the current product
model; revisit only after their named trust/deployment choices exist.

## EIP-7702 delegation

### Current support

Wren detects configured-RPC delegation indicators and offers one wallet-owned
operation: a selected, unlocked Ring or Seed account can authorize the zero
address to revoke its current delegation. The request is self-funded, has no
value or calldata, uses one chain-specific authorization, rechecks code, nonce,
fees, signer, and chain before signing, and monitors receipt plus post-transaction
code evidence.

All externally supplied type-4 transactions and authorization lists are rejected.
This is intentional: EIP-7702 gives delegate code unrestricted authority in the
account's context and explicitly warns wallets not to expose a generic interface
for app-suggested authorizations.

### Creation and replacement prerequisites

Software creation needs a Wren-selected delegate registry containing, per chain:

- an audited delegate version, address, runtime code hash, deployment provenance,
  and activation policy;
- the exact initialization ABI and a signature binding authority, chain, target,
  value, calldata, gas, and replay protection;
- storage layout, migration, upgrade, and rollback policy for replacement;
- a chain-specific authorization policy (no universal chain ID by default),
  account-nonce reservation, and a one-pending-transaction limit;
- explicit high-risk review copy and revocation/recovery behavior.

Creation cannot be inferred from bytecode or accepted from an external client. EIP-7702 has
no initcode or atomic initialization, and authorization effects are not rolled
back when outer execution fails. Replacement must model the outer transaction
nonce and each authority nonce separately; Wren's ordinary speed-up/cancel path
cannot safely copy a type-4 payload.

General type-4 support remains blocked until that registry and policy are chosen.
Hardware expansion remains separately blocked on vendor support and physical
qualification.

## Atomic EIP-5792

### Current support

Wren executes accepted wallet-call batches as explicitly non-atomic sequential
transactions. It advertises `atomic.status: "unsupported"`, rejects
`atomicRequired: true` before creating a review or ledger entry, and rejects
sequential batches from delegated senders.

A generic multicall contract is not equivalent to account execution: it changes
`msg.sender`, balances, allowances, and failure semantics. Sequential nonces do
not provide atomicity or contiguity.

### Atomic executor prerequisites

Atomic support needs one selected account-owned executor:

- either the pinned EIP-7702 delegate above or the pinned ERC-4337 adapter in
  [Smart Accounts](SMART_ACCOUNTS.md);
- an exact bounded batch ABI, ordered value accounting, account-only admission,
  and revert-on-any-failure semantics;
- code/deployment hashes and chain eligibility, plus simulation of the actual
  single atomic envelope and a complete pre-signing evidence recheck;
- exactly one outer transaction or UserOperation, with no sequential fallback;
- persisted atomic submission/reconciliation and one scoped receipt result. A
  full envelope revert is failure, never sequential partial completion;
- tests for code/nonce drift, all-call revert, no interleaving, ambiguous
  submission, restart recovery, permission revocation, and receipt/log scoping.

Wren must not advertise `supported` or `ready` until this executor is selected
and the complete path passes. Installing a delegation during the requested batch
does not make the batch safely atomic because a failed outer call does not undo
the authorization.

## EIP-4844 type-3 transactions

### Current support

Wren rejects type-3 transactions and blob fields before review, including signed
type-3 payloads submitted through `eth_sendRawTransaction`. Its transaction
domain, fee model, replacement logic, generic software serializer, and hardware
capabilities currently cover only legacy, type-1, and type-2 transactions.

### Complete type-3 prerequisites

Support requires all of the following as one coherent path:

- Cancun/blob activation and fee metadata per supported chain, including
  consistent parent `excessBlobGas`/`blobGasUsed` evidence, the current blob base
  fee, and the per-block blob-gas limit;
- strict type-3 fields: non-null destination, non-empty version-`0x01` 32-byte
  hash list, exact quantities, access list, and bounded blob count;
- an audited KZG implementation and pinned trusted setup;
- a declared input policy for raw blob bytes versus precomputed sidecars. Full
  submission requires exact-size blobs, commitments, proofs, matching versioned
  hashes, equal counts, and the network wrapper—not hashes alone;
- transient bounded sidecar handling that does not silently persist or omit blob
  data;
- blob base-fee estimation requiring `maxFeePerBlobGas` at least the current base
  fee, a batch within the block blob-gas limit, and a total cap covering execution
  gas plus `blobCount × blobGasPerBlob × maxFeePerBlobGas`;
- software signing of the canonical type-3 body, followed by independent
  sidecar validation and attachment in the complete network representation for
  broadcast; unsupported hardware must reject explicitly;
- replacement logic that preserves blob evidence and safely updates both
  execution and blob fee caps;
- authoritative codec/KZG vectors, malformed-sidecar tests, node compatibility,
  review coverage, and end-to-end submission/reconciliation evidence.

Ethers can represent type-3 bodies, but Wren has no KZG dependency or sidecar
trust boundary. Enabling body parsing alone would drop required evidence and is
not support.

## Finish condition

A status changes only when the selected product/deployment decisions exist and
Wren owns the complete fail-closed lifecycle with automated evidence. Until
then, the current rejection paths and conservative support claims are the
implemented safety contract.
