# Linux release procedure

Use this how-to to prepare, verify, review, and publish a Linux x64 candidate. It
does not replace the [qualification checklist](QUALIFICATION.md) or the
[signer and platform support reference](HARDWARE_SUPPORT.md). For product
orientation and installation, see the [README](README.md).

## 1. Confirm the release boundary

Linux x64 AppImage and deb packages are Wren's current release target. The GitHub workflow
creates a **new draft** only; it does not update or publish a release. Packages
are unsigned, macOS notarization and Windows signing are not configured, and
Linux x64 remains the only release target. Secret-free CI builds and verifies real
unsigned Linux arm64, macOS x64/arm64, and Windows x64 smoke packages on matching
native runners; these artifacts are neither published nor platform-qualified.
Glide is qualified on X11 only; on native Wayland use the tray or summon shortcut.

The native verifier checks clean source/application identity, packaged resources,
runtime architecture, native hardware modules, sandbox policy, and matching
unpacked/archive payload behavior. It does not exercise installers, the graphical
desktop, hardware, signing, notarization, or operating-system integration.

## 2. Prepare a candidate

1. Use a clean, reviewed default-branch commit. Set a new SemVer-compatible
   `package.json` version and regenerate `package-lock.json` with the pinned
   Node/npm toolchain. Do not reuse a published tag.
2. Update release notes and support claims. Record current physical-device
   evidence in [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md). When desktop/Companion
   integration changes, update the Companion `compatibility.json` minimum desktop
   commit and build both from their exact paired commits; protocol 2 must not be
   directed at an older store extension.
3. Run the release gate:

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
   npm run test:usbAdapters
   npm run bundle
   npm run package:linux:x64
   npm run package:verify:linux
   npm run sbom:linux
   npm run sbom:verify:linux
   npm run checksums:linux
   npm run release:verify:linux
   npm run repro:linux -- --output reproducibility-report.json
   ```

4. Review the diff, dependency graph, test output, package names,
   `dist/SHA256SUMS`, and `dist/wren.cdx.json`. The manifest must cover exactly
   the AppImage, amd64 deb, and source-bound SBOM; package verification must
   report the embedded identity of the clean compiled source. Do not waive an
   unexplained signing, migration, native-module, or packaging failure.

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
Linux release** for it. The requested tag must exactly match the package version.
The workflow runs the gate, verifies native hardware modules, generates and
verifies the CycloneDX SBOM and SHA-256 manifest, creates build/SBOM
attestations, and attaches the four files to a draft targeted at the exact
workflow SHA. It rejects a tag pointing elsewhere and refuses to modify an
existing release. Pull-request jobs cannot publish; CodeQL runs on `main` pushes
and weekly.

Before publishing, confirm the intended commit and passing jobs; verify
`sha256sum --check SHA256SUMS` on a separate test system; inspect attestations,
SBOM, filenames, application version, and notes; and test both packages,
single-instance/port-conflict behavior, tray/dash, provider startup, updater,
and explicit import from a backed-up disposable Frame profile. Complete the
applicable signer and paired Chrome/Firefox Companion regression in
[`QUALIFICATION.md`](QUALIFICATION.md): archive checksums and compatibility,
initial-code comparison, reconnect, reset, revocation, origin isolation, and
EIP-6963 discovery. Keep unsigned artifacts and unqualified platforms/signers
prominent in the notes.

## 5. Publish or reject

Publish only after the review passes. Leave a failed draft unpublished or delete
it in GitHub; fix the source and make a new version/tag rather than replacing a
published artifact. Afterwards, check public downloads, checksums, notes, and
updater behavior from a clean machine; retain the source commit, lockfile, SBOM,
checksums, and attestations for the release lifetime.

For an unsafe release, remove it from normal discovery, issue a security notice,
and release a fix. Never rewrite the compromised tag.
