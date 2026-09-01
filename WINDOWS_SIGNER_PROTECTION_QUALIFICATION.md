# Windows DPAPI software-signer qualification checklist

This checklist qualifies only Wren's optional Windows DPAPI software-signer
protection. It does not qualify the installer, updater, hardware signers, or the
overall Windows preview. Complete the separate
[Windows release checklist](WINDOWS_RELEASE_QUALIFICATION.md), then run this on
Windows x64 with the same exact candidate before describing DPAPI as natively
qualified.

Use only disposable software signers and passwords. Never use an account that has
held real value. Do not publish seeds, private keys, keystore contents, passwords,
signatures, full profile files, DPAPI ciphertext, or raw logs.

## 1. Prepare independent test environments

Record the Wren version, commit, installer SHA-256, Windows edition/build, VM
software, and the passing Windows quality/package workflow. Install the exact
candidate rather than launching files copied from another build.

Prepare all three contexts:

1. primary local Windows user **A**;
2. distinct local Windows user **B** on the same Windows installation;
3. a separate Windows VM installed independently from installation media.

Do not use a clone, snapshot, exported appliance, copied system disk, domain
roaming profile, or restored system image for the separate-VM check. Those can
copy a user's DPAPI credentials or master keys and invalidate the isolation test.

Keep each run in an explicitly named disposable profile where practical:

```powershell
$ProfileRoot = Join-Path $env:LOCALAPPDATA ("wren-dpapi-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $ProfileRoot | Out-Null
& "$env:LOCALAPPDATA\Programs\Wren\Wren.exe" "--user-data-dir=$ProfileRoot"
```

If the installer chooses another location, launch its installed `Wren.exe` with
the same `--user-data-dir` argument. Record the path privately. Close Wren fully
before copying or inspecting a profile.

## 2. Confirm enablement and same-user persistence

As user A, create at least two disposable software signers, lock them, and export
a password-encrypted Wren profile backup. In **Settings → Software signers**:

1. confirm the status shows **Windows DPAPI** and says the signer password is
   still required;
2. enable device protection and confirm the warning binds files to the current
   Windows account;
3. unlock both signers, sign a disposable offline message, relock, and quit;
4. restart Wren under user A and repeat unlock/sign/relock;
5. reboot Windows, restart Wren under user A, and repeat once more;
6. remove device protection, confirm the marker is gone and every signer is again
   a password-encrypted raw record, then unlock/sign/relock with the original
   passwords;
7. enable DPAPI protection again, quit, and use that fully protected profile for
   the remaining checks.

With Wren closed, inspect only structural predicates. The marker must report
`wren-os-signer-protection`, version `1`, and backend `windows_dpapi`; every active
or retained legacy signer record must report wrapper format
`wren-os-protected-signer`, version `1`. Record counts and pass/fail only. Do not
copy file contents into evidence.

## 3. Confirm different-user and different-machine denial

With Wren closed, copy user A's protected disposable profile into a new directory
owned and readable by user B. Do not test by opening A's ACL-protected directory:
an ACL denial is not DPAPI evidence. Launch Wren as user B against the copied
profile and confirm:

- Settings reports the protected profile unavailable;
- no software signer loads or unlocks;
- portable backup export is refused because no record can be decrypted;
- creating or replacing a software signer is refused while the protected policy
  remains active;
- no file is silently rewritten as password-only.

Repeat the same test on the independently installed Windows VM after transferring
the closed disposable profile into a directory owned by its test user. The result
must fail closed there too. A successful decrypt in either context blocks
qualification and requires investigation before any release claim.

## 4. Confirm tamper and interrupted-migration recovery

Work from private copies of the disposable profile and backup. Never mutate the
only recovery copy.

For tamper denial, flip one byte in the decoded ciphertext of one wrapper, encode
it again, and leave valid JSON. On restart, Wren must report the protected profile
unavailable, load no software signer, permit no new signer write, and leave the
wrapper in place. Restore the untouched test copy afterward.

Exercise interrupted enable deterministically:

1. save a closed password-only profile copy before enabling;
2. enable DPAPI in the working profile, quit, then replace exactly one protected
   signer file with the same-named raw file from the password-only copy while
   leaving the marker and remaining wrappers intact;
3. restart and confirm Wren reports recovery required and loads no signer;
4. choose **Finish enabling**, then confirm every signer is wrapped and usable
   after restart as user A.

Exercise interrupted disable on a new working copy:

1. save a closed fully protected profile copy;
2. remove protection normally and quit;
3. restore the protection marker and exactly one protected signer file from the
   protected copy, leaving the other signer files raw;
4. restart and confirm Wren reports recovery required and loads no signer;
5. choose **Restore password-only**, then confirm the marker is gone, all signer
   files are raw password-encrypted records, and both signers require their
   original passwords.

Any partial signer availability, split-key write, automatic downgrade, lost raw
record, or unrecoverable transition blocks qualification.

## 5. Confirm portable backup recovery

From user A's fully protected profile, export a new encrypted Wren profile backup.
Restore it into an empty disposable profile under user B or the independent VM.
Confirm the restored signer records:

- contain no device-protection marker or `wren-os-protected-signer` wrapper;
- require the original signer password;
- unlock and sign the disposable offline message;
- can be explicitly protected under the destination Windows user afterward.

Make DPAPI unavailable only through a controlled test context if one is
available; never damage Windows credentials. At minimum, the different-user test
must prove that an enabled source profile cannot be exported or modified when its
records cannot be decrypted.

## 6. Confirm uninstall and reinstall persistence

Back up the disposable profile, close Wren, uninstall the candidate without
manually deleting its application data, and reinstall the exact same candidate.
As the same Windows user and against the same profile, confirm DPAPI protection
remains enabled and both signers still require their passwords and can sign the
offline fixture. Then install the intended upgrade candidate over that test and
repeat. An installer that removes or relocates the profile without an explicit
warning blocks qualification.

## 7. Record the result safely

Record one sanitized row for each check: candidate checksum, Windows build,
context (same user, second user, independent VM), expected state, actual state,
and pass/fail. Retain private evidence only as long as necessary. Scan logs and
screenshots before sharing; report structural counts and sanitized errors, never
profile contents.

A pass requires all of the following: enablement, same-user app restart, same-user
OS reboot, different-user denial, independently installed VM denial, tamper
denial, interrupted enable recovery, interrupted disable recovery, portable
backup restore, uninstall/reinstall persistence, upgrade persistence, and no
secret in retained evidence. Until every item passes, describe Windows DPAPI as
**implemented and automated, not natively qualified**.
