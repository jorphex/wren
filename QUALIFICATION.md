# Linux release qualification

This is the manual gate for a paired Wren desktop and Wren Companion candidate;
it supplements tests and is not an audit. Use disposable accounts and Ethereum
Sepolia (`0xaa36a7`) or Base Sepolia (`0x14a34`) unless testing Earn, which uses
minimal live-fund flows. Never publish seeds, keys, PINs, passphrases, pairing
responses, full addresses, signatures, transaction hashes, device IDs, or profile
contents.

## Candidate record and automated evidence

Record desktop and Companion version/commit, Companion minimum desktop commit,
AppImage/deb/Chrome ZIP/Firefox ZIP SHA-256, and OS/kernel/browser versions.
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
Companion's `npm run qualify:browser` uses disposable temporary builds and profiles
to exercise protocol 2, EIP-6963, provider requests, and top/frame origin isolation
in real Chrome and Firefox. These automated checks do not replace the candidate-
archive and active-desktop checks below.

## Required operator checks

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
5. Complete each signer row through a qualified browser; private-key signing must
   run in Chrome and seed signing in Firefox. Reject each request once before
   approving personal message, EIP-712 v4, and a zero-value testnet self-transfer.
   Record address discovery, cancel/reject, and lock/reconnect results for Trezor
   Safe 7 USB, Trezor Model One USB, disposable private key, and disposable seed.
   On devices record firmware and compare full address, chain, recipient, value,
   calldata, and fees. Safe 7 pairing must reconnect without a reload loop;
   Model One must explicitly report unsupported display types rather than blind
   sign. For software signers test wrong password, unlock, relock, restart, and
   removal. Production logs must not contain any secret, request payload, or
   pairing response. The transfer action must remain unavailable unless the
   expected testnet and disposable-account confirmation are active; check its
   hash privately on the matching explorer.

## EIP-5792 and EIP-7702 qualification

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

This qualifies only the exercised desktop, RPC, testnet state, and exact browser
archives. It does not audit delegate code, qualify every chain/RPC, qualify atomic
EIP-5792, or add EIP-7702 delegation management.

## Earn-only qualification

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

## Pass, cleanup, and historical evidence

After each signer run, relock/disconnect/quit, ensure no pending request after
restart, scan the isolated profile/logs for exact disposable fixtures without
printing them, remove accounts/signers in Wren, confirm signer files are gone,
then remove test profiles only after recording the result. Public address metadata
is non-secret and does not prove the scan passed.

A pass requires an explicit result for every applicable cell, both browser flows,
AppImage/deb/profile checks, no secret in logs, and each anomaly fixed/retested or
documented as intentionally unsupported. Crashes, cross-tab data, wrong device
display, unexplained signer reload, stale approval, blind signing, profile loss,
wrong updater target, wrong target/amount, cross-chain request, stale deposit,
duplicate broadcast, unrecoverable workflow, or unrevokable approval block a
release. Report only versions, checksums, pass/fail, sanitized errors, and steps.

### 0.8.0 Linux x64 evidence (historical)

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

Historical limits remain: packages are unsigned and not reproducible; evidence
is embedded clean-source identity, SHA-256, SBOM, and GitHub provenance. That run
qualifies Linux x64 only—not macOS, Windows, Linux arm64, native-Wayland Glide,
Bluetooth, unlisted hardware, or unexercised Yearn product/signer combinations.
The current release audit reports 19 low-severity transitive findings, no high or
critical finding, and no compatible upstream fix for the remaining `elliptic`
path in this release line.
