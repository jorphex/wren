# Windows x64 preview qualification checklist

Use this checklist for the unsigned Windows installer published with Wren 0.1.3.
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

- `Wren-Setup-0.1.3-unsigned-x64.exe`
- `SHA256SUMS`
- `wren.cdx.json`

Verify the installer's SHA-256 against `SHA256SUMS` and verify its GitHub build
and SBOM attestations. Then run:

```powershell
Get-AuthenticodeSignature '.\Wren-Setup-0.1.3-unsigned-x64.exe' |
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

## 3. Exercise the changed account flows

With disposable data only:

1. Create one recovery-phrase wallet and one private-key wallet. An eight-character
   password must work. An easy-to-guess password must require the explicit consent
   checkbox before Continue becomes available.
2. Confirm each generated secret remains visible until you choose Continue, then
   complete its backup check. Lock, unlock, restart, and remove it.
3. Remove a signer that owns accounts and confirm those accounts also leave the
   wallet panel after restart. Do not perform a second manual account removal.
4. Confirm account-access revocation stays within the wallet panel, returns focus,
   and its success notice dismisses automatically.

## 4. Exercise Companion and requests

Use the exact qualified Wren Companion Chrome and Firefox archives. In each
browser, compare the pairing code, approve one disposable account, and confirm
the network list loads. On a test dapp or explorer:

1. connect once as Wren;
2. switch to an enabled network before account access and approve the request;
3. reject, then approve, one personal message or zero-value testnet transaction;
4. revoke the account and confirm the page receives an empty account list;
5. restart Wren and the browser and confirm pairing recovers without a loop.

No request may remain stuck after approval or rejection. Scan retained output for
secrets before keeping any evidence.

## 5. Check update and removal behavior

Install the candidate over a disposable earlier Wren installation and confirm its
profile still opens. Uninstall and confirm the app is removed. Application data
may remain for recovery; do not interpret that as an uninstall failure. Reinstall
the exact candidate and confirm it starts normally.

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
