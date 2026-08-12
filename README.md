<p align="center">
  <img src="asset/png/WrenLogo512.png" alt="Wren" width="150" />
</p>

<h1 align="center">Wren</h1>

<p align="center">A desktop EVM wallet and signing firewall for browsers, native apps, and command-line tools.</p>

<p align="center">
  <a href="https://github.com/jorphex/wren/releases">Desktop releases</a> ·
  <a href="https://github.com/jorphex/wren-companion/releases">Browser companion</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="SUPPORTED_EIPS.md">Standards</a> ·
  <a href="RPC_COMPATIBILITY.md">RPC compatibility</a>
</p>

> [!WARNING]
> Wren is preview wallet software and has no independent security audit. Its current release target is Linux x64. Back up your profile, verify release checksums, and use test accounts before trusting a release with valuable assets. Use at your own risk.

Wren provides one approval and signing interface to browser dapps, native applications, and CLI tools. Dapps connect through the paired browser companion or Wren's local EIP-1193/JSON-RPC provider. Each origin has its own account permission and chain route; there is no shared global network selection.

## Release status

Wren `0.1.0` and Wren Companion `0.1.0` are release candidates. They are not published releases until the relevant release page has the matching artifacts, checksums, and source-bound metadata.

| Area                         | Current boundary                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Linux x64 AppImage and deb   | Release candidate; Wren-branded qualification pending                                     |
| Trezor Safe 7 over USB       | Physically tested for address display, signing, broadcast, and reconnect                  |
| Trezor Model One over USB    | Physically tested, with typed-data and testnet limitations                                |
| Ledger and GridPlus Lattice1 | Implemented and automatically tested; not physically requalified for `0.1.0`              |
| Software signers             | Encrypted local seed, private-key, and keystore workers; disposable seed/key flows tested |
| Watch-only accounts          | Monitoring only; signing is blocked                                                       |
| Chrome and Firefox companion | Separate `0.1.0` candidate; release-gated qualification remains                           |
| macOS, Windows, Linux arm64  | Unsigned native CI smoke packages; not released or qualified                              |
| Trezor Safe 7 Bluetooth      | Unsupported                                                                               |

See [Signer and Platform Support](HARDWARE_SUPPORT.md) for evidence and limitations. Trezor Suite is not needed for the qualified Safe 7 USB flow.

## What Wren does

- Hosts HTTP and WebSocket JSON-RPC on localhost for browser, native, and CLI clients.
- Keeps hardware, software, and watch-only accounts behind signer and permission checks.
- Reviews transactions and signatures: calldata, approvals, configured-RPC simulation, selected trace evidence, EIP-712, permits, Permit2, SIWE, and dangerous `eth_sign` consent. Simulation is evidence, not a guarantee.
- Provides finite account/method/chain-scoped permissions, per-invoker chain routing, add/switch-chain flows, and non-atomic EIP-5792 wallet calls.
- Stores local contacts and shows saved names during review without changing the signed payload.
- Supports a local, allowlisted Yearn Earn catalog on Ethereum, Base, and Katana. See [Yearn Earn](YEARN_EARN.md) for the exact products, workflows, and evidence.
- Lets users choose EVM RPC and Kubo IPFS endpoints.

The precise method and standard boundaries are in [RPC Compatibility](RPC_COMPATIBILITY.md) and [Supported Ethereum Standards](SUPPORTED_EIPS.md).

## Install when `v0.1.0` is published

`v0.1.0` is not yet available to download. When it is published, get `Wren-0.1.0.AppImage` or `wren_0.1.0_amd64.deb` and `SHA256SUMS` from the [desktop releases page](https://github.com/jorphex/wren/releases). From the download directory:

```bash
sha256sum --check SHA256SUMS
```

Run the AppImage:

```bash
chmod +x Wren-0.1.0.AppImage
./Wren-0.1.0.AppImage
```

Or install the deb:

```bash
sudo apt install ./wren_0.1.0_amd64.deb
```

Linux packages are currently unsigned. Verify checksums and GitHub artifact attestations before installing.

### Import a Frame profile

Wren does not read or share Frame's live profile by default. To make a one-time private copy, close both apps, back up `~/.config/frame`, and run the import before Wren creates `~/.config/wren`:

```bash
./Wren-0.1.0.AppImage --import-frame-profile
```

For an installed deb, run `/opt/Wren/wren --import-frame-profile`. Wren validates and copies only `config.json` and encrypted signer files through a private staging directory, then atomically installs the profile. It rejects an active Frame profile, links, malformed or oversized data, and an existing Wren profile. Frame remains unchanged; verify the import before deleting either profile.

### Browser companion

The companion injects Wren's EIP-1193 provider and announces it through EIP-6963. When the Companion candidate is published, download the Chrome or Firefox archive from its [releases page](https://github.com/jorphex/wren-companion/releases), verify its checksum, extract it, then follow the [companion installation instructions](https://github.com/jorphex/wren-companion#install).

Compare the six-digit pairing code shown in Wren and the extension before approving. Older store extensions do not implement this desktop release's authenticated protocol.

## Run from source

The repository pins Node and npm. On Ubuntu or Debian, install the native build requirements:

```bash
sudo apt-get update
sudo apt-get install build-essential libudev-dev
```

Then install the pinned toolchain and build:

```bash
git clone https://github.com/jorphex/wren.git
cd wren
nvm install
nvm use
npm install --global npm@11.12.0
npm run setup:ci
npm run prod
```

`npm run setup:ci` uses the lockfile, allows reviewed dependency scripts, installs Electron, and rebuilds the HID module. To create local Linux packages:

```bash
npm run compile
npm run bundle
npm run package:linux:x64
npm run package:verify:linux
```

A successful local package build is not release qualification; follow [Release Procedure](RELEASE.md).

## Local provider

Wren listens only on loopback:

```text
http://127.0.0.1:1248
ws://127.0.0.1:1248
```

Clients can send JSON-RPC requests and specify an enabled EVM chain using Wren's request metadata. Localhost is not a local-process identity boundary: method permissions, subscriptions, origins, limits, and the trust model are documented in [RPC Compatibility](RPC_COMPATIBILITY.md).

## Network data and privacy

Wren has no first-party hosted backend. Its defaults are explicit and replaceable.

| Purpose             | Default                                                    | Data sent                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EVM RPC             | [PublicNode](https://publicnode.com/) on built-in networks | IP address and each request, including queried addresses, calldata, and submitted signed transactions. Choose `Custom` or `Local` per network to replace it. |
| USD pricing         | [DefiLlama Coins API](https://defillama.com/docs/api)      | Relevant native/token identifiers every five minutes while networks are connected; not the selected address, though a token set can identify a user.         |
| Pinned Send content | [IPFS.io](https://ipfs.io/)                                | IP address and the reviewed Send CID; Wren verifies the downloaded directory CID before activation.                                                          |
| Curated Earn data   | [Yearn Kong](https://kong.yearn.fi/)                       | The same fixed vault-list request for every user, not account addresses, balances, or transaction details.                                                   |
| Token artwork       | CoinGecko's reviewed asset host                            | An ordinary image request for recognized artwork. Arbitrary remote artwork is not loaded.                                                                    |

Wren does not contact Pylon or send account addresses to an NFT indexer; the inherited NFT panel is disabled. Explorers and protocol sites open only after user action. See [Threat Model](THREAT_MODEL.md) for other third-party boundaries.

## IPFS configuration

The embedded Send app uses a reviewed CID through `https://ipfs.io` by default. Set `WREN_IPFS_GATEWAY_URL` to another HTTPS gateway; loopback HTTP is allowed for a local gateway. Responses, time, JSON, and archives are bounded.

To use Kubo RPC, set `WREN_IPFS_API_URL`; set `WREN_IPFS_AUTH_TOKEN` for HTTP Basic authentication. `FRAME_IPFS_API_URL` and `NEBULA_AUTH_TOKEN` remain deprecated fallbacks only when API mode is configured. Kubo RPC is administrative: keep it on loopback or secure a remote endpoint with TLS, authentication, and a restricted proxy.

Wren does not follow mutable ENS for the built-in Send app. It activates downloaded content only when the complete UnixFS directory CID matches the pinned manifest.

## Security, roadmap, and license

Report vulnerabilities privately through [Security Policy](SECURITY.md), not a public issue. The [Threat Model](THREAT_MODEL.md) covers local RPC, renderers, persistence, signers, network, and release boundaries. Only the newest Wren release is considered for security fixes; Wren packages have no support guarantee from the original Frame maintainers.

The current candidate includes local contacts and the first curated Earn milestone. [Smart accounts](SMART_ACCOUNTS.md), mobile, and WalletConnect are future direction, not support claims.

Wren is a community-maintained continuation of the GPL-licensed [Frame wallet](https://github.com/floating/frame), not a Frame Labs release. It is distributed under the [GNU GPL v3.0](LICENSE).
