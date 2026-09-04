<p align="center">
  <img src="asset/brand/exports/app/wren-app-icon-512.png" alt="Wren" width="150" />
</p>

<h1 align="center">Wren</h1>

<p align="center">A desktop EVM wallet for reviewing and signing requests from browsers and native apps.</p>

<p align="center">
  <a href="https://getwren.xyz">Website</a> ·
  <a href="https://github.com/jorphex/wren/releases">Download</a> ·
  <a href="https://github.com/jorphex/wren-companion/releases">Companion</a> ·
  <a href="release-notes/v0.1.7.md">What’s new</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="RPC_COMPATIBILITY.md">Developer reference</a>
</p>

> [!NOTE]
> Wren has not had an independent security audit. Linux x64 is the qualified
> target. Windows and macOS builds are unqualified previews without trusted
> publisher identities. Please keep a backup, verify checksums, and start small.

Wren gives browser dapps and native apps one place to request account access,
review activity, and ask for signatures. Each app keeps its own account permission
and chain route, so Wren does not depend on a global network switch.

## Highlights

- Clear reviews for transactions, approvals, permits, messages, EIP-712, SIWE,
  EIP-7702 revocation, and sequential EIP-5792 calls.
- Expected asset changes from configured-RPC simulation, with calldata and trace
  evidence available when supported. Simulation is helpful context, not a guarantee.
- Adjustable token allowances, editable fees and nonces, and compact transaction
  progress from submission through confirmation.
- Encrypted software signers, supported hardware wallets, watch-only accounts,
  and per-app permissions.
- Local contacts, Send, multi-asset Sweep, and an allowlisted Yearn Earn catalog.

See [supported standards](SUPPORTED_EIPS.md),
[execution boundaries](EXECUTION_BOUNDARIES.md), and
[Yearn Earn](YEARN_EARN.md) for exact behavior.

## Support

The current desktop release is Wren 0.1.7. It pairs with Wren Companion 0.1.2
over authenticated protocol 3. Linux x64 is qualified; Windows and macOS remain
unqualified previews, and Linux arm64 is a CI smoke target only. Read
[Signer and platform support](HARDWARE_SUPPORT.md) for the full platform and
account boundary.

## Install

Download Wren and `SHA256SUMS` from the
[desktop releases page](https://github.com/jorphex/wren/releases).

### Linux x64

Verify the downloaded files:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

Run the AppImage:

```bash
chmod +x Wren-0.1.7.AppImage
./Wren-0.1.7.AppImage
```

Or install the deb:

```bash
sudo apt install ./wren_0.1.7_amd64.deb
```

Linux packages are unsigned. Checksums and GitHub attestations verify their
release identity.

### Windows and macOS previews

Windows x64 is unsigned and may show an unknown-publisher warning; follow the
[Windows preview guide](WINDOWS_RELEASE_QUALIFICATION.md). macOS Intel and Apple
Silicon builds are ad-hoc signed and unnotarized; follow the
[macOS preview guide](MACOS_UNNOTARIZED.md). Future Windows signing will follow
the [code-signing policy](CODE_SIGNING_POLICY.md).

### Browser companion

Chrome and Brave users can install
[Wren Companion from the Chrome Web Store](https://chromewebstore.google.com/detail/wren-companion/ifimccfajfbgligbhcgfapdagpnfkbhn).
Firefox store review is pending. Manual Chrome and Firefox archives are available
from the [Companion releases page](https://github.com/jorphex/wren-companion/releases).

Use Companion 0.1.2 and compare the six-digit code shown by both apps before
pairing.

### Import a Frame profile

Wren does not read Frame’s live profile. To make a one-time private copy, close
both apps, back up `~/.config/frame`, and run this before Wren creates its profile:

```bash
./Wren-0.1.7.AppImage --import-frame-profile
```

The import copies only the supported configuration and encrypted signer files.
Frame remains unchanged.

## Build from source

The repository pins Node and npm. On Ubuntu or Debian:

```bash
sudo apt-get update
sudo apt-get install build-essential libudev-dev
git clone https://github.com/jorphex/wren.git
cd wren
nvm install
nvm use
npm install --global npm@11.12.0
npm run setup:ci
npm run prod
```

For packaging and qualification, follow the
[release procedure](RELEASE.md) and [qualification checklist](QUALIFICATION.md).

## Privacy

Wren has no first-party hosted backend. Network requests go to explicit,
replaceable services:

| Purpose       | Default                 | Shared data                                               |
| ------------- | ----------------------- | --------------------------------------------------------- |
| EVM RPC       | PublicNode              | IP address, queries, calldata, and submitted transactions |
| USD prices    | DefiLlama               | Relevant token identifiers; not the selected address      |
| Send content  | IPFS.io                 | IP address and the reviewed, CID-verified content request |
| Earn catalog  | Yearn Kong              | A fixed catalog request; no account data                  |
| Token artwork | Reviewed CoinGecko host | Recognized artwork requests only                          |

Wren does not contact Pylon or use an NFT indexer. Read the
[threat model](THREAT_MODEL.md) for the full trust and data boundary. Custom RPC
and IPFS endpoints are supported through settings and environment configuration.

## Security and license

Please report vulnerabilities privately through the
[security policy](SECURITY.md). Only the newest Wren release is considered for
security fixes.

Wren is a community-maintained continuation of the GPL-licensed
[Frame wallet](https://github.com/floating/frame), not a Frame Labs release. It is
distributed under the [GNU GPL v3.0](LICENSE).
