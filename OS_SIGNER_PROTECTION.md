# Linux software-signer device protection

Wren can add an optional Linux keychain layer to software signer files. It is an
additional at-rest factor: the existing signer password remains required, and
Wren does not store that password in the keychain.

## Requirements

The option is available only when Electron is using one of these Linux password
stores:

- Secret Service (`gnome_libsecret`), normally provided by GNOME Keyring or a
  compatible service;
- KWallet (`kwallet`, `kwallet5`, or `kwallet6`).

Wren refuses Electron's `basic_text` fallback and an uninitialized or unavailable
password store. Start and unlock the desktop password service, then use **Settings
→ Software signers → Retry**. Other operating systems are outside this feature's
current support boundary.

## Enable or remove protection

Use **Settings → Software signers**. Enabling wraps every active software signer
record and retained legacy recovery record with the current device keychain.
Removing protection removes only this device layer; Wren's password-derived
authenticated encryption remains intact.

Wren commits a profile policy only after every file has been protected, and
removes it only after every file has been restored. If Wren or the computer stops
during that change, software signers remain unavailable. Once the same secure
keychain is available, Settings offers two explicit choices: finish enabling
device protection or restore password-only storage. Wren never silently falls
back to weaker storage.

## Recovery and backups

Export an encrypted Wren profile backup after creating or changing software
signers. Backup export requires the device keychain while protection is enabled,
but the resulting `.wren-backup` is portable: it contains the existing
password-encrypted signer records, not the source device's keychain wrapper.

A restored profile starts with password-only signer storage. Verify the restored
accounts and backup, then enable device protection on the destination if wanted.
Do not copy the bound live profile as a recovery method: another OS, login, or
keychain may be unable to decrypt it.
If the source keychain is permanently lost and no portable backup exists, Wren
cannot recover the device-bound files.

This feature does not protect against malware or another process running as the
logged-in user after it can access the unlocked keychain. Prefer a hardware
signer for high-value accounts and keep independently verified encrypted backups.
