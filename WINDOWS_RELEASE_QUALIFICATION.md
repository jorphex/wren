# Windows x64 preview qualification checklist

Use this checklist for the unsigned Wren 0.1.8 Windows installer.
Linux x64 remains the qualified platform. Passing this checklist makes the
Windows file suitable for a clearly labeled preview; it does not create a trusted
publisher or qualify untested hardware.

Use a fresh Windows VM or disposable local user, test-only accounts, and no real
funds. Do not retain or share seeds, private keys, passwords, full addresses,
signatures, profile files, or raw logs.

## 1. Confirm the candidate

Record the Wren version, source commit, Windows edition/build, VM software, and
exact release-workflow URL. Download these files from the draft release through
the browser:

- `Wren-Setup-0.1.8-unsigned-x64.exe`
- `SHA256SUMS`
- `wren.cdx.json`

Verify the installer's SHA-256 against `SHA256SUMS` and verify its GitHub build
and SBOM attestations. Then run:

```powershell
Get-AuthenticodeSignature '.\Wren-Setup-0.1.8-unsigned-x64.exe' |
  Format-List Status,StatusMessage
```

The expected status is `NotSigned`. Any other status blocks this unsigned
preview until it is understood. SmartScreen or an unknown-publisher message may
appear, but is not guaranteed. Do not disable Windows security controls globally.

## 2. Install and launch

Run the verified installer. It is intentionally a one-click current-user setup:
there is no Next/Next/Install wizard, and Wren opens when installation finishes.
Confirm Wren appears in installed apps and has an uninstaller.

Close the automatically opened instance. Create a disposable profile and launch
the installed executable against it:

```powershell
$ProfileRoot = Join-Path $env:LOCALAPPDATA ("wren-preview-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $ProfileRoot | Out-Null
& "$env:LOCALAPPDATA\Programs\Wren\Wren.exe" "--user-data-dir=$ProfileRoot"
```

If Windows installed Wren elsewhere, use that `Wren.exe`. Confirm dashboard,
wallet panel, tray, Control Center, clean close, restart persistence, and
single-instance behavior. Confirm a second launch does not take over Wren's
local ports or create a second profile writer.

## 3. Exercise the changed account and Activity flows

With disposable data only:

1. Create one recovery-phrase wallet and one private-key wallet. An eight-character
   password must work. An easy-to-guess password must require the explicit consent
   checkbox before Continue becomes available.
2. Confirm each generated secret remains visible until you choose Continue, then
   complete its backup check. Lock, unlock, restart, and remove it.
3. Rename named and unnamed accounts. Confirm drafts survive background refresh,
   local and ENS names remain distinct, and Rename and Remove share one action row.
4. From Accounts, select a locked software signer and a disconnected hardware
   signer. Confirm Wren opens the password or device reconnect flow. Ready and
   watch-only accounts must still switch directly.
5. Remove a signer that owns accounts and confirm those accounts also leave the
   wallet panel after restart. Do not perform a second manual account removal.
6. Confirm account-access revocation stays within the wallet panel, returns focus,
   and dismisses its success notice automatically. Connected apps must show the
   same eligible apps as its badge.
7. Confirm wallet subview separators align and empty Activity uses only its content
   height.
8. Open transaction and Wallet Calls Activity rows with pointer and keyboard input.
   Compare the displayed amount, recipient or contract, method, transaction hash,
   and explorer target with independent testnet evidence. Clear Activity, restart,
   and wait through one lifecycle refresh. Unchanged replacement or terminal evidence
   must not restore the cleared history.

## 4. Exercise Companion and requests

Use the exact qualified Wren Companion Chrome and Firefox archives. In each
browser, compare the pairing code, approve one disposable account, and confirm
the network list loads. On a test dapp or explorer:

1. connect once as Wren;
2. switch to an enabled network before account access and confirm the route changes
   immediately without a review or account exposure;
3. reject, then approve, one personal message or zero-value testnet transaction;
4. revoke the account and confirm the page receives an empty account list;
5. restart Wren and the browser and confirm pairing recovers without a loop.

No request may remain stuck after approval or rejection. Scan retained output for
secrets before keeping any evidence.

Review one token approval and one submitted transaction. Confirm the approval has
exact, custom, unlimited, and revoke choices; estimated changes stay grouped;
supported fees and nonces are editable; and transaction hash, explorer, cancel,
speed-up, and progress controls appear only when applicable.

On Base and Base Sepolia, also retry a native and ERC-20 Send after a retained
funding-check failure. Recheck must refresh the gas limit, OP Stack L1 data fee,
and balance using canonical quantities; it must never sign or send while any
funding evidence remains unavailable.

## 5. Check update and removal behavior

Install the candidate over a disposable earlier Wren installation and confirm its
profile still opens. Include a migrated Frame-style palette and mixed-case account
record; require the canonical Wren palette and one lowercase account identity after
upgrade without metadata loss. Uninstall and confirm the app is removed. Application
data may remain for recovery; do not interpret that as an uninstall failure.
Reinstall the exact candidate and confirm it starts normally.

The optional Windows DPAPI layer has a deeper, separate
[signer-protection checklist](WINDOWS_SIGNER_PROTECTION_QUALIFICATION.md). Until
that checklist passes, describe DPAPI as implemented and automatically tested,
not natively qualified.

## 6. Decide

The preview passes only when the exact checksum, attestation, `NotSigned` state,
installer lifecycle, fresh/restart profile, changed account flows, and paired
browser checks above pass with no unexplained error. Record only sanitized
pass/fail results. If any item fails, leave the draft unpublished, fix the cause,
and build a new candidate from a new commit.
