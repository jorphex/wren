<p align="center">
  <img src="asset/png/WrenLogo512.png" alt="Wren" width="150" />
</p>

<h1 align="center">Wren</h1>

<p align="center">
  A system-wide EVM wallet and signing firewall for browsers, native applications, and command-line tools.
</p>

<p align="center">
  <a href="https://github.com/jorphex/wren/releases">Desktop releases</a> ·
  <a href="https://github.com/jorphex/wren-companion/releases">Browser companion</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="SUPPORTED_EIPS.md">Standards</a> ·
  <a href="RPC_COMPATIBILITY.md">RPC compatibility</a>
</p>

> [!WARNING]
> Wren is preview wallet software with no independent security audit. The current release target is Linux x64. Back up your Wren profile, verify release checksums, and test with accounts that do not hold valuable assets before relying on a release. Use at your own risk.

Wren runs as a desktop wallet and exposes one consistent approval and signing interface to the rest of the system. Dapps can connect through the paired browser companion or directly through Wren's local EIP-1193/JSON-RPC provider. Accounts and chains are routed independently, so applications do not have to share one global network selection.

## Current Release

Wren `0.1.0` is the first independently branded Linux x64 AppImage and deb
release candidate. Browser dapps require the separately versioned Wren
Companion `0.1.0` candidate. Neither candidate is a published release until its
repository's release page contains the matching artifacts, checksums, and
source-bound metadata.

| Component or platform                  | Current status                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Linux x64 AppImage and deb             | Release candidate; Wren-branded qualification pending                         |
| Trezor Safe 7 over USB                 | Physically tested for address verification, signing, broadcast, and reconnect |
| Trezor Model One over USB              | Physically tested with documented typed-data and testnet limitations          |
| Ledger and GridPlus Lattice1           | Implemented with automated coverage; not physically requalified for `0.1.0`   |
| Seed phrase, private key, and keystore | Encrypted local signer workers; disposable seed and private-key flows tested  |
| Watch-only addresses                   | Supported for monitoring; signing is blocked                                  |
| Chrome and Firefox companion           | Companion `0.1.0`; paired candidate qualification remains release-gated       |
| macOS, Windows, and Linux arm64        | Not produced or qualified by this project                                     |
| Trezor Safe 7 Bluetooth                | Unsupported                                                                   |

See [Signer and Platform Support](HARDWARE_SUPPORT.md) for the evidence behind
each claim and all known limitations. Trezor Suite is not required for the
qualified Safe 7 USB flow.

## Features

- **System-wide provider:** HTTP and WebSocket JSON-RPC endpoints let browsers,
  native programs, and command-line tools use the same wallet.
- **Hardware-first signing:** Trezor, Ledger, and GridPlus signer adapters keep
  signing behind explicit device and capability checks.
- **Software and watch accounts:** Seed, private-key, keystore, and watch-only
  accounts coexist behind clear signing boundaries.
- **Local contacts:** Save, search, back up, and restore trusted EVM
  destinations. Saved contacts and existing Wren account names appear beside
  the full address during transfer and approval review without changing the
  signed payload; saved contacts take precedence.
- **Origin permissions:** Account access and wallet-owned RPC methods are
  permission-gated for each requesting origin and selected account. Passive
  discovery calls fail closed without opening an approval prompt.
- **Transaction review:** Calldata decoding, approval-risk detection,
  configured-RPC simulation, native balance effects, logs, and bounded traces
  provide evidence before approval. Simulation is evidence, not a guarantee.
- **Clearer signatures:** Structured EIP-712 review, permit and Permit2
  detection, SIWE interpretation, hardware capability warnings, and explicit
  consent for dangerous `eth_sign` requests.
- **Multichain routing:** Each application can target an enabled chain without
  forcing every connected application onto one global network.
- **Desktop-native shell:** A bounded dark-mode wallet and dashboard stay coupled
  on the active display. Glide summons from the right edge by default and can be
  mirrored to the left in Settings.
- **Curated Yearn Earn:** Locally
  allowlisted Ethereum, Base, and Katana Yearn products with positions, direct
  and product-specific workflows, exact approvals, configured-RPC simulation,
  ordinary Wren signer review, and hidden balance tracking for curated assets
  and vault shares. Packaged Base deposit, partial withdrawal, Max redeem, and
  physical Trezor signing have been exercised; other product paths retain the
  narrower evidence and limitations documented in [Yearn Earn](YEARN_EARN.md).
- **Modern wallet methods:** Hardened EIP-1193 behavior, chain add/switch flows,
  paired-companion EIP-6963 discovery, and non-atomic EIP-5792 wallet calls.
- **User-controlled infrastructure:** Custom Ethereum RPC and Kubo IPFS
  endpoints remain supported.
- **Release evidence:** Locked dependencies, automated tests, CodeQL, package
  verification, SHA-256 manifests, CycloneDX SBOMs, and GitHub build provenance
  accompany the release process.

Exact support boundaries are maintained in [Supported Ethereum
Standards](SUPPORTED_EIPS.md) and [RPC Compatibility](RPC_COMPATIBILITY.md).

## Install

After the candidate is published, download `Wren-0.1.0.AppImage` or
`wren_0.1.0_amd64.deb` together with `SHA256SUMS` from the
[`0.1.0` release](https://github.com/jorphex/wren/releases/tag/v0.1.0). Verify
the files from the download directory before running either package:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

Run the AppImage without installing it:

```bash
chmod +x Wren-0.1.0.AppImage
./Wren-0.1.0.AppImage
```

Or install the deb package:

```bash
sudo apt install ./wren_0.1.0_amd64.deb
```

The Linux packages are currently unsigned. Verify their checksums and GitHub
artifact attestations against the published release before installation.

### Import A Frame Profile

Wren never reads or shares Frame's live profile by default. To make a one-time
private copy, close Frame and Wren, back up `~/.config/frame`, and run Wren with
the explicit import flag before Wren has created `~/.config/wren`:

```bash
./Wren-0.1.0.AppImage --import-frame-profile
```

For an installed deb, run `/opt/Wren/wren --import-frame-profile`. Wren validates
and copies only `config.json` and encrypted signer files through a private staging
directory, then atomically installs the new profile. It refuses an active Frame
profile, malformed data, links, oversized files, or an existing Wren profile.
The source remains unchanged, and the new profile records a non-secret import
receipt. Rollback means closing Wren and returning to the untouched Frame app and
profile; do not delete either profile until the imported state has been verified.

### Browser Companion

The browser companion injects Wren's EIP-1193 provider and announces it using
EIP-6963. Once the candidate is published, download the Chrome or Firefox
archive from the
[`0.1.0` companion release](https://github.com/jorphex/wren-companion/releases/tag/v0.1.0),
verify its checksum, extract it, and follow the
[companion installation instructions](https://github.com/jorphex/wren-companion#install).

The first connection displays a six-digit code in Wren and the extension.
Compare both codes before approving the pairing. Older store extensions do not
implement the authenticated protocol used by this desktop release.

## Run From Source

The repository pins Node and npm versions. On Ubuntu or Debian, install the
native build prerequisites first:

```bash
sudo apt-get update
sudo apt-get install build-essential libudev-dev
```

Then install the pinned toolchain and dependencies:

```bash
git clone https://github.com/jorphex/wren.git
cd wren
nvm install
nvm use
npm install --global npm@11.12.0
npm run setup:ci
npm run prod
```

`npm run setup:ci` uses the committed lockfile, permits only reviewed dependency
install scripts, installs Electron, and rebuilds the native HID module.

To produce the qualified Linux package formats locally:

```bash
npm run compile
npm run bundle
npm run package:linux:x64
```

Release candidates require the complete checks documented in
[Release Procedure](RELEASE.md); a successful local package command alone is
not release qualification.

## Local Provider

Wren listens only on the loopback interface:

```text
http://127.0.0.1:1248
ws://127.0.0.1:1248
```

Applications can send standard JSON-RPC requests to these endpoints and route
an enabled EVM chain using Wren's documented request metadata. Wallet-owned
methods, subscriptions, origin handling, limits, and known local-process trust
boundaries are documented in [RPC Compatibility](RPC_COMPATIBILITY.md).

## Network Data And Privacy

Wren has no first-party hosted backend. Its default public services are explicit
and replaceable:

| Purpose                   | Default                                                              | Data sent                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM RPC                   | [PublicNode](https://publicnode.com/) on supported built-in networks | The RPC provider receives the user's IP address and every request routed to it, including queried account/contract addresses, transaction data, and signed transactions submitted for broadcast. Select `Custom` or `Local` per network to replace it.                 |
| USD pricing               | [DefiLlama Coins API](https://defillama.com/docs/api)                | Every five minutes while relevant networks are connected, Wren sends native-asset and tracked token identifiers. It does not send the selected account address, although a token set can still be identifying. Pricing failure leaves the last local values unchanged. |
| Pinned Send content       | [IPFS.io](https://ipfs.io/)                                          | The gateway receives the user's IP address and the source-reviewed Send content CID. The complete downloaded directory is CID-verified before activation.                                                                                                              |
| Curated Earn display data | [Yearn Kong](https://kong.yearn.fi/)                                 | Wren requests the same fixed vault-list endpoint for every user. Account addresses, balances, and transaction details are not sent to Kong.                                                                                                                            |
| Token artwork             | CoinGecko's reviewed asset host                                      | CoinGecko receives an ordinary image request when recognized artwork is displayed. Arbitrary remote artwork is not loaded; untrusted or user-added hosts fall back to a local icon. Wren no longer routes images through the inherited Pylon proxy.                    |

Wren does not contact Pylon and does not send account addresses to an NFT
indexer. The inherited NFT inventory panel is disabled until an independent,
privacy-reviewed implementation exists. Explorers and external protocol pages
open only after a user action. Hardware-vendor transports, optional ABI source
lookups, updates, and other third-party boundaries are detailed in the
[Threat Model](THREAT_MODEL.md).

## IPFS Configuration

Wren downloads the embedded Send application from one source-reviewed,
content-addressed CID through `https://ipfs.io` by default. Set
`WREN_IPFS_GATEWAY_URL` to a different HTTPS gateway; loopback HTTP is accepted
for a self-hosted local gateway. Gateway responses, download time, JSON, and
archives are bounded.

To use Kubo RPC instead, set `WREN_IPFS_API_URL`. Set
`WREN_IPFS_AUTH_TOKEN` when that endpoint requires HTTP Basic authentication.
The historical `FRAME_IPFS_API_URL` and `NEBULA_AUTH_TOKEN` names remain
deprecated compatibility fallbacks only when API mode is explicitly configured.
Kubo RPC is an administrative interface: keep it on loopback, or protect a
remote endpoint with TLS, authentication, and a restricted proxy.

Wren does not follow mutable ENS updates for the built-in Send application.
Downloaded content is activated only after its complete UnixFS directory CID
matches the locally pinned manifest. User-added decentralized applications may
retain their explicitly requested resolution behavior.

## Security

Do not report wallet secrets or vulnerability details in a public issue. Follow
the private-reporting process in [Security Policy](SECURITY.md). The
[Threat Model](THREAT_MODEL.md) documents local RPC, renderer, persistence,
signer, network, and release boundaries.

Published Wren packages do not inherit support guarantees from the original
Frame maintainers. Only the newest Wren release is considered for security
fixes.

## Direction

The current release candidate contains the first curated Yearn Earn milestone
and local contacts; its exact scope and evidence boundaries are documented in
[Yearn Earn](YEARN_EARN.md). Near-term desktop work focuses on broader UI and
simulation qualification. Smart-account support and a future mobile client with
WalletConnect built around shared wallet-core logic remain later work. Roadmap
items are directional and are not release support claims.

## Documentation

- [Security Policy](SECURITY.md)
- [Threat Model](THREAT_MODEL.md)
- [Supported Ethereum Standards](SUPPORTED_EIPS.md)
- [RPC Compatibility](RPC_COMPATIBILITY.md)
- [Signer and Platform Support](HARDWARE_SUPPORT.md)
- [Yearn Earn](YEARN_EARN.md)
- [Linux Release Qualification](QUALIFICATION.md)
- [Release Procedure](RELEASE.md)

## Origin And License

This repository is a community-maintained continuation of the GPL-licensed
[Frame wallet](https://github.com/floating/frame) originally developed by Frame
Labs. It is not an official Frame Labs release and is not supported by the
original maintainers.

Wren is distributed under the [GNU General Public License v3.0](LICENSE).
Modified versions and binaries must continue to satisfy the GPL's source,
license, notice, and corresponding-source requirements.
