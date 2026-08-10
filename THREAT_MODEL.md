# Threat model

Wren is a desktop EVM wallet and account router. It accepts local HTTP/WebSocket
and Wren Companion requests, obtains approval, and routes approved work to
software or hardware signers. This is an implementation description, not an
audit or a claim that every risk is mitigated. The method surface is in
[`SUPPORTED_EIPS.md`](SUPPORTED_EIPS.md) and
[`RPC_COMPATIBILITY.md`](RPC_COMPATIBILITY.md). Unhandled wallet/signing methods,
`admin_*`, `engine_*`, `miner_*`, and unreviewed `debug_*` calls are rejected
rather than forwarded; ordinary reads, reviewed debug queries, and explicitly
signed raw-transaction broadcast remain available.

## Assets and limits

Assets include software seeds/keys; hardware requests, passphrases, pairing
responses, and signatures; approval intent, accounts, permissions, and origins;
transaction/message contents; network configuration and metadata; and update
integrity. Production logs retain operational identifiers and status, but exclude
request, transaction, typed-data, message, pairing-response, and signer-result
payloads. Optional diagnostics can expose non-secret account/network metadata and
are sensitive support data.

Wren does not protect against malware, debuggers, an administrator, a compromised
host or maintainer account, hardware firmware/vendor software, physical coercion,
or a user approving unexpected data. A device display still needs to be compared
with the intended action. It does not guarantee contract correctness or economic
safety, third-party/RPC correctness or availability, or losses after a secret is
exposed. Boundary bypasses that act without documented access or approval are in
scope.

## Boundaries and controls

### Local clients and Companion

HTTP and WebSocket JSON-RPC listen on `127.0.0.1:1248`. Loopback blocks remote
connections, not another same-user process: CORS accepts any origin and native
clients can choose `Origin`. Labels and prompts reduce accidents, not establish
process identity. Canonical, scheme-preserving web/extension origins keep
HTTP/HTTPS and WS/WSS grants separate. Originless, opaque, malformed, oversized,
and schemeless clients get a per-connection server identity. It is session-only
and removed at startup recovery, so connections cannot inherit legacy host-only
or shared `Unknown` grants. Protected methods need account permission; passive
account, asset, and capability probes never open consent UI and fail closed
(account methods reveal no identity; asset/capability methods return `4100`).
Permissions are not fully isolated by authenticated process identity, account,
chain, method, or expiry.

RPC bodies, connections, rates, header/body receive time, polls (15 seconds),
subscription counts, queues/bytes, and idle lifetime are bounded. Client-visible
subscription IDs are opaque and bound to their WebSocket or canonical HTTP origin
and original chain. This prevents cross-client cancellation and unbounded
inactive poll queues, but a poll token or asserted origin is not authentication.

Companion protocol 2 uses browser scheme/ID and connection role only to select a
handshake. A bounded signed nonce proof binds browser identity, installation UUID,
P-256 key fingerprint, challenge ID, and expiry. The first control session needs
matching six-digit user approval; Wren stores the public credential. Known page
sessions can reuse it but cannot prompt; rotation replaces/disconnects the old
key, and settings can revoke it. This lets Wren trust browser-derived dapp
origins, but does not authenticate Wren/localhost to Companion, identify native
processes, or defend a compromised browser profile or host. A process that owns
or intercepts port 1248 is trusted.

### Local state and signers

The per-user config and signer files (`signers/`) are mode `0600`. New seed/key
material uses a versioned, authenticated scrypt-derived AES-256-GCM envelope and
is decrypted only in an unlocked child process. Legacy AES-256-CBC payloads
remain readable; after unlock, address derivation is checked, the original JSON
is retained once as mode-`0600` `.legacy-v1.bak`, and the active file is replaced
atomically. Backups are ignored during scanning and removed with the signer.

Limits: legacy backup ciphertext is unauthenticated and protected by its old
password; encryption is neither keychain nor hardware bound; metadata, addresses,
permissions, and networks are unencrypted; unlocked secrets exist in memory; and
overwrite-before-delete is not secure erasure on modern filesystems/SSDs.
Contacts, notes, addresses, and timestamps are unencrypted relationship metadata.
User-created JSON backups are size-bounded and validated on restore and their
paths are not returned to the renderer. Names are unverified aliases, never an
authorization or destination source; review keeps the full address and aliases
do not alter calldata, recipients, signing, simulation, or broadcast. Trusted
labels reject Unicode control/format characters; migration removes only invalid
legacy entries. Prefer hardware signers and independent backups. Encryption
migrations must stay versioned, address-verified, atomic, tested with non-real
data, and recoverable without weakening encryption.

Hardware keys are expected to stay on-device, but Wren controls the presented
request and depends on firmware, vendor libraries, and USB drivers. Blind or
incomplete displays are risky. Claims require physical-device evidence in
[`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md).

### Renderer and IPC

Windows use context isolation and sandboxing; Node integration and webviews are
off, navigation/popups and browser permissions are denied, and production
renderers have CSP. Production startup rejects `--no-sandbox`; AppImage requires
unprivileged user namespaces rather than an unsandboxed fallback. Display capture,
Bluetooth pairing, device permission, and HID/USB/serial/Bluetooth selectors are
denied for Wren renderers and embedded dapps.

The preload accepts only bounded serialized envelopes from its own window, an
expected packaged/development origin, and protocol label. Only registered IPC
channels are accepted; request IDs and argument counts are bounded; malformed or
oversized messages stop before Electron IPC. Typed request/response schemas and
inventory tests require agreement among renderer callsites, handlers, and
schemas. A main-owned role map independently authorizes the sender: tray/dash
retain the full bridge; onboarding, notification, and local dapp shell have only
their enumerated RPC, IPC, and store actions; missing, unknown, or duplicate
roles fail closed. Remote dapp WebContentsViews lack the bridge. Handler payload
validation exists, but handler semantics and authorization remain privileged
main-process work. Compromised tray/dash and broad renderer network/image policy
remain high-impact; embedded dapps depend on partitioning, session checks, and
request filtering.

### Networks, content, and Earn

RPCs, explorers, IPFS, ABI/pricing/update/signer-vendor services can fail or lie.
RPC-supplied execution checks, effects, balances, traces, allowances, code,
delegation, quotes, simulation, and receipts are not independently verified.
Native-balance evidence is bounded, omits code/storage and possibly gas, and
needs Geth-compatible tracing. Internal-call evidence is accepted only when the
root matches reviewed sender/destination/value/calldata; depth, frames, children,
input size, and error text are bounded and raw input/return data stays out of the
renderer. No code does not prove EOA; code does not prove an interface. Decoding
and traces explain, not prove, behavior. Verify chain, recipient, value,
calldata, and device display whenever possible.

Wren has no first-party backend. Built-in networks use visibly named PublicNode;
it can observe IP and routed account/contract reads, simulation/traces, calldata,
and broadcasts. A custom/local RPC replaces it per network. Migration 53 retires
Pylon for PublicNode; old Pylon URLs are inert history, and the release gate
rejects active Pylon, Nebula-hosted IPFS, Frame CDN, and Frame runtime packages.
DefiLlama sees native-asset and tracked-token IDs for supported mainnets, not the
selected account, though timing/token sets can fingerprint; failures keep old
values. There is no NFT account indexer. Default IPFS.io sees IP and CID; users
may choose HTTPS gateway or separately-tokened self-hosted Kubo. Paths, response
sizes, and stream duration are bounded. Only CoinGecko artwork is remote; other
artwork uses a local fallback. Send is pinned to a reviewed CID and complete
UnixFS directory, not mutable ENS; bundled token inventory can become stale.
External links are allowlisted except configured explorers, whose final OS launch
still permits only credential-free HTTP(S).

The exact `eth_getCode` EIP-7702 indicator triggers extra approval for ordinary
transactions and blocks sequential wallet-call batches. Type-4 envelopes and
authorization lists are rejected; Wren creates/signs no authorizations. State can
change after review and RPC can lie. Input transactions have only supported fields
and types; access lists are bounded, exact-width, order/duplicate preserving, and
fully shown. Signers must preserve bytes; unsupported hardware types fail.

Earn promotes only its versioned local `(chainId, vaultAddress)` catalog. Kong
cannot add targets; Wren pins assets and decimals, while Kong supplies display
metadata and eligibility. Only fresh eligible metadata enables a deposit; cached
or failed data can show positions/exits, never new deposit. The local catalog
also supplies a hidden balance scanner: only nonzero configured-RPC `balanceOf`
enters known tokens; zero removes it, and remote omit metadata cannot suppress it.
Cooldown state can be Earn-only. Transactions are limited to documented
[`YEARN_EARN.md`](YEARN_EARN.md) allowlisted vault, companion, and first-party
periphery contracts. The main process rebuilds calldata, verifies relationships
and decimals, re-recognizes persisted steps, ignores renderer-provided target,
metadata, calldata, and labels, and uses exact approvals (resetting mismatched
ones). Contracts/strategies can still be buggy, governed, upgraded, malicious,
or lose funds; Wren makes no safety or yield guarantee. Wren ships no hosted crash
client: uncaught main errors stay local and are not sent to upstream Sentry.

### Builds and updates

Dependencies are locked and install scripts allowlisted; CI actions are pinned.
Linux release evidence is checksums, SBOM, a reviewed draft workflow, and GitHub
provenance—not signatures or demonstrated reproducible builds. Companion archives
are separately source-bound/deterministic with checksums, compatibility metadata,
and a production SBOM. macOS/Windows signing is absent. The updater uses package
metadata's repository and needs user action to download/install. Release
credentials, GitHub administration, CI, npm packages, and maintainer workstations
are supply-chain boundaries; see [`RELEASE.md`](RELEASE.md).

## Invariants for new work

- Never log or persist plaintext secrets.
- Never sign or broadcast without explicit origin-bound approval unless a reviewed
  policy explicitly allows it.
- Normalize input before permission/UI work; fail closed on ambiguous origin,
  chain, signer capability, simulation, or decoding.
- Preserve chain, transaction type, and access-list bytes and show the signed
  payload.
- Minimize renderer privilege and validate IPC senders/payloads.
- Keep watch-only accounts non-signing in main-process transitions; renderer
  controls and signer-lookup failures are not security boundaries.
- Keep migrations tested, versioned, recoverable, and rollback-guided.
- Keep pull-request CI unable to publish or access release credentials.
- Do not claim platform/hardware support from mocks or compilation alone.
