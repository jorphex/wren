# Threat Model

## Purpose

Wren is a desktop EVM wallet and account router. It accepts requests from local
HTTP/WebSocket clients and Wren Companion, presents approvals, and
routes approved signing operations to software or hardware signers.

This document describes the current implementation. It is not an audit or a
claim that every listed risk has been mitigated.

The current standards and wallet-method surface are documented in
[`SUPPORTED_EIPS.md`](SUPPORTED_EIPS.md) and
[`RPC_COMPATIBILITY.md`](RPC_COMPATIBILITY.md).

Wren rejects unhandled wallet/signing methods, the `admin_*`, `engine_*`, and
`miner_*` namespaces, and unreviewed `debug_*` methods instead of forwarding
them to the configured RPC. This prevents those node-account and administrative
method families from becoming a path around Wren's review boundary; ordinary
execution reads, reviewed debug queries, and explicitly signed raw transaction
broadcast remain available.

## Assets

- Software-signer seed and private-key material.
- Hardware-wallet requests, passphrases, pairing responses, and signatures.
- User approval intent, selected accounts, permissions, and connected origins.
- Transaction, typed-data, and personal-message contents.
- Network configuration, account metadata, and application update integrity.

Production logs retain operational identifiers and status, but exclude request,
transaction, typed-data, message, pairing-response, and signer-result payloads.
Explicitly enabled diagnostic logging may still expose non-secret account and
network metadata and should be handled as sensitive support data.

## Trust Boundaries

### Host And Local Clients

Wren binds HTTP and WebSocket JSON-RPC to `127.0.0.1:1248`. Loopback prevents
direct remote connections but does not authenticate another process running as
the same user. HTTP permits any CORS origin, and native clients can choose their
`Origin` header. Origin labels and permission prompts reduce accidental access;
they are not proof of process identity.

Valid web and browser-extension origins are canonicalized as full,
scheme-preserving URIs, so HTTP/HTTPS and WS/WSS permissions do not collapse into
one grant. Originless, opaque, malformed, oversized, and schemeless HTTP/WebSocket
clients receive server-generated identities scoped to one transport connection,
so separate connections cannot silently inherit legacy host-only or shared
`Unknown` permissions. Those identities and permissions are session-only and are
removed during startup recovery. Protected RPC methods require an account
permission. Passive account, asset, and capability probes do not open consent UI
and fail closed without a grant: account methods return no identity, while asset
and capability methods return `4100`. The current model does not fully isolate
permissions by authenticated native-process identity, account, chain, method, or expiry. Request bodies, HTTP
connections, WebSocket clients, and request rates have explicit ceilings. Header
and request-body receive times are bounded; HTTP subscription polls complete
within 15 seconds. Subscription IDs exposed to clients are opaque aliases bound
to the owning WebSocket or canonical HTTP origin and original chain. HTTP poll
clients, subscriptions, queued events/bytes, and idle lifetime are bounded;
WebSocket subscription count and buffered delivery are also bounded. These
controls prevent cross-client cancellation and unbounded inactive poll queues,
but a poll token and asserted origin are still not process authentication.

The separately distributed Wren Companion uses protocol version 2. Browser
scheme/ID and connection-role metadata select the handshake path but are not the
credential. A bounded nonce challenge binds browser identity, installation UUID,
P-256 public-key fingerprint, challenge ID, and expiry into a signed proof. The
first control session requires the user to compare and approve the same six-digit
code in Wren and Companion; Wren then stores the public credential. Known page
sessions may reuse that credential but cannot create a pairing prompt. Rotation
replaces and disconnects the prior key for that browser installation, and Wren
settings can revoke a credential explicitly.

This authenticates Companion to Wren so Wren can trust the dapp origins that
the browser extension derives from browser APIs. It does not authenticate Wren
or the localhost endpoint back to Companion, establish native process identity,
or protect against compromise of the browser profile or host account. A same-user
process that owns or intercepts port 1248 remains in the trusted computing base.

The operating system account is therefore a major trust boundary. Wren is not
expected to protect wallet data from malware, debuggers, or an administrator that
can read the user's files or process memory.

### Persisted State And Software Signers

Application state is stored in a mode-`0600` config file under Electron's
per-user data directory. Software signer files are stored below its `signers`
directory with mode `0600`. New seed and private-key material is
password-encrypted in a versioned envelope using scrypt-derived AES-256-GCM with
authenticated metadata. Material is decrypted only in a child process while the
signer is unlocked.

Legacy AES-256-CBC signer payloads remain decryptable. After a successful unlock,
the worker validates that the decrypted seed or keys derive the signer's stored
addresses before returning a new authenticated envelope. Wren retains the first
legacy signer JSON as a mode-`0600` `.legacy-v1.bak` recovery copy, then atomically
replaces the active JSON. Recovery copies are ignored by signer scanning and are
removed with the signer.

Current limitations:

- retained legacy recovery ciphertext is not authenticated and remains protected
  by the old signer password;
- encryption is not bound to an OS keychain or hardware-backed secret;
- metadata, addresses, permissions, and network settings are not encrypted;
- decrypted material exists in process memory while unlocked; and
- overwriting a file before deletion is not a secure-erasure guarantee on modern
  filesystems or solid-state storage.

Contact names, notes, addresses, and timestamps are local metadata in this
same profile; they are not encrypted and may reveal relationships. JSON backups
are explicitly user-created, validated and size-bounded on restore, and written
without returning their filesystem path to the renderer. A contact name is an
unverified user alias, never an authorization or destination source. Transaction
review derives aliases from current local state while retaining the full address,
and aliases never modify calldata, transaction recipients, signing, simulation,
or broadcast. Trusted labels reject Unicode control and formatting characters;
the corresponding migration removes only invalid legacy entries and preserves
the rest of the contacts list.

Users should prefer hardware signers and maintain independent backups. Encryption
migrations must remain versioned, address-verified, atomic, tested without real
wallet data, and recoverable without silently weakening encryption.

### Hardware Signers

Private keys are expected to remain on the hardware device. Wren still controls
the request shown to the device and depends on vendor libraries, firmware, USB
drivers, and the user comparing device output with the intended action. Blind or
incomplete device displays remain a risk.

Wren does not protect against compromised device firmware, malicious vendor
software, physical coercion, or a user approving unexpected data. Support claims
require physical-device testing and are listed in
[`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md).

### Renderer And IPC

Wren windows currently enable context isolation and renderer sandboxing, disable
Node integration and webviews, and deny navigation and popup creation. Production
renderers use Content Security Policy. A preload bridge and main-process IPC still
form a privileged boundary: exposed methods and payloads must be treated as
untrusted, validated, and limited to the sender that needs them.

Production startup rejects Chromium's `--no-sandbox` switch. AppImage hosts must
support unprivileged user namespaces rather than falling back to an unsandboxed
renderer process. Browser permission checks and requests, display capture,
Bluetooth pairing, device permissions, and HID/USB/serial/Bluetooth selectors are
denied for every Wren renderer and embedded dapp.

The current preload bridge accepts only bounded serialized envelopes from its own
window, an expected packaged/development origin, and the expected protocol source
label. One-way and invoke messages are limited to explicitly registered IPC
channels, request identifiers and argument counts are bounded, and malformed or
oversized messages are ignored without reaching Electron IPC. Every renderer RPC
method has typed request and response schemas, and inventory tests require exact
agreement between static renderer callsites, main-process handlers, and those
schemas. Tray and dashboard renderers still receive the full registered bridge
surface, so their compromise must be treated as a privileged wallet-process
compromise.

The main process assigns each shared-preload window a renderer role. Tray and
dashboard windows retain the full bridge surface; onboarding, notification, and
local dapp-shell windows are restricted to their enumerated RPC methods, IPC
channels, and store actions. Missing, unknown, or duplicate role arguments fail
closed. Remote dapp content runs in separate WebContentsViews and does not receive
this bridge. Main IPC registrations independently resolve `event.sender` through
a main-owned role map and apply the same capability policy; unregistered remote
views and role-incompatible requests are rejected. Individual handler payloads
are schema-validated before dispatch, but authorization and handler-specific
semantic checks remain part of the privileged main-process boundary.

Some renderer policies allow broad network or image sources. Embedded dapp views
load separately partitioned content and depend on session checks and request
filtering.

### Networks And Third Parties

RPC endpoints, explorers, IPFS gateways, ABI sources, pricing services, update
hosting, and signer-vendor services may be unavailable,
incorrect, or malicious. Transaction execution checks, reported token effects,
native balance-change traces, internal-call traces, allowance reads,
account-code classifications, and EIP-7702 account-delegation checks come from
the configured RPC and are not independently verified. Native balance-change
evidence is bounded, excludes code and storage, may omit gas fees, and is
unavailable on RPCs without Geth-compatible tracing. Internal-call evidence is
accepted only when the root call matches the reviewed sender, destination,
value, and calldata; its depth, frame count, child count, aggregate input size,
and failure text are bounded, and raw input/return data are not sent to the
renderer. A no-code result does not prove an EOA, and code presence does not
prove ERC-1271, Safe, or any other interface. Decoding and tracing are
explanatory and do not prove contract behavior. Users must verify chain,
recipient, value, calldata, and signing details on the hardware device whenever
possible.

Wren has no first-party hosted backend. Supported built-in networks default to
the visibly named PublicNode preset. PublicNode can observe the user's IP and all
RPC traffic routed through it, including account/contract reads, simulation and
trace inputs, calldata, and signed transactions submitted for broadcast. A
custom or local RPC replaces that provider per network. Migration 53 moves
supported Pylon presets to PublicNode and disables retired Pylon selections;
the old URL is retained only as inert migration history. A release gate rejects
active Pylon, Nebula-hosted IPFS, Frame CDN, or Frame runtime-package references.

DefiLlama pricing receives native-asset and tracked token identifiers for
connected supported mainnets. It does not receive the selected account address,
but the requested token set and timing can still fingerprint a wallet. Requests
are bounded and failure preserves prior local values. Wren sends no account to
an NFT indexer and removes the inherited inventory module rather than silently
substituting another account-indexing service.

IPFS.io receives the user's IP and requested content CID by default. Users can
select another HTTPS gateway or an explicit self-hosted Kubo API through Wren
environment settings. Kubo credentials are accepted only from separate token
configuration, not an endpoint URL. Gateway/API paths, response sizes, and
stream duration are bounded. Recognized token artwork is loaded only from the
explicitly trusted CoinGecko asset host; arbitrary remote artwork falls back to
a local icon rather than creating an unrestricted renderer request.

The embedded Send application is pinned to a source-reviewed content CID and
verified as a complete UnixFS directory before activation. Wren does not follow
mutable ENS updates for it. The general token inventory is bundled with each
release rather than refreshed from a legacy Frame-controlled name. These
snapshots can become stale; updates require a reviewed Wren source change and
release.

Renderer-requested external links use a fixed allowlist. User-configured block
explorers bypass that fixed host list by design, but the final OS-launch sink
accepts only credential-free HTTP(S) URLs; file, script, custom-protocol, and
credential-bearing values are rejected.

Wren recognizes the exact EIP-7702 delegation indicator returned by
`eth_getCode`, requires an additional approval for ordinary transactions from a
reported delegated account, and blocks sequential wallet-call batches from one.
Externally supplied type-4 transactions and authorization lists are rejected;
Wren does not create or sign EIP-7702 authorizations. Delegation state can
change after review, and a faulty or malicious RPC can omit or falsify it.

Externally supplied transaction envelopes are restricted to fields and types
Wren explicitly supports. Access lists have bounded entry and storage-key
counts, require exact address/key widths, retain order and duplicates, and are
shown in full during review. Signer adapters must preserve those exact bytes;
unsupported hardware transaction types fail instead of being silently converted.

The Earn module has two separate Yearn trust boundaries. A
versioned local `(chainId, vaultAddress)` catalog is the only promotion boundary;
Kong metadata cannot add a vault or transaction target. Wren locally pins asset
addresses and decimal scales; Kong supplies display names, estimated APY, TVL,
fees, risk metadata, and eligibility signals. A fresh eligible response is
required for a new deposit. Cached or failed metadata can preserve visibility
and exits but cannot enable a new deposit. The configured RPC supplies balances,
allowances, ERC-4626 quotes, product relationships, token decimals, cooldown
state, simulation, and receipts. A malicious or stale RPC can misreport those
values, and simulation cannot prove later execution.

The same local catalog supplies a hidden balance-scanner allowlist for curated
underlying assets, vault shares, and companion shares. These entries do not
become custom tokens and do not create balances by themselves; only a nonzero
configured-RPC `balanceOf` result enters the account's known-token state. A zero
balance is removed as usual. Remote token-list omit metadata cannot suppress
these locally pinned entries. Product state such as a yvUSD cooldown may represent
non-transferable accounting without a wallet-held ERC-20 balance and remains
visible only through Earn.

Earn transactions are restricted to the allowlisted vault, companion, and
first-party periphery contracts documented in [`YEARN_EARN.md`](YEARN_EARN.md).
The main process rebuilds calldata, verifies on-chain asset relationships and
decimal scales, and
re-recognizes each persisted step before queueing it through Wren's ordinary
transaction path. Renderer-provided targets, token metadata, calldata, and action
labels are not trusted. Approvals are exact and a mismatched existing allowance
is reset before replacement. Product contracts and strategies can still contain
bugs, governance risk, economic loss, or malicious upgrades; Wren does not audit
or guarantee their safety or yield.

This fork does not initialize or ship a hosted crash-telemetry client. Uncaught
main-process errors are written to the local Electron log and may display a local
dialog, but Wren does not transmit crash events, instance identifiers, network
configuration, or token metadata to the upstream project's Sentry service.

### Builds And Updates

Dependencies are locked and install scripts are allowlisted. CI actions are
pinned, Linux packages include checksums and an SBOM, and the manual workflow
creates a draft release for review. The companion repository separately produces
source-bound deterministic Chrome/Firefox archives, checksums, compatibility
metadata, and a production SBOM. Linux desktop artifacts are not currently
signed, and byte-for-byte reproducible desktop builds have not been established.
macOS and Windows signing are not configured for this fork.

The updater derives its release repository from package metadata and requires a
user action before download/install. Release credentials, GitHub administration,
CI runners, npm packages, and maintainer workstations remain supply-chain trust
boundaries. See [`RELEASE.md`](RELEASE.md).

## Primary Abuse Cases

- A local process impersonates a trusted origin and requests account access or a
  signature.
- A dapp disguises an approval, typed-data signature, or transaction intent.
- Malformed or oversized RPC/IPC input exhausts resources or reaches an unsafe
  code path.
- A compromised renderer invokes an overpowered preload or IPC method.
- An attacker copies or modifies encrypted software-signer files.
- A dependency, release workflow, updater feed, or binary is compromised.
- Hardware and application displays disagree and the user approves the device.
- Persisted-state migration corrupts permissions, accounts, or signer metadata.

## Security Invariants For New Work

- Never log or persist plaintext seeds, private keys, passwords, or passphrases.
- Never sign or broadcast without an explicit, origin-bound approval unless a
  separately reviewed policy explicitly permits it.
- Normalize and validate every external request before permission checks and UI.
- Preserve chain binding, transaction type, and access list, and display the
  actual payload sent to the signer.
- Keep renderer privileges minimal and validate IPC payloads and senders.
- Fail closed when origin, chain, signer capability, simulation, or decoding is
  ambiguous.
- Keep watch-only accounts non-signing at main-process request state transitions;
  renderer controls and signer lookup failures are not security boundaries.
- Preserve user data through tested, versioned migrations with rollback guidance.
- Keep pull-request CI unable to publish or access release credentials.
- Do not claim hardware or platform support based only on mocks or compilation.

## Out Of Scope

- Recovery from a compromised operating system, maintainer account, or hardware
  wallet firmware.
- Loss caused by exposing a seed phrase, private key, password, or passphrase.
- Smart-contract correctness or economic safety of a transaction the user
  knowingly approves.
- Availability or correctness of user-selected RPC and third-party services.
- Physical attacks and coercion.

These exclusions do not make related reports unhelpful. Boundary bypasses that
let an attacker act without the documented access or approval are in scope.
