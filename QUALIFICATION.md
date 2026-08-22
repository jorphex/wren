# Desktop and Companion release qualification checklist

This is the manual gate for a paired Wren desktop and Wren Companion candidate.
It supplements automated tests and is not an audit. Use disposable accounts and Ethereum
Sepolia (`0xaa36a7`) or Base Sepolia (`0x14a34`) unless testing Earn, which uses
minimal live-fund flows. Never publish seeds, keys, PINs, passphrases, pairing
responses, full addresses, signatures, transaction hashes, device IDs, or profile
contents. Use the [release procedure](RELEASE.md) for packaging and publication;
use the [signer and platform support reference](HARDWARE_SUPPORT.md) for current
device and platform boundaries. The unsigned Windows preview has a separate
[release checklist](WINDOWS_RELEASE_QUALIFICATION.md). Windows DPAPI signer
protection has an additional
[native VM checklist](WINDOWS_SIGNER_PROTECTION_QUALIFICATION.md).

## Checklist navigation

- [1. Record the candidate and automated evidence](#1-record-the-candidate-and-automated-evidence)
- [2. Run the required operator checks](#2-run-the-required-operator-checks)
- [3. Qualify EIP-5792 and EIP-7702 boundaries](#3-qualify-eip-5792-and-eip-7702-boundaries)
- [4. Qualify contract source verification](#4-qualify-contract-source-verification)
- [5. Run Earn-only qualification](#5-run-earn-only-qualification)
- [6. Decide pass or fail and retain evidence](#6-decide-pass-or-fail-and-retain-evidence)
- [Historical 0.8.0 Linux x64 evidence](#historical-080-linux-x64-evidence)

## 1. Record the candidate and automated evidence

Record desktop and Companion version/commit, Companion minimum desktop commit,
AppImage/deb/unsigned Windows installer/Chrome ZIP/Firefox ZIP SHA-256, and
OS/kernel/browser versions.
Verify both artifact-directory `SHA256SUMS` files; Companion compatibility must
name the candidate branch and an ancestor desktop commit. Record exact workflow
URLs (or equivalent local evidence) for desktop and Companion quality/package,
CodeQL, and release verifier runs from these exact commits. The desktop verifier
must cover both packages, checksums, source-bound SBOM, embedded source identity,
and native hardware modules; the Companion verifier must cover both archives,
checksums, compatibility metadata, and source-bound SBOM.

The isolated desktop `npm run test:e2e` suite covers permission denial/revocation,
review rejection, sequential EIP-5792 success and partial failure, restart recovery,
and origin/account status scoping without using live Wren ports or public networks.
The native smoke matrix builds real unsigned Linux arm64, macOS x64/arm64, and
Windows x64 packages on matching runners, then compares packaged runtime evidence
from the unpacked application and each extracted archive. These jobs verify source
identity, runtime architecture, resources, native modules, and existing runtime
invariants. Its retained `unsigned-unqualified` artifacts are not release,
installer, GUI, hardware, signing, or platform-qualification evidence. The
separate draft workflow repeats the Windows package checks, verifies that the
installer and executable are `NotSigned`, and stages the clearly named preview.
`npm run qualify:ui` loads production renderer bundles in an isolated Xvfb display
and checks full, short, and capped-width shells at 100%, 125%, and 150%, including
delegation entry, revocation review, ambiguous monitoring, safe focus,
reachability, text, and targets.
Panel-contained permission dialogs cannot inert or dim the joined dashboard because
the dashboard is a separate WebContents. Their `aria-modal`, focus containment, and
background inerting guarantees apply to the wallet panel only; the joined dashboard
intentionally remains visually unchanged. In joined-window qualification, verify
that the dialog stays inside the panel and retains panel focus, and do not treat the
unchanged dashboard as part of the modal surface or operate it until the dialog is
closed. A cross-window modal veil is outside the current release claim.
Companion's `npm run qualify:browser` uses disposable temporary builds and profiles
to exercise exact protocol 3 mutual authentication, EIP-6963, provider requests, and top/frame origin isolation
in real Chrome and Firefox. These automated checks do not replace the candidate-
archive and active-desktop checks below.

## 2. Run the required operator checks

1. Back up the closed Wren profile and confirm the backup is readable. Close all
   Wren and other hardware-wallet apps. Use new disposable software/hardware
   accounts with only test funds; do not run AppImage and deb together. Preserve
   logs for diagnosis, but scan them before sharing.
2. Launch the AppImage in a new mode-`0700` profile:

   ```bash
   profile=$(mktemp -d)
   chmod 700 "$profile"
   ./Wren-<version>.AppImage --user-data-dir="$profile"
   ```

   Check startup, tray/dashboard placement, restart persistence, dark-native
   rendering, clean shutdown, coupled pane movement, no unexpected updater, and
   no second instance or port takeover (`1248`, `8421`). On X11, check Glide on
   both selected/unselected edges of every display: only the selected edge reveals
   Wren without focus or a stranded edge window. Native Wayland Glide is not
   qualified.

3. With both apps closed, import a compatible disposable Frame backup into a
   nonexistent temporary target using `--import-frame-profile` and
   `--import-frame-profile-from=<source>`:

   ```bash
   source_profile=/absolute/path/to/disposable-frame-backup
   target_parent=$(mktemp -d)
   target_profile="$target_parent/wren"
   ./Wren-<version>.AppImage --user-data-dir="$target_profile" \
     --import-frame-profile \
     --import-frame-profile-from="$source_profile"
   ```

   Confirm the source is byte-identical; target is `0700`; copied files are
   `0600`; cache, logs, Chromium data, and secrets are absent from
   `frame-profile-import.json`; and a restart preserves accounts/names, custom chains/RPCs,
   permissions, contacts, tokens, Earn activity, and encrypted signers. A locked
   source or existing target must fail without partial data. Install the deb next
   to the separately named Frame package and repeat startup/port checks. Profile
   migration failures block release.

4. In clean Chrome and Firefox profiles, load their own extracted Companion
   archives (never interchange them). Run `npm run qualify:serve` in the
   Companion repository, open `http://127.0.0.1:8765/` (a local page that stores
   nothing and makes no network request itself), and require EIP-6963
   discovery as Wren / `io.github.jorphex.wren` even if another provider owns
   `window.ethereum`. For each browser: compare/approve the initial six-digit
   code; reject then approve one account; verify account/chain events once in all
   tabs; ensure request results/signing payloads stay tab-local; verify restart
   reconnect; revoke, re-pair, and reset; and ensure rejected/malformed requests
   leave no spinner, stale approval, or reconnect loop.
   `npm run qualify:browser` uses an isolated desktop mock and does not satisfy
   the revoke check: record the real Wren permission-row removal and one
   `accountsChanged` event with an empty account list in every affected tab.
5. Complete each signer row through a qualified browser; private-key signing must
   run in Chrome and seed signing in Firefox. Reject each request once before
   approving personal message, EIP-712 v4, and a zero-value testnet self-transfer.
   Record address discovery, cancel/reject, and lock/reconnect results for Trezor
   Safe 7 USB, Trezor Model One USB, disposable private key, and disposable seed.
   On devices record firmware and compare full address, chain, recipient, value,
   calldata, and fees. Safe 7 pairing must reconnect without a reload loop;
   Model One must explicitly report unsupported display types rather than blind
   sign. For software signers test wrong password, unlock, relock, restart, and
   removal. Generate one 12-word wallet and one private-key wallet. Confirm each
   secret is shown only for backup, its backup check is required, and it is not
   shown again. Confirm the eight-character minimum and that an easy-to-guess
   password keeps Continue disabled until its consent box is checked. Remove each
   signer and confirm accounts that depend only on it disappear while accounts
   shared with another signer remain. Production logs must not contain any secret,
   request payload, or pairing response. The transfer action must remain unavailable
   unless the expected testnet and disposable-account confirmation are active; check its
   hash privately on the matching explorer.

## 3. Qualify EIP-5792 and EIP-7702 boundaries

Use a new isolated `0700` desktop profile, disposable testnet accounts, a controlled
local page, the candidate desktop, its configured testnet RPC, and the exact Chrome
and Firefox candidate archives.

1. Submit a non-atomic `wallet_sendCalls` request with at least two harmless calls.
   Check ordered targets, values, calldata, simulation, and fee evidence. Reject
   once, then approve once. Confirm sequential execution, status lookup after
   restart, truthful partial-failure status, and no advertised atomic or optional
   capability.
2. Repeat one successful and one rejected batch through each Companion archive in
   a clean browser profile. Confirm tab-local results, native Wren review, ordered
   calls, status lookup, and no stale request after rejection, reload, reconnect,
   or restart.
3. With controlled code fixtures or independently recorded testnet state, check a
   delegated sender, transaction recipient, and wallet-call target. Record the
   first delegate and code hash. Confirm nested delegation is shown as one hop,
   empty delegate bytecode is identified, and unavailable lookups are not presented
   as delegation evidence.
4. Change or make unavailable the reviewed delegation or delegate code before
   approval. Confirm the final recheck blocks signing and names the address. Confirm
   delegated senders cannot submit a sequential batch, ordinary outbound
   transactions are not described as running the sender's delegate, and type-4 or
   authorization-list requests are rejected before approval.
5. With a disposable Ring or Seed account already delegated on the testnet, open
   Accounts, choose the exact account and network, and review the revocation.
   Verify the authority, delegate, code hash, nonce, and EIP-1559 fees before
   signing. Confirm Wren monitors only the locally inspected transaction hash,
   survives a restart or temporary RPC failure, and reports clearance only after
   block-bound code evidence and 12 confirmations. Exercise **Stop monitoring** and
   confirm it does not claim to cancel the transaction or clear the delegation.

This qualifies only the exercised desktop, RPC, testnet state, and exact browser
archives. It does not audit delegate code, qualify every chain/RPC, qualify atomic
EIP-5792, create or replace delegation, or qualify EIP-7702 hardware signing.

## 4. Qualify contract source verification

Use a disposable testnet contract and source that may be published permanently.
Never use private or embargoed source. Confirm an exact managed deployment shows
**Verify source** alongside Close for thirty seconds while an ordinary confirmed
transaction retains its four-second handoff. Activity must remain non-clickable
and gain no verification action or details.

From both the confirmed-deployment continuation and Control Center Tools, inspect
Solidity and Vyper standard JSON plus applicable Foundry/Hardhat build-info. Test
cancel, malformed JSON, symlink/FIFO/directory, oversize input, ambiguous contract
selection, wrong compiler, wrong chain/address, empty code, mismatched runtime,
RPC disconnect, and a target changing during inspection. Require all failures to
occur before publication. For raw standard JSON, require the UI to say matching is
completed by Sourcify rather than claiming a local compiler match.

On the exact disposable source, compare the frozen chain, full address, runtime
hash, compiler, contract identifier, and deployment finality. The permanent-public
notice and acknowledgement must sit immediately above the single Publish action.
Cancel or edit any field and confirm the checked evidence is invalidated. Publish
once to Sourcify; confirm restart resumes only accepted status polling and never
submits the source twice. Record Sourcify, Etherscan, Blockscout, and Routescan
results independently—forwarding failure must not turn a Sourcify match into
failure.

Where supported, exercise direct Etherscan fallback only after forwarding is
unavailable or unsuccessful. Test absent, invalid, replaced, and removed API keys;
test explicit ABI-encoded constructor arguments and the separate no-arguments
confirmation, and reject malformed or implicit-empty values before any request;
an accepted GUID with a bad key must resume GET status after replacement, never a
second source POST. Confirm unsupported OS credential protection stores no key,
profile backup excludes the key and source, and restore requires re-entry. Scan
state, backup, Activity, logs, and rendered navigation for source text, file paths,
API keys, and credential-bearing URLs without printing those fixtures.

## 5. Run Earn-only qualification

Run this only when [`YEARN_EARN.md`](YEARN_EARN.md) is present. Use an isolated
`0700` profile, four disposable accounts (private key, seed, Safe 7, Model One),
minimum funds, independently verified Ethereum/Base/Katana RPC chain IDs, and
independently verify each displayed product/route and on-chain `asset()` before
continuing. Stop on a mismatch.

Check that no selected account yields three chain sections/eight products with no
active transaction control; watch-only positions precede opportunities and cannot
transact; individual disconnected chains fail locally and open settings; stale
Kong data preserves visibility/exits but disables deposits and never shows missing
APY as zero; malformed Kong data, altered decimals, or mismatched `asset()`/
`decimals()` fail closed before the account queue.

For each transaction, compare chain, account, target, asset, amount/share meaning,
exact approval, receiver/owner, zero native value, simulation, and device display.
Use the minimum practical amount and withdraw after the required transition:

| Account     | Required flow                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Private key | Base yvUSDC-H exact deposit, partial underlying withdrawal, Max redeem                                              |
| Seed        | Katana direct-vault exact deposit and Max redeem; read-only discovery of the other two Katana assets                |
| Safe 7      | Ethereum flexible yvUSD deposit and Max redeem; clear-signing and reconnect                                         |
| Model One   | Ethereum yBOLD pinned-zap deposit, Stake with an existing yBOLD position when available, then zero-loss staked exit |

Test a mismatched nonzero allowance: reset-to-zero, exact approval, and deposit
must be separate reviews; reject each once and ensure retry has no duplicate hash.
After approval, restart and test Resume plus separate Revoke cleanup. Interrupt a
pre-hash request and an approval-cleanup request: recovery must report unknown,
never requeue automatically, recheck allowance first, queue nothing at zero, and
require a new explicit Revoke for nonzero allowance. For locked yvUSD, test
deposit, persisted cooldown timestamps, Cancel during cooldown, partial and Max
window exits using separate locked-to-yvUSD and yvUSD-to-USDC reviews and exact
`redeem`, expired-window failure, and no leftover approval. Any yBOLD
`maxLoss = 0` failure must stop without raising tolerance; no preference may alter
Yearn loss tolerance.

For every flow, require normal review/simulation/sign/broadcast/monitor evidence
and matching explorer link; compare receipt amounts with independently decoded
allowlisted Transfer logs and never guess missing evidence. Controlled changes to
target, chain, native value, receiver, owner, spender, token, method, or loss
tolerance must remove Yearn labels; a changed decoded amount may remain shown,
but a changed persisted step amount must not queue. A hidden-confirmation
notification may contain only Wren's shortened hash. Restart after completed
flows: positions refresh, terminal workflows stay bounded, broadcasts do not
duplicate, and approvals never exceed the request.

## 6. Decide pass or fail and retain evidence

After each signer run, relock/disconnect/quit, ensure no pending request after
restart, scan the isolated profile/logs for exact disposable fixtures without
printing them, remove accounts/signers in Wren, confirm signer files are gone,
then remove test profiles only after recording the result. Public address metadata
is non-secret and does not prove the scan passed.

A Linux pass requires an explicit result for every applicable cell, both browser
flows, AppImage/deb/profile checks, no secret in logs, and each anomaly fixed/retested or
documented as intentionally unsupported. The Windows preview additionally requires
its separate checklist. Crashes, cross-tab data, wrong device
display, unexplained signer reload, stale approval, blind signing, profile loss,
wrong updater target, wrong target/amount, cross-chain request, stale deposit,
duplicate broadcast, unrecoverable workflow, or unrevokable approval block a
release. Report only versions, checksums, pass/fail, sanitized errors, and steps.

### Historical 0.8.0 Linux x64 evidence

The pre-separation manual run used desktop `0.8.0` commit `3963a014` and Companion
`0.13.1` commit `88ca5b2f` (protocol 2), on Pop!_OS 22.04 / Linux
`7.0.11-76070011-generic` / X11 GNOME, Chrome for Testing `151.0.7922.76`, and
Firefox `151.0.4`. Its artifact hashes were:

| Artifact    | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| AppImage    | `7dce2601f138e06310dd42bf30995ed64b1764a410b4877502592de53779c715` |
| deb         | `2407fb420b969369e197491eb185c151caa350d0ccb4d480c2f11da0b5a316e6` |
| Chrome ZIP  | `0706701a2f4390edff1ff4c6c663050e7e1a9373e6550353b9e3036c8acf2bdd` |
| Firefox ZIP | `48e5b0d7fff5adea087f68778034b6c6e51aa313edb440c3edffd04930244b77` |

Desktop quality/package and CodeQL runs were `30971856638` and `30971856630`;
Companion runs were `30870559679` and `30870559678`. The AppImage was physically
exercised for fresh/migrated profiles, tray/dash, loopback/single instance,
restart, X11 Glide, and no upstream update/renderer exception; exact Companion
archives passed pairing, access, tab isolation, events, restart, revocation,
reset, and re-pairing. Disposable private-key/seed signers passed wrong-password,
personal/EIP-712 rejection and approval, Base Sepolia zero-value self-transfer
(`0x1`, 21,000 gas, self-recipient, empty calldata), restart/relock/removal, and
fixture scanning. Safe 7 `2.12.0` had prior full pairing/address/personal/
clear-EIP-712 evidence and at `3963a014` passed address verification, two Base
Sepolia funding transfers, and USB recovery; Model One `1.13.1` passed address,
personal, hash-only EIP-712, and USB checks, while Base Sepolia failed closed
because its signed network coin type was 1 vs Ethereum derivation 60. Eight
Yearn products, watch-only gating, and allowlisted review were observed; the
earlier packaged Base yvUSDC-H deposit/partial-withdraw/Max-redeem physical Trezor
evidence remains in [`YEARN_EARN.md`](YEARN_EARN.md), not evidence for all flows.

Post-record commit `8fe2ed17` restored per-origin omnichain switching: authorized
Ethereum Mainnet/Sepolia switches took 1–3 ms without approval; untouched prior-
chain requests ended with `4901`; unknown, disabled, and unauthorized targets
failed closed. The then-current automated gate passed 216 suites / 2,909 tests;
a fresh AppImage rendered tray/dash/onboarding, detected Trezor, and exited
cleanly. Its exercised hashes were AppImage
`e2b6be573c4f887950d0f9c1acb4ff72064e0aac531d190f7de9aa6f1b4775b5` and deb
`527f376790c9757b1fa5203e0c3cd8225ae6ea18c494f438e88890c2b4d9e34d`; signer
implementations did not change. These historical hashes identify only their
artifact sets; rebuilt candidates need their own identity and `SHA256SUMS` check.

That historical run did not assess reproducibility; its evidence is embedded
clean-source identity, SHA-256, SBOM, and GitHub provenance. It qualifies Linux
x64 only—not macOS, Windows, Linux arm64, native-Wayland Glide, Bluetooth,
unlisted hardware, or unexercised Yearn product/signer combinations.
The current release audit reports 19 low-severity transitive findings, no high or
critical finding, and no compatible upstream fix for the remaining `elliptic`
path in this release line.
