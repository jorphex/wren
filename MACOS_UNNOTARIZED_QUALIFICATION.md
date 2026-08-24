# macOS unnotarized qualification checklist

Use this checklist for Wren's ad-hoc-signed Intel and Apple Silicon DMGs. It does
not create an Apple Developer ID, notarization ticket, trusted publisher, or
platform qualification by itself.

A release may publish the DMGs as clearly labeled **unqualified previews** after
the automated exact-commit gates pass. Do not describe an architecture as
installed or physically qualified until its matching physical checks below pass.

Use disposable profiles, accounts, and test funds. Do not retain or publish
seeds, private keys, passwords, full addresses, signatures, transaction hashes,
pairing responses, hardware identifiers, profile files, or raw logs.

## 1. Confirm the automated candidate

For each architecture, record the version, source commit, workflow URL, runner
image, DMG SHA-256, and build/SBOM attestation result. The exact-tag workflow must:

- build on `macos-15-intel` for x64 and `macos-15` for arm64;
- execute the packaged runtime from the unpacked app, DMG, and ZIP;
- verify safe archives, matching payloads, source/application identity,
  architecture, native modules, and runtime invariants;
- require valid ad-hoc code seals with identifier `io.github.jorphex.wren`, no
  Apple authority or Team ID, and a rejected Gatekeeper assessment;
- compare each source-bound CycloneDX SBOM with the Linux and Windows build;
- attest each public DMG and include it in the combined `SHA256SUMS`;
- keep ZIPs and macOS updater metadata outside the GitHub release.

Any mismatch blocks both macOS preview files until a new commit is built.

## 2. Check the downloaded package on a physical Mac

Use a freshly downloaded GitHub-release DMG so browser quarantine is present.
Run these checks before creating a Gatekeeper exception:

```bash
file='Wren-<version>-macos-arm64-unnotarized.dmg'
grep "  $file$" SHA256SUMS | shasum -a 256 --check
gh attestation verify "$file" -R jorphex/wren
mountpoint=$(mktemp -d)
hdiutil attach "$file" -readonly -nobrowse -mountpoint "$mountpoint"
app="$mountpoint/Wren.app"
codesign --verify --deep --strict "$app"
codesign --display --verbose=4 "$app"
if spctl --assess --type execute --verbose=4 "$app"; then
  echo 'Unexpected Gatekeeper acceptance' >&2
  exit 1
fi
hdiutil detach "$mountpoint"
rmdir "$mountpoint"
```

The signature details must report `Signature=adhoc`,
`Identifier=io.github.jorphex.wren`, `TeamIdentifier=not set`, and no `Authority`
line. Gatekeeper assessment must reject the app. An accepted assessment, Developer
ID identity, Team ID, or unexpected notarization state blocks this preview posture.

## 3. Exercise installation and runtime

1. Open the DMG, drag Wren to Applications, and confirm ordinary first launch is
   blocked as unidentified or unverified.
2. Follow the documented **System Settings → Privacy & Security → Open Anyway**
   path. Do not use `xattr`, disable Gatekeeper, or weaken system-wide policy.
3. Start Wren with a new disposable profile. Confirm dashboard, wallet panel,
   tray, Control Center, clean close, restart persistence, and single-instance
   behavior. A second instance must not take Wren's local ports or create another
   profile writer.
4. Create and remove disposable recovery-phrase and private-key signers. Confirm
   password unlock, signing, lock, restart, backup export, and backup restore.
   Settings must not claim macOS OS-backed signer protection.
5. Pair the exact compatible Companion archive in Chrome or Firefox, compare the
   six-digit code, and approve and reject disposable requests. Reconnect after a
   Wren and browser restart.
6. Confirm no macOS automatic-update metadata was published or consumed. Install
   a later candidate only by downloading and verifying it independently.

Hardware signing remains limited to the separately recorded physical-device
evidence. A successful software-signer run does not qualify Ledger, Trezor, or
Lattice on macOS.

## 4. Record the result

Record sanitized pass/fail rows for each architecture independently. Until a
physical Intel result exists, label x64 unqualified; until a physical Apple
Silicon result exists, label arm64 unqualified. A failed check requires a new
source commit and candidate rather than replacing a published artifact.
