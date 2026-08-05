# Release Procedure

## Current Release Boundary

This fork currently produces Linux x64 AppImage and deb artifacts. The automated
workflow runs for an exact version tag or a manual dispatch and creates a new
GitHub **draft** release. It never updates or publishes a release automatically.
Linux artifacts are currently unsigned; macOS notarization and Windows signing
are not configured for this fork.

Dependency locking makes installation deterministic, but byte-for-byte
reproducible artifacts have not yet been demonstrated.

Glide edge reveal is supported on X11 sessions. Native Wayland is not qualified
for Glide because Electron does not support cursor-point polling there; use the
tray menu or summon shortcut instead.

## Prepare

1. Choose a clean, reviewed commit on the default branch. Never release from a
   dirty worktree. For a preview release, dispatch the workflow from the exact
   reviewed `main` commit.
2. Set a unique SemVer-compatible version in `package.json` and regenerate
   `package-lock.json` using the pinned Node/npm toolchain. Do not reuse a tag from
   a published release.
3. Update user-facing release notes and support claims. Physical hardware claims
   must have a current result recorded using
   [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md).
4. Update the companion's `compatibility.json` to the minimum reviewed desktop
   commit when protocol or integration behavior changed. Build desktop and
   companion candidates from their exact paired commits; never direct this
   protocol-v2 desktop to an older store extension.
5. Run the local quality and package gate:

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
   ```

6. Inspect the final diff, dependency graph, test output, package names,
   `dist/SHA256SUMS`, and `dist/wren.cdx.json`. The checksum manifest must cover
   both packages and the source-bound SBOM. Package verification must report the
   exact clean source identity embedded during compilation. Do not waive
   unexplained signing, migration, native-module, or packaging failures.

## Build The Draft

Push the exact `v<package version>` tag on the reviewed commit, or run the **Build
a draft Linux release** workflow from GitHub Actions against that commit. A
manually supplied tag must match the package version exactly. The tag trigger is
available even while this workflow is not on the repository default branch,
because GitHub reads it from the tagged commit.

The workflow performs the full quality gate, verifies required hardware native
modules, generates SHA-256 checksums and a CycloneDX SBOM, creates build and SBOM
attestations, and uploads the files to a draft release. It refuses to replace
or add assets to an existing release, rejects tags bound to another commit, and
records the workflow's exact source SHA as the draft target. GitHub creates a
missing tag from that target when the draft is published.

Pull-request workflows have read-only repository access and cannot publish.
CodeQL runs on pushes to `main` and through its weekly scheduled scan.

## Review The Draft

1. Confirm the workflow ran from the intended commit and all jobs passed.
2. Download artifacts on a separate test system and run
   `sha256sum --check SHA256SUMS` from the download directory.
3. Inspect the GitHub artifact attestations and SBOM. Confirm artifact filenames
   and embedded application version match the draft tag and release notes.
4. Install the deb alongside the separately named Frame package and launch the
   AppImage separately. Verify startup, single-instance and local-port conflict
   behavior, tray/dash placement, local provider startup, update behavior, and
   explicit profile import from a backed-up disposable Frame profile.
5. Run the applicable manual signer regression with test-only accounts. Do not
   use valuable accounts merely to qualify a release. Record the complete paired
   browser, signer, package, and profile result using
   [`QUALIFICATION.md`](QUALIFICATION.md).
6. Record known limitations prominently in the release notes, including unsigned
   artifacts and unverified platforms/signers.
7. Qualify the paired Chrome and Firefox companion archives from their own
   checksums and compatibility metadata. Confirm initial code comparison,
   reconnect, reset, revocation, origin isolation, EIP-6963 discovery, and legacy
   injection against this exact desktop candidate.

## Publish Or Reject

Publish the GitHub draft only after review succeeds. A failed draft should remain
unpublished or be deleted through the GitHub UI; fix the source and create a new
version/tag rather than silently replacing a published artifact.

After publishing, verify the public checksums, downloads, release notes, and
updater behavior from a clean machine. Retain the source commit, lockfile, SBOM,
checksums, and attestations for the lifetime of the release.

If a release is unsafe, remove it from normal discovery, publish a security
notice, and issue a fixed version. Do not rewrite the compromised tag.
