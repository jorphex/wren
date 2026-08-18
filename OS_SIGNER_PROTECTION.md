# OS-backed software-signer device protection

Wren can add an optional operating-system credential layer to software signer
files on Linux and Windows x64. This is an additional at-rest factor: the
existing signer password remains required, and Wren does not store that password
in the operating-system credential store.

## Supported credential stores

On Linux, Wren accepts only these Electron `safeStorage` backends:

- Secret Service (`gnome_libsecret`), normally provided by GNOME Keyring or a
  compatible service;
- KWallet (`kwallet`, `kwallet5`, or `kwallet6`).

Wren refuses Electron's Linux `basic_text` fallback and an uninitialized or
unavailable password store. Start and unlock the desktop password service, then
use **Settings → Software signers → Retry**.

On Windows x64, Wren uses Electron `safeStorage`, which uses Windows Data
Protection API (DPAPI). The protected files are bound to the Windows user that
enabled protection. Wren does not call Electron's Linux-only selected-backend API
on Windows. If DPAPI is unavailable, Wren does not enable the layer or fall back
to password-only writes for a profile already marked as protected.

macOS remains unsupported by this feature. The Windows implementation has
automated coverage but is not platform-qualified until the
[native Windows checklist](WINDOWS_SIGNER_PROTECTION_QUALIFICATION.md) is
completed.

## Enable or remove protection

Use **Settings → Software signers**. Enabling wraps every active software signer
record and retained legacy recovery record with the current Linux keychain or
Windows account. Removing protection removes only this device layer; Wren's
password-derived authenticated encryption remains intact.

Wren commits a profile policy only after every file has been protected, and
removes it only after every file has been restored. If Wren or the computer stops
during that change, software signers remain unavailable. Once the same secure
credential store is available, Settings offers two explicit choices: finish
enabling device protection or restore password-only storage. Wren never silently
falls back to weaker storage.

Copying the live protected profile to another login or computer is not a recovery
method. A different Linux keychain, Windows user, or independently installed
Windows system should be unable to decrypt its signer records.

## Recovery and backups

Export an encrypted Wren profile backup after creating or changing software
signers. Backup export requires the source credential store while protection is
enabled, but the resulting `.wrenbackup` is portable: it contains the existing
password-encrypted signer records, not the source device's outer wrapper.

A restored profile starts with password-only signer storage. Verify the restored
accounts and backup, then enable device protection on the destination if wanted.
If the source credential store is permanently lost and no portable backup
exists, Wren cannot recover the device-bound files.

## Security limits

This feature does not protect against malware or another process running as the
logged-in user after it can invoke the user's unlocked credential service. In
particular, DPAPI helps protect copied or offline profile files from other
Windows users, but it does not isolate Wren from other applications running as
the same logged-in user. The outer layer is not hardware custody, passwordless
signing, or continuous authorization. Prefer a hardware signer for high-value
accounts and keep independently verified encrypted backups.
