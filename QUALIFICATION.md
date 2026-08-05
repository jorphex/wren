# Linux Release Qualification

This procedure is the minimum manual gate for a paired Wren desktop and Wren
Companion release candidate. It supplements automated tests; it is not a
security audit. Use disposable accounts and an approved testnet only: Ethereum
Sepolia (`0xaa36a7`) or Base Sepolia (`0x14a34`). Never paste a seed, private
key, PIN, passphrase, pairing response, full account address, or transaction
signature into a report or issue.

## Candidate Record

Record these values before testing:

| Item                                     | Result |
| ---------------------------------------- | ------ |
| Desktop version and commit               |        |
| Companion version and commit             |        |
| Companion minimum desktop commit         |        |
| AppImage SHA-256                         |        |
| deb SHA-256                              |        |
| Chrome ZIP SHA-256                       |        |
| Firefox ZIP SHA-256                      |        |
| OS, kernel, Chrome, and Firefox versions |        |

Verify both `SHA256SUMS` files from their artifact directories. Confirm the
companion compatibility JSON names the candidate desktop branch and a commit
that is an ancestor of the desktop candidate.

## Automated Gates

Record exact workflow URLs or equivalent local command evidence for the listed
candidate commits. Do not reuse a result from an earlier source checkpoint.

| Gate                                   | Result |
| -------------------------------------- | ------ |
| Desktop quality and package workflow   |        |
| Desktop CodeQL workflow                |        |
| Companion quality and package workflow |        |
| Companion CodeQL workflow              |        |
| Desktop release verifier               |        |
| Companion release verifier             |        |

The desktop verifier must cover the AppImage, deb, source-bound SBOM, embedded
source identity, native hardware modules, and checksums. The Companion verifier
must cover both browser archives, compatibility metadata, source-bound SBOM,
and checksums.

## Safety Setup

1. Back up the current Wren profile while Wren is closed. Keep the backup
   offline from this test and verify that it is readable before proceeding.
2. Close every Wren process. Trezor Suite is not required; close it and any
   other hardware-wallet application so only Wren owns the USB transport.
3. Use newly generated disposable software accounts and hardware-wallet test
   accounts with no valuable assets. Fund only enough approved-testnet ETH for
   the test.
4. Do not run the AppImage and installed deb simultaneously. A second process
   invalidates single-instance, local-port, and signer results.
5. Keep the desktop and browser logs available for diagnosis, but inspect them
   for secrets before sharing any excerpt.

## Package And Profile

1. Launch the AppImage with a new mode-`0700` temporary user-data directory:

   ```bash
   profile=$(mktemp -d)
   chmod 700 "$profile"
   ./Wren-<version>.AppImage --user-data-dir="$profile"
   ```

2. Confirm startup, tray/dashboard placement, settings persistence after a
   restart, and clean shutdown. On X11, enable Glide, dismiss Wren, and confirm
   touching the right edge reveals it without focusing or leaving an edge window
   behind. Confirm no unexpected update prompt appears.
3. Confirm launching a second candidate exits without corrupting state or
   taking over ports `1248` or `8421`.
4. With Wren closed, copy a backed-up compatible profile to a separate temporary
   directory and launch the AppImage against that copy. Do not unlock a valuable
   signer. Confirm accounts, account names, custom chains/RPCs, permissions,
   tokens, and settings survive migration and a second restart without changing
   again.
5. Install the deb as an upgrade over the prior fork package. Confirm package
   version, desktop launcher, startup, shutdown, and preserved state. Restore
   the backup and stop qualification if any profile field is unexpectedly lost.

Delete temporary profiles only after the result has been recorded. Profile
migration failures are release blockers even when fresh-profile tests pass.

## Browser Pairing

Use clean disposable Chrome and Firefox profiles. Extract the browser-specific
archives; never interchange them. Load Chrome with **Load unpacked** and Firefox
through `about:debugging` with **Load Temporary Add-on**.

From the companion repository, run:

```bash
npm run qualify:serve
```

Open `http://127.0.0.1:8765/` in each browser. The page is local, stores nothing,
and makes no network request of its own. It must discover an EIP-6963 provider
named Wren with RDNS `io.github.jorphex.wren`. `window.ethereum` may remain owned
by another installed provider; Wren must still be discoverable through EIP-6963.

For **both Chrome and Firefox**:

1. Compare the same six-digit initial pairing code in Wren and Companion, then
   approve it in Wren. A page session must not create a separate pairing prompt.
2. Reject one account connection, then approve one. Confirm only the selected
   disposable account is returned.
3. Change the selected account and approved testnet in Wren. Confirm every
   connected tab for that origin logs the corresponding `accountsChanged` and
   `chainChanged` events once.
4. Open the page in two tabs. Submit a request in one tab and confirm its RPC
   result remains tab-local; the other tab must receive no result or signing
   payload. Account and chain events are origin state and should reach both
   tabs.
5. Close/reopen the tab and restart the browser. Confirm the known companion
   reconnects without another pairing approval.
6. Revoke the browser credential in Wren and confirm requests stop. Pair again,
   then reset Companion and confirm the prior credential no longer works.
7. Confirm malformed/rejected requests leave no permanent spinner, stale Wren
   approval, or reconnect loop.

## Signer Matrix

Run each row at least once through one qualified browser. Run the private-key
row through Chrome and the seed row through Firefox so both complete browser
paths include signing. In the local qualification page, reject each signing
request once before approving it.

| Signer                                    | Add/discover and verify address | Personal message | EIP-712 v4 | Testnet zero-value self-transfer | Reject/cancel | Lock or reconnect |
| ----------------------------------------- | ------------------------------- | ---------------- | ---------- | -------------------------------- | ------------- | ----------------- |
| Trezor Safe 7 over USB                    |                                 |                  |            |                                  |               |                   |
| Trezor Model One over USB                 |                                 |                  |            |                                  |               |                   |
| Disposable imported private key           |                                 |                  |            |                                  |               |                   |
| Disposable generated/imported seed phrase |                                 |                  |            |                                  |               |                   |

For hardware signers, record model and firmware version, compare the complete
address on-device, and compare chain, recipient, value, calldata, and fees before
approving the transaction. Safe 7 pairing-code entry must complete and reconnect
without a reload loop. For Model One, record an explicit supported or unsupported
result when the device firmware cannot display a request type; silent blind
signing is a failure.

For software signers, verify wrong-password rejection, unlock, relock, restart,
and removal using only disposable secrets. Confirm no plaintext seed, private
key, password, message, typed data, transaction payload, or pairing response is
present in production logs.

The transaction action is disabled unless Wren reports Ethereum Sepolia chain
`0xaa36a7` or Base Sepolia chain `0x14a34` and the disposable-account
confirmation is checked. Confirm the returned hash on the matching explorer
without placing the full hash in a public qualification report.

## Yearn Earn Qualification

This section applies only to a candidate containing [`YEARN_EARN.md`](YEARN_EARN.md).
Yearn's curated products are deployed on production chains, so the final flow
cannot be qualified with testnet assets. Use new disposable accounts, minimum
practical deposits, independently verify every contract address, and never use a
valuable account or position. Record transaction hashes privately.

### Preparation

1. Complete the package/profile and browser gates above with the exact candidate.
   Back up the production profile, then use a separate mode-`0700` profile for
   Earn testing.
2. Prepare four disposable accounts: imported private key, imported/generated
   seed, Safe 7, and Model One. Fund only the chain gas and underlying amount
   needed for the assigned rows below. Verify each complete account address on
   the signer or against an independent derivation before funding it.
3. Enable Ethereum, Base, and Katana using independently verified RPC endpoints.
   Confirm each reports the expected chain ID. Close other wallet/device apps.
4. Compare every displayed vault, asset, companion, and zap address with
   [`YEARN_EARN.md`](YEARN_EARN.md) and Yearn's current official interface or
   source. Stop if an on-chain `asset()` relationship or current official route
   differs from the candidate.

### Read-Only And Failure Matrix

1. With no account selected, confirm all three chain sections and eight curated
   products render without a transaction control becoming active.
2. Select a watch-only account holding one direct vault share and, when available,
   one yvUSD/yBOLD product share. Confirm positions precede opportunities and all
   transaction controls remain disabled.
3. Disable and disconnect each chain in turn. Confirm only that chain reports the
   failure and that Wren opens chain settings instead of silently switching it.
4. Make Kong unavailable after a successful refresh. Confirm timestamped cached
   data remains visible, deposits are disabled, existing exits remain available,
   and missing APY is never rendered as `0%`.
5. Return malformed Kong metadata, altered token/vault decimals, and mismatched
   on-chain `asset()` or `decimals()` responses in a controlled test environment.
   Confirm the vault fails closed and no request reaches the account queue.

### Transaction Matrix

Use minimum practical amounts and withdraw each test deposit after its required
state transition. Before approving, compare chain, account, target, underlying,
amount/share semantics, exact approval, receiver/owner, zero native value, and
simulation result in Wren. Compare all information the hardware can display.

| Account             | Required flow                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Private-key account | Base yvUSDC-H exact deposit, partial underlying withdrawal, then Max redeem                                                      |
| Seed account        | One Katana direct vault exact deposit and Max redeem; repeat read-only discovery for the other two Katana assets                 |
| Trezor Safe 7       | Ethereum flexible yvUSD deposit and Max redeem; verify clear-signing output and reconnect recovery                               |
| Trezor Model One    | Ethereum yBOLD deposit through the pinned zap, existing-yBOLD Stake when a test position is available, and zero-loss staked exit |

For one software-account deposit, first create a different nonzero allowance to
the exact allowed spender. Confirm Earn queues reset-to-zero, exact approval, and
deposit as three separately reviewed transactions. Reject each stage once and
verify retry does not duplicate a submitted hash. After confirming an approval,
quit Wren before the operation, restart, and test both Resume and the separate
Revoke approval cleanup path.

Separately terminate Wren after a request reaches review but before a hash is
recorded. On restart, confirm the workflow reports an unknown outcome, cannot be
resumed, and does not enqueue another transaction. Check the account and recent
transactions independently before starting a replacement flow.
Repeat this interruption for an approval-cleanup request. Confirm the first
recovery action only rechecks allowance, a zero allowance queues nothing, and a
nonzero allowance requires a separately clicked Revoke again action after the
pending-request warning.

Qualify locked yvUSD as a staged test because its timing cannot be compressed:

1. Deposit minimum USDC through the pinned zap and confirm the completed position
   is the locked variant.
2. Start cooldown for an exact amount, restart Wren, and confirm persisted state
   and contract-derived end/window timestamps.
3. During cooldown, confirm Withdraw is disabled and Cancel is available. Cancel
   one disposable cooldown and verify the shares return to the liquid locked
   position, then start it again.
4. During the real withdrawal window, perform a partial USDC exit. Confirm Wren
   separately reviews locked-to-yvUSD and yvUSD-to-USDC calls and does not use the
   deprecated zap-out route.
5. Repeat with Max and confirm both calls use share-exact `redeem`, all intended
   shares are burned, and no approval remains.
6. If the window expires, confirm the UI reports expired and requires a new
   cooldown rather than queueing an exit.

Any yBOLD exit that fails at `maxLoss = 0` must stop with no automatic tolerance
increase. Confirm no cog, persisted preference, or generic slippage setting can
change Yearn loss tolerance.

### Receipts, Privacy, And Completion

1. For every flow, confirm each transaction appears in Wren's ordinary review,
   simulation, signer, broadcast, and monitor UI and links to the matching chain
   explorer after confirmation. Compare receipt-derived sent/received amounts
   with independently decoded allowlisted Transfer logs; absent evidence must not
   be replaced by a guessed amount.
2. Confirm calldata-derived Yearn labels disappear in favor of generic contract
   review after changing target, chain, native value, receiver, owner, spender,
   token, method, or yBOLD loss tolerance in a controlled fixture. Confirm an
   independently changed amount remains recognized but displays the decoded
   amount, while changing a persisted workflow step amount prevents queueing.
3. Hide Wren before one confirmation. Confirm the native notification contains
   only Wren's generic shortened hash and no account, balance, asset amount, or
   vault position.
4. Restart after each completed product flow. Confirm positions refresh, terminal
   workflows remain bounded, no request is duplicated, and no approval exceeds
   the requested amount.
5. Complete the log/cleanup review below for all four accounts. A wrong target or
   amount, unexplained blind signing, silent loss-tolerance change, cross-chain
   request, stale deposit, duplicate broadcast, unrecoverable workflow, or
   unrevokable leftover approval is a release blocker.

## Log And Cleanup Review

After every signer run:

1. Relock the signer, disconnect the device when applicable, and quit Wren.
2. Confirm no request remains pending after restart.
3. Search the isolated profile and captured logs for the exact disposable key,
   phrase, passwords, signing messages, typed-data statement, pairing code, and
   custom RPC credentials without printing those values.
4. Remove disposable accounts and software signers through Wren, confirm signer
   files are gone, and delete isolated test profiles.
5. Treat retained public address metadata as non-secret operational data; it is
   not evidence that secret scanning passed.

## Pass Criteria

A candidate passes only when every required cell has an explicit result, both
browser pairing flows pass, AppImage/deb/profile checks pass, no secret appears
in logs, and every unexpected behavior has either been fixed and retested or is
documented as an intentional unsupported capability. Crashes, cross-tab data,
wrong-device displays, unexplained signer reloads, stale approvals, silent blind
signing, profile loss, or an update prompt targeting an unrelated release are
release blockers.

Report only versions, checksums, pass/fail status, sanitized error text, and
reproduction steps. Keep account addresses, transaction hashes, signatures,
device identifiers, profile contents, and all secrets private.

## Pre-Separation Frame 0.8.0 Linux x64 Execution Record

This record summarizes the completed `0.8.0` manual run without publishing
accounts, device identifiers, transaction hashes, signatures, or secrets. The
runtime candidate was the clean AppImage built from desktop commit `3963a014`
and paired with Companion commit `88ca5b2f`. Release artifacts rebuilt after
documentation-only changes must be verified against their own embedded source
identity and published `SHA256SUMS`; the hashes below identify the candidate
artifact set whose AppImage was physically exercised.

| Item                    | Result                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Desktop                 | `0.8.0`, commit `3963a014`                                         |
| Companion               | `0.13.1`, commit `88ca5b2f`, protocol 2                            |
| AppImage SHA-256        | `7dce2601f138e06310dd42bf30995ed64b1764a410b4877502592de53779c715` |
| deb SHA-256             | `2407fb420b969369e197491eb185c151caa350d0ccb4d480c2f11da0b5a316e6` |
| Chrome ZIP SHA-256      | `0706701a2f4390edff1ff4c6c663050e7e1a9373e6550353b9e3036c8acf2bdd` |
| Firefox ZIP SHA-256     | `48e5b0d7fff5adea087f68778034b6c6e51aa313edb440c3edffd04930244b77` |
| Host                    | Pop!_OS 22.04, Linux `7.0.11-76070011-generic`, X11/GNOME          |
| Browsers                | Chrome for Testing `151.0.7922.76`; Firefox `151.0.4`              |
| Desktop GitHub checks   | Quality/package `30971856638`; CodeQL `30971856630`                |
| Companion GitHub checks | Quality/package `30870559679`; CodeQL `30870559678`                |

### Runtime Results

- Fresh and migrated isolated profiles rendered Tray and Dash, bound only the
  expected loopback services, persisted settings and permissions, rejected a
  second instance, closed to tray, summoned, and passed X11 Glide. No upstream
  update prompt or renderer exception appeared.
- Exact Chrome and Firefox Companion archives paired through six-digit code
  comparison, enforced account access, isolated request results by tab, emitted
  account/chain events once per affected origin, survived browser and desktop
  restart, and passed credential revocation, reset, and re-pairing.
- Disposable private-key and seed signers rejected wrong passwords, unlocked,
  rejected and approved personal plus EIP-712 v4 requests, and each broadcast a
  zero-value Base Sepolia self-transfer with status `0x1`, 21,000 gas, identical
  sender/recipient, and empty calldata. Both relocked after process restart,
  were removed through Frame, and left zero signer files. Exact fixture scanning
  found no plaintext key, phrase, or password in the isolated profile or log.
- Safe 7 firmware `2.12.0` passed fresh pairing, full address display, rejection,
  personal signing, and clear EIP-712 review on the immediately preceding
  `0.8.0` candidate. The post-fix `3963a014` candidate changed only transaction
  refresh and balance presentation paths; it repeated full address verification,
  signed and mined two Base Sepolia funding transfers, and recovered from USB
  disconnect/reconnect with no reload loop or pending request.
- Model One firmware `1.13.1` passed full address display, personal rejection and
  approval, hash-only EIP-712 warning plus rejection and approval, and USB
  reconnect. Base Sepolia correctly failed closed before signing or broadcast:
  its signed network definition uses coin type 1 while the selected standard
  Ethereum derivation uses coin type 60. Frame displayed the specific strict
  safety explanation and did not weaken the device setting.
- The candidate showed eight chain-separated curated Yearn products, enforced
  watch-only gating and allowlisted transaction review, and retained the prior
  packaged Base yvUSDC-H deposit, partial withdrawal, Max redeem, and physical
  Trezor evidence described in [`YEARN_EARN.md`](YEARN_EARN.md). This does not
  generalize live-funds evidence to every product or signer.
- Post-record desktop commit `8fe2ed17` restored Frame's per-origin omnichain
  behavior: an authorized origin switched between enabled Ethereum Mainnet and
  Sepolia in 1-3 ms without creating an approval request. A pending untouched
  request on the previous chain was canceled with EIP-1193 error `4901` before
  the switch; unknown, disabled, and unauthorized targets continued to fail
  closed. The complete automated gate passed unchanged at 216 suites and 2,909
  tests, and a fresh exact-commit AppImage rendered Tray, Dash, and onboarding,
  connected the detected Trezor, and shut down cleanly. The exercised
  post-record artifacts were AppImage
  `e2b6be573c4f887950d0f9c1acb4ff72064e0aac531d190f7de9aa6f1b4775b5`
  and deb
  `527f376790c9757b1fa5203e0c3cd8225ae6ea18c494f438e88890c2b4d9e34d`;
  signer implementations were not changed.

### Remaining Boundaries

- Linux packages are unsigned and are not byte-for-byte reproducible. Their
  embedded clean source identity, SHA-256 manifest, SBOM, and GitHub provenance
  are the available release evidence.
- The dependency audit contains 19 low-severity transitive findings and no high
  or critical findings. The remaining `elliptic` path has no compatible upstream
  fix in this release line.
- Linux x64 is the only packaged desktop target qualified here. macOS, Windows,
  Linux arm64, native Wayland Glide, Bluetooth, unlisted hardware, and every
  unexercised Yearn product/signer combination remain unqualified or unsupported
  as documented elsewhere in this repository.
