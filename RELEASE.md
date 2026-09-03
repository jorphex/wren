# Linux, Windows, and macOS release procedure

Use this how-to to prepare, verify, review, and publish Linux x64 packages, an
unsigned Windows x64 preview, and ad-hoc-signed unnotarized macOS x64/arm64
previews. It does not replace the
[qualification checklist](QUALIFICATION.md), the
[Windows preview checklist](WINDOWS_RELEASE_QUALIFICATION.md), or the
[macOS unnotarized checklist](MACOS_UNNOTARIZED_QUALIFICATION.md). See the
[signer and platform support reference](HARDWARE_SUPPORT.md) for the exact
qualification boundary.

## 1. Confirm the release boundary

Linux x64 AppImage and deb packages remain Wren's qualified release target.
Windows x64 is published only as a clearly named unsigned preview. The GitHub
workflow creates a **new draft**; it does not publish or modify an existing
release. macOS x64 and arm64 are published only as clearly named ad-hoc-signed,
unnotarized, unqualified previews. Linux arm64 remains an unpublished native
smoke target. Glide is qualified on X11 only; on native Wayland use the tray or
summon shortcut.

Keep macOS jobs credential-free. The preview has valid ad-hoc code seals but no
Apple Developer ID, Team ID, trusted publisher, notarization ticket, or Apple
malware review. Gatekeeper must reject it until the user explicitly chooses
**Open Anyway**. Publish only each architecture's DMG; keep its matching ZIP and
all macOS updater metadata outside the release. Verify each DMG through checksums
and GitHub attestations; do not add Developer ID signing or notarization to this
release path.

The native verifier checks source/application identity, packaged resources,
runtime architecture, native modules, sandbox policy, and matching archive
payloads. On Windows it also requires `NotSigned` for both `Wren.exe` and the
installer and checks DPAPI policy selection without reading real DPAPI data. It
does not exercise the graphical desktop, physical hardware, SmartScreen, or
native credential persistence. Use the [Windows preview
checklist](WINDOWS_RELEASE_QUALIFICATION.md) and, for DPAPI claims, the separate
[signer-protection checklist](WINDOWS_SIGNER_PROTECTION_QUALIFICATION.md).

## 2. Prepare a candidate

1. Use a clean, reviewed default-branch commit. Set a new SemVer-compatible
   `package.json` version and regenerate `package-lock.json` with the pinned
   Node/npm toolchain. Do not reuse a published tag.
2. Update the matching `release-notes/v<version>.md` and support claims. Record
   current physical-device evidence in
   [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md). When desktop/Companion integration
   changes, update the Companion `compatibility.json` minimum desktop commit and
   build both from their exact paired commits. The current protocol is version 3;
   do not direct a protocol-3 client to an older store extension.
3. Run the Linux release gate:

   ```bash
   nvm install
   nvm use
   npm install --global npm@11.12.0
   npm run setup:ci
   npm run audit:release
   npm run format:check
   npm run lint
   npm run compile
   npm test
   npm run test:e2e
   npm run test:usbAdapters
   npm run bundle
   npm run package:linux:x64
   npm run package:verify:linux
   npm run sbom:release
   npm run sbom:verify:release
   npm run checksums:linux
   npm run release:verify:linux
   npm run repro:linux -- --output reproducibility-report.json
   ```

4. On native Windows x64, check out the same clean commit and run:

   ```powershell
   npm install --global npm@11.12.0
   npm run setup:ci
   npm run compile
   npm run bundle
   npm run package:windows:unsigned:x64
   npm run package:verify:windows:x64
   npm run sbom:release
   npm run sbom:verify:release
   ```

   The verifier must report the exact unsigned installer name, matching archive
   payloads, and `NotSigned` for the installer and packaged executable.

5. On native Intel and Apple Silicon macOS hosts, respectively, check out the
   same clean commit and run:

   ```bash
   npm install --global npm@11.12.0
   npm run setup:ci
   npm run compile
   npm run bundle
   npm run package:mac:preview:x64
   npm run package:verify:mac:x64
   npm run sbom:release
   npm run sbom:verify:release
   ```

   Replace the two `x64` commands with `arm64` on Apple Silicon. The verifier
   must execute the unpacked, DMG, and ZIP payloads; require an ad-hoc app seal
   with no Apple identity; and require Gatekeeper assessment to reject it.

6. Review the diff, dependency graph, test output, package names, local Linux
   `dist/SHA256SUMS`, and `dist/wren.cdx.json`. The final workflow creates a
   combined manifest covering the AppImage, deb, unsigned Windows installer,
   both unnotarized macOS DMGs, and source-bound SBOM. Do not waive an unexplained
   identity, signature-state, Gatekeeper-state, migration, native-module, or
   packaging failure.

## 3. Review reproducibility evidence

Run the bounded two-build comparison for every candidate. It fixes the commit
epoch, timezone, and locale, then compares compiled output, renderer bundles,
unpacked applications, extracted AppImage/deb payloads, native modules, the SBOM,
and package bytes. The per-candidate report is authoritative.

Wren does not claim byte-for-byte AppImage reproducibility. The accepted boundary
requires identical application and package payloads; AppImage container bytes,
`latest-linux.yml`, and their checksum entries may vary. Any other difference
blocks release. Retain the report with private release evidence.

## 4. Create and review the draft

Push `v<package version>` on that commit, or manually dispatch **Build a draft
Linux, Windows, and macOS release**. The requested tag must exactly match the
package version. Shared quality, Linux packaging, native Windows packaging, and
both native macOS packaging jobs must pass for the same workflow SHA. The final
job downloads only those staged files, compares all four platform SBOMs, creates
and verifies one SHA-256 manifest, and attaches seven files to a draft: AppImage,
deb, unsigned Windows installer, two unnotarized macOS DMGs, SBOM, and
`SHA256SUMS`. Every public package receives build and SBOM attestations. The
workflow rejects a tag pointing elsewhere and refuses to modify an existing
release.

Before publishing, confirm the intended commit and passing jobs; verify the
applicable entries in `SHA256SUMS` on separate Linux and Windows systems; inspect
attestations, SBOM, filenames, application version, and notes; and test both Linux packages,
single-instance/port-conflict behavior, tray/dash, provider startup, updater,
and explicit import from a backed-up disposable Frame profile. Complete the
applicable signer and paired Chrome/Firefox Companion regression in
[`QUALIFICATION.md`](QUALIFICATION.md): archive checksums and compatibility,
initial-code comparison, reconnect, reset, revocation, origin isolation, and
EIP-6963 discovery. Complete the Windows preview checklist on the exact staged
installer. Apply the [macOS unnotarized checklist](MACOS_UNNOTARIZED_QUALIFICATION.md)
to each architecture with available physical evidence. An architecture without
that evidence may remain a public preview only when release notes say it was not
physically installed or qualified. Keep the unsigned Windows state, unnotarized
macOS state, unsupported macOS device protection, and all unqualified
platforms/signers clear in the notes.

## 5. Publish or reject

Publish only after the applicable preview review passes. Leave a failed draft
unpublished or delete it in GitHub. Fix the source and make a new version and tag
rather than replacing a published artifact. Afterwards, check public downloads,
checksums, notes, and updater behavior from a clean machine; macOS must not
receive update metadata. Retain the source commit, lockfile, SBOM, checksums, and
attestations for the release lifetime.

For an unsafe release, remove it from normal discovery, issue a security notice,
and release a fix. Never rewrite the compromised tag.
