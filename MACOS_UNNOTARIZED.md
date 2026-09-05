# macOS unnotarized release

Wren 0.1.4 and later releases may include separate Intel (`x64`) and Apple
Silicon (`arm64`) macOS artifacts. They remain unqualified previews until their
architecture-specific physical checks pass.

These previews are ad-hoc signed so macOS can validate their executable code
seals, but they have no Apple Developer ID, Apple Team ID, trusted publisher, or
notarization ticket. Apple has not checked them for malicious software. macOS
therefore blocks the first launch until the user explicitly creates an exception.
Wren plans to continue using ad-hoc signatures without an Apple publisher
identity or notarization.

## Choose and verify the download

- Apple Silicon (`M1` or later): `Wren-<version>-macos-arm64-unnotarized.dmg`
- Intel: `Wren-<version>-macos-x64-unnotarized.dmg`

Download the matching DMG and `SHA256SUMS` only from Wren's GitHub release. In
Terminal, from the download directory, verify the selected file:

```bash
file='Wren-<version>-macos-arm64-unnotarized.dmg'
grep "  $file$" SHA256SUMS | shasum -a 256 --check
gh attestation verify "$file" -R jorphex/wren
```

Replace the filename with the Intel DMG when applicable. Do not install if the
checksum entry is missing, the checksum differs, or
attestation verification fails.

## Install and open

1. Open the verified DMG and drag **Wren** to **Applications**.
2. Try to open Wren once. macOS should block the unidentified, unnotarized app.
3. Open **System Settings → Privacy & Security**, scroll to **Security**, and
   choose **Open Anyway** for Wren.
4. Authenticate when macOS asks, confirm **Open**, and verify that the app name
   is Wren before continuing.

The exception applies only to this application. Do not disable Gatekeeper or
remove quarantine attributes globally. A managed Mac may prohibit the override.

## Support boundary

- The preview is not a signed-publisher or notarization claim and is not a Mac
  App Store package.
- GitHub checksums and attestations bind the downloaded DMG to Wren's public
  source and release workflow; they do not replace Apple notarization.
- Automatic macOS updates are not published. Download and verify each later
  version independently.
- macOS has no Wren OS-backed device-protection layer. Software-signer records
  remain password-encrypted, and profile backups remain password-protected.
- Until the applicable physical checklist passes, macOS remains an unqualified
  preview. Start with a disposable account and test funds only.
