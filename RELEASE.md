# Linux and Windows release procedure

Use this how-to to prepare, verify, review, and publish Linux x64 packages and an
unsigned Windows x64 preview. It does not replace the
[qualification checklist](QUALIFICATION.md), the
[Windows preview checklist](WINDOWS_RELEASE_QUALIFICATION.md), or the
[signer and platform support reference](HARDWARE_SUPPORT.md).

## 1. Confirm the release boundary

Linux x64 AppImage and deb packages remain Wren's qualified release target.
Windows x64 is published only as a clearly named unsigned preview. The GitHub
workflow creates a **new draft**; it does not publish or modify an existing
release. macOS and Linux arm64 remain unpublished native smoke targets. Glide is
qualified on X11 only; on native Wayland use the tray or summon shortcut.

Keep macOS jobs credential-free and outside draft assembly, release checksums,
and attestations. Adding signed or public Mac packages requires a new explicit
publisher-identity and privacy decision.

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

5. Review the diff, dependency graph, test output, package names, local Linux
   `dist/SHA256SUMS`, and `dist/wren.cdx.json`. The final workflow creates a
   combined manifest covering the AppImage, deb, unsigned Windows installer, and
   source-bound SBOM. Do not waive an unexplained identity, signature-state,
   migration, native-module, or packaging failure.

## 3. Review reproducibility evidence

The bounded two-build comparison at commit
`cb6078a2e2a4ce6c841cf5afa1907947d9a9be21` used the commit epoch with `TZ=UTC`,
`LANG=C`, and `LC_ALL=C`. Compiled output, renderer bundles, unpacked application,
extracted AppImage/deb payloads, all native modules, the CycloneDX SBOM, and deb
package bytes matched. The AppImage container bytes did not; only the AppImage,
its derived `latest-linux.yml`, and `SHA256SUMS` differed. Identical extracted
payloads isolate the observed variance to the AppImage container. No low-risk
repository-local remediation was evidenced, so Wren does not claim byte-for-byte
AppImage reproducibility. Run the command above on each candidate and retain its
report with private release evidence.

## 4. Create and review the draft

Push `v<package version>` on that commit, or manually dispatch **Build a draft
Linux and Windows release**. The requested tag must exactly match the package
version. Shared quality, Linux packaging, and native Windows packaging must all
pass for the same workflow SHA. The final job downloads only those staged files,
creates and verifies one SHA-256 manifest, and attaches five files to a draft:
AppImage, deb, unsigned Windows installer, SBOM, and `SHA256SUMS`. Linux and
Windows packages receive build and SBOM attestations. The workflow rejects a tag
pointing elsewhere and refuses to modify an existing release.

Before publishing, confirm the intended commit and passing jobs; verify the
applicable entries in `SHA256SUMS` on separate Linux and Windows systems; inspect
attestations, SBOM, filenames, application version, and notes; and test both Linux packages,
single-instance/port-conflict behavior, tray/dash, provider startup, updater,
and explicit import from a backed-up disposable Frame profile. Complete the
applicable signer and paired Chrome/Firefox Companion regression in
[`QUALIFICATION.md`](QUALIFICATION.md): archive checksums and compatibility,
initial-code comparison, reconnect, reset, revocation, origin isolation, and
EIP-6963 discovery. Complete the Windows preview checklist on the exact staged
installer. Keep the unsigned Windows state and unqualified platforms/signers
clear in the notes.

## 5. Publish or reject

Publish only after the review passes. Leave a failed draft unpublished or delete
it in GitHub; fix the source and make a new version/tag rather than replacing a
published artifact. Afterwards, check public downloads, checksums, notes, and
updater behavior from a clean machine; retain the source commit, lockfile, SBOM,
checksums, and attestations for the release lifetime.

For an unsafe release, remove it from normal discovery, issue a security notice,
and release a fix. Never rewrite the compromised tag.
