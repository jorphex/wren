# Linux, Windows, and macOS release procedure

Use this procedure for Linux x64 packages and Windows x64 and macOS x64/arm64
previews. Windows previews are unsigned. macOS previews use ad-hoc signatures
and are not notarized. Complete the [qualification checklist](QUALIFICATION.md)
and the applicable [Windows](WINDOWS_RELEASE_QUALIFICATION.md) or
[macOS](MACOS_UNNOTARIZED_QUALIFICATION.md) checklist.
See [signer support](HARDWARE_SUPPORT.md) for recorded tests and limits.

## 1. Confirm the release boundary

Linux x64 AppImage and deb packages are the main release target.
Windows x64 and macOS x64/arm64 remain previews with the signature states above.
Linux arm64 has automated native package checks and is not published.
Glide is qualified on X11; use the tray or summon shortcut on native Wayland.
The GitHub workflow creates a **new draft**. Publication is a separate action.

Keep macOS jobs credential-free. Require valid ad-hoc code seals, no Apple
Developer ID or Team ID, no notarization ticket, and Gatekeeper rejection.
Users must choose **Open Anyway** before first launch.
Publish each architecture's DMG with checksums and GitHub attestations.
Keep ZIPs and macOS updater metadata outside the release.

The native verifier checks source identity, resources, architecture, native
modules, sandbox policy and archive contents. Windows checks require `NotSigned`
for `Wren.exe` and the installer. They check DPAPI policy without real credentials.
GUI, hardware, SmartScreen and credential-storage checks use the manual checklists.
DPAPI qualification also needs the
[signer-protection checklist](WINDOWS_SIGNER_PROTECTION_QUALIFICATION.md).

## 2. Prepare a candidate

Review the licenses of bundled dependencies. Trezor Connect carries T-RSL;
no separate Wren grant is recorded. Its applicable integration and redistribution
terms remain a [clarification item](TREZOR_CLEAR_SIGNING.md#sdk-license-prerequisite).

Check the qualification record for the candidate version. If an unpublished
draft contains older artifacts, archive its files before removing it.
The workflow refuses to overwrite an existing release.

1. Use a clean, reviewed default-branch commit. Set a new SemVer-compatible
   `package.json` version and regenerate `package-lock.json` with the pinned
   Node/npm toolchain. Do not reuse a published tag.
2. Update the matching `release-notes/v<version>.md` and support claims. Record
   current physical-device evidence in
   [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md). When desktop/Companion integration
   changes, update the Companion `compatibility.json` minimum desktop commit and
   build both from their exact paired commits. The current protocol is version 3;
   do not direct a protocol-3 client to an older store extension.
3. Install `xvfb` for renderer checks, then run the Linux release gate:

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
   mkdir -p .cache/release-evidence
   WREN_E2E_EVIDENCE_DIR="$PWD/.cache/release-evidence" npm run test:e2e
   cp compiled/simulation-fallback-e2e.json .cache/release-evidence/
   npm run test:usbAdapters
   npm run qualify:ui
   npm run package:linux:x64
   npm run package:verify:linux
   npm run sbom:release
   npm run sbom:verify:release
   npm run checksums:linux
   npm run release:verify:linux
   npm run repro:linux -- --output .cache/release-evidence/reproducibility-report.json
   ```

   Save the test logs and `.cache/release-evidence` with the candidate record.
   The copy keeps the RPC fallback report through later compiles.

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

Packaged dependencies omit source maps, type declarations, and reviewed SDK test
files. License files remain included. Use the matching source checkout and
lockfile when debugging dependency code.

## 3. Review reproducibility evidence

Run the bounded two-build comparison for every candidate. It fixes the commit
epoch, timezone, and locale, then compares compiled output, renderer bundles,
unpacked applications, extracted AppImage/deb payloads, native modules, the SBOM,
and package bytes. The per-candidate report is authoritative.

Application and package payloads must match. AppImage container bytes,
`latest-linux.yml` and their checksum entries may differ. Any other difference
blocks release. Keep the comparison report with the candidate record.

## 4. Create and review the draft

Push `v<package version>` on that commit, or manually dispatch **Build a draft
Linux, Windows, and macOS release**. The requested tag must exactly match the
package version. Shared quality, Linux packaging, native Windows packaging,
and both native macOS packaging jobs must pass for the same workflow SHA. The
final job downloads only those staged files, compares all four platform SBOMs,
creates and verifies one SHA-256 manifest, and attaches seven files to a
draft: AppImage, deb, unsigned Windows installer, two unnotarized macOS DMGs,
SBOM, and `SHA256SUMS`.

Every public package receives build and SBOM attestations. The workflow
rejects a tag pointing elsewhere and refuses to modify an existing release.

Before publishing:

1. Confirm the intended commit and passing jobs.
2. Verify the applicable `SHA256SUMS` entries on separate Linux and Windows systems.
3. Check attestations, SBOM, filenames, application version, and notes.
4. Test both Linux packages. Check single-instance behavior, port conflicts,
   tray/dashboard, provider startup, and updater behavior. Test explicit import
   from a backed-up disposable Frame profile.
5. Complete the applicable signer and paired Chrome/Firefox Companion checks in
   [`QUALIFICATION.md`](QUALIFICATION.md). Include archive checksums, compatibility,
   initial-code comparison, reconnect, reset, revocation, origin isolation, and
   EIP-6963 discovery.
6. Complete the Windows preview checklist on the exact staged installer.
7. Apply the [macOS unnotarized checklist](MACOS_UNNOTARIZED_QUALIFICATION.md)
   to each architecture with available physical evidence.

An architecture without physical evidence may remain a public preview only
when its release notes state that it was not physically installed or qualified.
Keep the unsigned Windows state, unnotarized macOS state, unsupported macOS
device protection, and all unqualified platforms and signers clear in the notes.

## 5. Publish or reject

Publish only after the applicable preview review passes. Leave a failed draft
unpublished or delete it in GitHub. Fix the source and make a new version and tag
rather than replacing a published artifact. Afterwards, check public downloads,
checksums, notes, and updater behavior from a clean machine; macOS must not
receive update metadata. Retain the source commit, lockfile, SBOM, checksums, and
attestations for the release lifetime.

For an unsafe release, remove it from normal discovery, issue a security notice,
and release a fix. Never rewrite the compromised tag.
