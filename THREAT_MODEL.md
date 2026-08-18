# Threat model

## Purpose and scope

Wren is a desktop EVM wallet and account router. It accepts local HTTP/WebSocket
and Wren Companion requests, obtains approval, and routes approved work to
software or hardware signers.

This document describes the implementation. It is not an audit and does not
claim that every risk is mitigated. The method surface is in
[`SUPPORTED_EIPS.md`](SUPPORTED_EIPS.md) and
[`RPC_COMPATIBILITY.md`](RPC_COMPATIBILITY.md).

Unhandled wallet and signing methods, `admin_*`, `engine_*`, `miner_*`, and
unreviewed `debug_*` calls are rejected rather than forwarded. Ordinary reads,
reviewed debug queries, and explicitly signed raw-transaction broadcasts remain
available.

## Navigation

- [Assets](#assets)
- [Adversaries](#adversaries)
- [Residual risks](#residual-risks)
- [Local clients and Companion](#local-clients-and-companion)
- [Local state and signers](#local-state-and-signers)
- [Renderer and IPC](#renderer-and-ipc)
- [Networks, content, and Earn](#networks-content-and-earn)
- [Builds and updates](#builds-and-updates)
- [Invariants for new work](#invariants-for-new-work)

## Assets

Assets include software seeds/keys; hardware requests, passphrases, pairing
responses, and signatures; approval intent, accounts, permissions, and origins;
transaction/message contents; network configuration and metadata; and update
integrity. Production logs retain operational identifiers and status, but exclude
request, transaction, typed-data, message, pairing-response, and signer-result
payloads. Optional diagnostics can expose non-secret account/network metadata and
are sensitive support data.

## Adversaries

Wren does not protect against malware, debuggers, an administrator, a compromised
host or maintainer account, hardware firmware or vendor software, physical
coercion, or a user approving unexpected data.

## Residual risks

Compare a device display with the intended action. Wren does not guarantee
contract correctness or economic safety, third-party or RPC correctness or
availability, or losses after a secret is exposed. Boundary bypasses that act
without documented access or approval are in scope.

## Boundaries and controls

### Local clients and Companion

HTTP and WebSocket JSON-RPC listen on `127.0.0.1:1248`. Loopback blocks remote
connections, but not another process owned by the same user. Legacy and
browser-compatible routes accept asserted origins. Labels and prompts reduce
accidents, but do not establish process identity.

HTTP requests and WebSocket upgrades require an IPv4/IPv6 loopback `Host` that
matches the listening port. This blocks DNS-rebinding authorities, but does not
authenticate a local process. Canonical, scheme-preserving web and extension
origins keep HTTP/HTTPS and WS/WSS grants separate.

Root routes reject originless, opaque, malformed, schemeless, and reserved
internal-origin claims before provider dispatch or the consent UI. Local native
and CLI clients must pair through protocol 3. Protected methods require account
permission. Passive account, asset, and capability probes never open the consent
UI and fail closed: account methods reveal no identity, and asset/capability
methods return `4100`.

Permissions are scoped by account, chain, method, expiry, and invoker identity.
Direct browser-compatible identities remain assertions. Authenticated native
clients and Companion credentials cannot reuse those grants.

RPC bodies, connections, rates, header/body receive time, polls (15 seconds),
subscription counts, queues/bytes, and idle lifetime are bounded. Client-visible
subscription IDs are opaque and bound to their WebSocket or canonical HTTP origin
and original chain. This prevents cross-client cancellation and unbounded
inactive poll queues, but a poll token or asserted origin is not authentication.

Originless native clients use protocol-v3 HTTP or WebSocket authentication.
Wren and the client exchange signed P-256 challenges, bind the installation,
role, channel, nonces, expiry, session, request path, and request-body hash, and
require matching six-digit consent for a new key. Every native request carries a
short-lived one-use proof. Browser origins cannot access these routes. Exact-key
reconnects are silent. A newly approved key remains a separate connection even if
it claims an existing installation identifier; replacing old trust requires manual
revocation, which invalidates its sessions, transports, polls, subscriptions,
queued requests, grants, and source identity.

Companion protocol 3 mutually authenticates the Wren desktop and an atomic
control/page public-key bundle with the same signed transcript family. Only a
control channel can request pairing; page channels must reuse approved trust.
The signed final acknowledgement precedes persistence, and an acknowledged
replacement retains the old bundle until an exact-new reconnect proves adoption.
Recognizable protocol-v2 clients receive an explicit upgrade error and cannot
downgrade. This authenticates the two applications and isolates their grants; it
does not defend a compromised browser profile, native client, or host.

### Local state and signers

#### Software signer files

The per-user config and signer files are mode `0600`; the `signers/` directory is
mode `0700` on POSIX. New seed/key material uses a versioned, authenticated
scrypt-derived AES-256-GCM envelope and is decrypted only in an unlocked child
process launched without inherited credential or Node-injection environment
variables. Legacy AES-256-CBC payloads remain readable; after unlock, address
derivation is checked, the original JSON is retained once as mode-`0600`
`.legacy-v1.bak`, and the active file is replaced atomically. Backups are ignored
during scanning. They are removed with the signer or after a later successful
authenticated-envelope unlock proves the replacement can be read; a failed
unlock or migration keeps the recovery copy. OS suspend and screen-lock events
relock every unlocked software signer.

On Linux and Windows x64, users may additionally bind all software-signer files,
including a retained legacy recovery copy, to the current operating-system
credential context. This is a versioned outer layer around the existing
password-encrypted record; it neither stores the signer password nor enables
passwordless unlock. Linux accepts only Electron's Secret Service
(`gnome_libsecret`) and KWallet backends and rejects `basic_text` and `unknown`.
Windows uses Electron `safeStorage` through DPAPI and never queries the Linux-only
selected-backend API. macOS remains unsupported. Wren rejects an unavailable
credential store, another identity's undecryptable data, a corrupt policy marker,
and any mixed protected/unprotected transition. In those states no software
signer is loaded at startup or after the failure is detected, and new signer
writes are refused. Each encrypted payload is bound to its filename, migrations
replace one private file at a time, and a profile marker is committed last when
enabling and removed last when disabling. An interrupted change must be
explicitly finished or reversed from Settings after the original credential
context is available.

Limits: while retained, legacy backup ciphertext is unauthenticated and protected
by its old password inside either local storage layer. Device protection does not
defend a compromised logged-in session, credential store, Wren process, signer
worker, or host, and loss of the original credential context makes the bound
local signer files unavailable. DPAPI does not isolate Wren from other processes
running as the same Windows user. Without the optional OS-backed layer, signer
encryption remains password-only. The outer layer is at-rest protection, not
continuous authorization: a signer already loaded into a running Wren process is
governed by the normal password and process-lock lifecycle. It is never
hardware-bound.
Live-profile metadata, addresses,
permissions, and networks are unencrypted; unlocked secrets exist in memory; and
overwrite-before-delete is not secure erasure on modern filesystems or SSDs.

#### Local metadata

Contacts, notes, addresses, and timestamps are unencrypted relationship metadata.
The address-safety index is also local unencrypted metadata: it keeps at most 500
one-year records containing a profile-bound SHA-256 full-address digest, the first
and last four hexadecimal characters needed for exact-end lookalike comparison,
and the latest accepted outbound-submission time. A digest is not encryption. The
index never learns from incoming activity, explorers, RPC history, simulation,
arbitrary calldata, declines, or failed pre-broadcast work; clearing Activity clears
the index, and profile backup excludes it. These warnings are evidence for review,
not an assertion that a destination is safe or malicious.

#### Profile backups

User-created `.wren-backup` files are size-bounded, scrypt-derived AES-256-GCM
envelopes over an explicit recovery allowlist. They include configuration and
validated encrypted software-signer records, but exclude activity, address-safety
memory, pending work,
runtime observations, caches, installed dapp content, and Companion credentials;
hardware devices keep their keys. Export writes a new mode-`0600` regular file.
When OS-backed device protection is enabled, export first verifies the
all-or-nothing local policy and removes only that outer layer in main memory; the
backup contains the original password-encrypted signer record and never contains
the device marker or device-bound ciphertext. Export fails if the source
credential context cannot open every record. Restored signer files intentionally
start password-only on the destination so recovery never depends on the source
device; users may explicitly enable the destination layer afterward.
Restore keeps the chosen path in main, binds a short-lived single-use token to its
identity, bytes, and inspected metadata, then requires an explicit replace action.
The replacement runs before application bootstrap using an atomic swap, receipt,
and rollback; a target is not committed unless it revalidates. The backup password
is user-managed, not keychain-bound, and restoring intentionally requires Companion
re-pairing. Names are unverified aliases, never an authorization or destination
source; review keeps the full address and aliases do not alter calldata, recipients,
signing, simulation, or broadcast. Trusted labels reject Unicode control/format
characters; migration removes only invalid legacy entries. Prefer hardware signers
and independent backups. Encryption migrations must stay versioned,
address-verified, atomic, tested with non-real data, and recoverable without
weakening encryption.

#### Hardware signers

Hardware keys are expected to stay on-device, but Wren controls the presented
request and depends on firmware, vendor libraries, and USB drivers. Blind or
incomplete displays are risky. Claims require physical-device evidence in
[`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md).

### Renderer and IPC

#### Renderer isolation

Windows use context isolation and sandboxing; Node integration and webviews are
off, navigation/popups and browser permissions are denied, and production
renderers have CSP. Production startup rejects `--no-sandbox`; AppImage requires
unprivileged user namespaces rather than an unsandboxed fallback. Display capture,
Bluetooth pairing, device permission, and HID/USB/serial/Bluetooth selectors are
denied for Wren renderers and embedded dapps.

#### IPC authority

The preload accepts only bounded serialized envelopes from its own window, an
expected packaged/development origin, and protocol label. Only registered IPC
channels are accepted; request IDs and argument counts are bounded; malformed or
oversized messages stop before Electron IPC. Typed request/response schemas and
inventory tests require agreement among renderer callsites, handlers, and
schemas. A main-owned role map independently authorizes the sender: each surface
receives only its enumerated RPC, IPC, and store actions, and profile recovery is
dashboard-only; missing, unknown, or duplicate roles fail closed. Remote dapp
WebContentsViews lack the bridge. Handler payload
validation exists, but handler semantics and authorization remain privileged
main-process work. Compromised tray/dash and broad renderer network/image policy
remain high-impact; embedded dapps depend on partitioning, session checks, and
request filtering.

#### Balance worker

The hidden balance worker has no localhost provider authority. Its parent IPC
broker accepts only bounded latest-block `eth_call` and `eth_getBalance` reads
for an explicit enabled chain, with strict schemas, request limits, and timeouts.
The main process selects and owns the configured RPC connection.

### Networks, content, and Earn

#### RPC and execution evidence

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

Before transaction signing, the main process asks the configured chain RPC for
the account's pending native balance and compares it with the reviewed value plus
the maximum execution fee; Optimism-family requests also require the available
L1 data-fee estimate. Missing or malformed quantities fail closed before signer
invocation. A shortfall keeps the original dapp responder and review alive,
exposes exact available/required/missing quantities, and requires a fresh
balance, fee, and simulation review before approval can resume. This prevents a
known-unfunded signing attempt but does not reserve funds or eliminate races with
other pending transactions, RPC disagreement, reorgs, or fees changing after the
check.

#### Remote services and content

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

#### Transactions and EIP-7702

The exact `eth_getCode` EIP-7702 indicator triggers extra approval for ordinary
transactions and blocks sequential wallet-call batches. Type-4 envelopes and
authorization lists are rejected; Wren creates/signs no authorizations. State can
change after review and RPC can lie. Input transactions have only supported fields
and types; access lists are bounded, exact-width, order/duplicate preserving, and
fully shown. Signers must preserve bytes; unsupported hardware types fail.

Speed Up and Cancel are ordinary reviewed same-nonce transactions. The main process
uses the greater of current configured-RPC fees and the exact replacement minimum,
rechecks the original receipt and latest nonce immediately before signer invocation,
and persists only public hash/nonce plus UUID relationship evidence. Cancel is a
zero-value self-transfer that succeeds only if it confirms first. Linked lifecycle
rows can recover an older transaction from `replaced` after a replacement reorg;
Wren never treats the button or a mempool observation as proof of cancellation.

#### Earn

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

#### Supply-chain boundaries

Dependencies are locked and install scripts allowlisted; CI actions are pinned.
Linux release evidence is checksums, SBOM, a reviewed draft workflow, and GitHub
provenance—not signatures. Two-build evidence covers identical application
payloads, native modules, SBOM, and deb bytes, but not AppImage container bytes.
Companion archives are separately source-bound/deterministic with checksums,
compatibility metadata, and a production SBOM. macOS/Windows signing is absent.
The updater uses package metadata's repository and needs user action to
download/install. Release credentials, GitHub administration, CI, npm packages,
and maintainer workstations are supply-chain boundaries; see
[`RELEASE.md`](RELEASE.md).

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
