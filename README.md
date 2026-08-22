<p align="center">
  <img src="asset/brand/exports/app/wren-app-icon-512.png" alt="Wren" width="150" />
</p>

<h1 align="center">Wren</h1>

<p align="center">A desktop EVM wallet for reviewing and signing requests from browsers and native apps.</p>

<p align="center">
  <a href="https://github.com/jorphex/wren/releases">Desktop releases</a> ·
  <a href="https://github.com/jorphex/wren-companion/releases">Browser companion</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="SUPPORTED_EIPS.md">Standards</a> ·
  <a href="RPC_COMPATIBILITY.md">RPC compatibility</a>
</p>

> [!NOTE]
> Wren has not had an independent security audit. Linux x64 is the qualified release target; Windows x64 is an unsigned preview. Keep a backup, verify release checksums, and start with a test account or small amount.

Wren provides one approval and signing interface to browser dapps and native applications. Dapps connect through the paired browser companion or Wren's local EIP-1193/JSON-RPC provider. Each origin has its own account permission and chain route; there is no shared global network selection.

## Choose a path

- New users: start with [Install Wren 0.1.3](#install-wren-013) or [Run from source](#run-from-source).
- Developers: read [RPC Compatibility](RPC_COMPATIBILITY.md) for the local provider and authenticated protocol.
- Release operators: follow the [Release Procedure](RELEASE.md), then the [qualification checklist](QUALIFICATION.md).
- Hardware users: check the [Signer and Platform Support reference](HARDWARE_SUPPORT.md) before testing a device.
- Software-signer users: read [OS-backed device protection](OS_SIGNER_PROTECTION.md) before binding signer files to a credential store.

## Current status

This table describes the `0.1.3` release candidate. The
[Signer and Platform Support reference](HARDWARE_SUPPORT.md) owns detailed
evidence and limitations.

Wren `0.1.3` is designed to pair with Wren Companion `0.1.2` over protocol 3.
Browser store publication is a separate process. Release operators should use the
[Release Procedure](RELEASE.md); the manual gate is in the
[qualification checklist](QUALIFICATION.md).

| Area                         | Current boundary                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Linux x64 AppImage and deb   | Release candidate qualified; publication pending                                          |
| Windows x64                  | Unsigned preview; native package checks pass and final VM qualification is required       |
| Trezor Safe 7 over USB       | Physically tested for address display, signing, broadcast, and reconnect                  |
| Trezor Model One over USB    | Physically tested, with typed-data and testnet limitations                                |
| Ledger and GridPlus Lattice1 | Implemented and automatically tested; not physically requalified for `0.1.3`              |
| Software signers             | Encrypted local seed, private-key, and keystore workers; disposable seed/key flows tested |
| Watch-only accounts          | Monitoring only; signing is blocked                                                       |
| Chrome and Firefox companion | Companion 0.1.2 pairing target; archive and browser-store publication pending             |
| macOS and Linux arm64        | Unsigned native CI smoke packages; not released or qualified                              |
| Trezor Safe 7 Bluetooth      | Unsupported                                                                               |

See [Signer and Platform Support](HARDWARE_SUPPORT.md) for evidence and limitations. Trezor Suite is not needed for the qualified Safe 7 USB flow.

## What Wren does

- Hosts browser-compatible HTTP and WebSocket JSON-RPC on localhost and authenticated protocol-3 routes for originless native clients. See [RPC Compatibility](RPC_COMPATIBILITY.md) for the exact protocol boundary.
- Creates encrypted local accounts with either a new 12-word recovery phrase or
  a new Ethereum private key. Wren uses the operating system's secure random
  generator, shows the secret once for backup, and requires password and backup
  confirmation.
- Keeps hardware, software, and watch-only accounts behind signer and permission checks.
- Reviews transactions and signatures: calldata, approvals, configured-RPC simulation, selected trace evidence, EIP-712, permits, Permit2, SIWE, and dangerous `eth_sign` consent. Simulation is evidence, not a guarantee.
- Includes a dashboard-only read-only inspector for bounded unsigned transactions,
  calldata context, EIP-712, and supported JSON-RPC intent wrappers. It decodes
  locally, uses only the configured RPC for optional simulation, and cannot sign,
  queue, forward, or broadcast the pasted request.
- Includes a dashboard-only prepared contract deployment tool. It accepts complete
  EVM deployment data—creation bytecode with encoded constructor arguments—and an optional
  native value. Preparation sends the selected account context, deployment data, and
  value only to the configured RPC for gas, simulation, and pending-nonce evidence;
  queueing then enters Wren's ordinary native review, signer, and single-broadcast
  lifecycle. Wren does not compile Solidity or Vyper in the deployment tool.
- Verifies source for a confirmed Wren deployment or an existing contract from
  Control Center Tools. Wren reads bounded Solidity/Vyper standard JSON or
  Foundry/Hardhat build-info locally, binds it to the exact chain, address, and
  deployed runtime code, and publishes only after clear confirmation that the
  source will become public. Wren cannot withdraw published source. Sourcify is
  the keyless primary destination; direct Etherscan V2 is a
  manual supported-chain fallback using an OS-protected user API key and an
  explicit encoded-constructor-arguments value (or confirmation that there are none).
- Provides finite account-, method-, and chain-scoped permissions; a separate
  network route for each app; add/switch-chain flows; and sequential EIP-5792
  wallet calls that are not all-or-nothing.
- Lets users add optional local per-dapp, per-account, per-chain guardrails for
  destinations, approval spenders, native/token amounts, and expiry. Guardrails block
  or require an extra warning acknowledgement; normal request review still applies.
- Stores local contacts with user-attested Saved or Verified out-of-band provenance,
  keeps the full address visible during review, and offers an explicit Save contact
  action after confirmation. An off-by-default local Recent recipients option can
  remember confirmed Wren Send and managed Sweep destinations; it is bounded,
  clearable, and excluded from backups.
- Provides a fresh, recipient-bound native Max quote and an explicit multi-asset Sweep.
  Sweep reads selected ERC-20 balances from the configured RPC, places native value
  last, and uses Wren's ordinary sequential Wallet Call review; it is never atomic.
- Supports a local, allowlisted Yearn Earn catalog on Ethereum, Base, and Katana. See [Yearn Earn](YEARN_EARN.md) for the exact products, workflows, and evidence.
- Lets users choose EVM RPC and Kubo IPFS endpoints.

The precise method and standard boundaries are in [RPC Compatibility](RPC_COMPATIBILITY.md), [Supported Ethereum Standards](SUPPORTED_EIPS.md), and [Advanced Execution](EXECUTION_BOUNDARIES.md).

## Install Wren 0.1.3

Download the package for your system and `SHA256SUMS` from the
[desktop releases page](https://github.com/jorphex/wren/releases).

### Linux x64

For `Wren-0.1.3.AppImage` or `wren_0.1.3_amd64.deb`, run:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

Run the AppImage:

```bash
chmod +x Wren-0.1.3.AppImage
./Wren-0.1.3.AppImage
```

Or install the deb:

```bash
sudo apt install ./wren_0.1.3_amd64.deb
```

Linux packages are unsigned. Verify the checksum and GitHub artifact attestation
before installing.

### Windows x64 preview

`Wren-Setup-0.1.3-unsigned-x64.exe` is an unsigned preview. Windows will report
its publisher as unknown and may show SmartScreen. Download it only from Wren's
GitHub release, then verify it in PowerShell:

```powershell
$Installer = Get-Item '.\Wren-Setup-0.1.3-unsigned-x64.exe'
$Expected = (Get-Content '.\SHA256SUMS' | Where-Object { $_ -like "*  $($Installer.Name)" }).Split()[0]
$Actual = (Get-FileHash -Algorithm SHA256 $Installer).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) { throw 'Checksum does not match' }
(Get-AuthenticodeSignature $Installer).Status # Expected: NotSigned
```

The installer is intentionally one-click: it installs for the current user and
opens Wren without a setup wizard. A warning may not appear on every Windows
system. Checksums and GitHub attestations confirm release-file integrity, but
they do not create a trusted Windows publisher. See the
[Windows preview checklist](WINDOWS_RELEASE_QUALIFICATION.md) for the tested
boundary.

### Import a Frame profile

Wren does not read or share Frame's live profile by default. To make a one-time private copy, close both apps, back up `~/.config/frame`, and run the import before Wren creates `~/.config/wren`:

```bash
./Wren-0.1.3.AppImage --import-frame-profile
```

For an installed deb, run `/opt/Wren/wren --import-frame-profile`. Wren validates and copies only `config.json` and encrypted signer files through a private staging directory, then atomically installs the profile. It rejects an active Frame profile, links, malformed or oversized data, and an existing Wren profile. Frame remains unchanged; verify the import before deleting either profile.

### Browser companion

The companion injects Wren's EIP-1193 provider and announces it through EIP-6963. Download the Chrome or Firefox archive from its [releases page](https://github.com/jorphex/wren-companion/releases), verify its checksum, extract it, then follow the [companion installation instructions](https://github.com/jorphex/wren-companion#install).

Compare the six-digit pairing code shown in Wren and the extension before approving. Use Companion 0.1.2; older versions lack fixes qualified with this release.

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

## Developer protocol (local provider)

Wren listens only on loopback:

```text
http://127.0.0.1:1248
ws://127.0.0.1:1248
```

Browser-compatible clients send root-route JSON-RPC with a canonical web or extension `Origin`. Originless native clients must pair and sign requests through protocol 3. Clients can specify an enabled EVM chain using Wren's request metadata. Localhost is not a local-process identity boundary: method permissions, subscriptions, origins, limits, and the trust model are documented in [RPC Compatibility](RPC_COMPATIBILITY.md).

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

## Security

Report vulnerabilities privately through [Security Policy](SECURITY.md), not a public issue. The [Threat Model](THREAT_MODEL.md) covers local RPC, renderers, persistence, signers, network, and release boundaries. The [OS-backed software-signer device-protection guide](OS_SIGNER_PROTECTION.md) explains its Linux keychain, Windows DPAPI, and portable-recovery behavior. Only the newest Wren release is considered for security fixes; Wren packages have no support guarantee from the original Frame maintainers.

## Roadmap and license

Wren `0.1.3` includes local contacts, curated Earn, secure local wallet creation, prepared contract deployment, and source verification. [Smart accounts](SMART_ACCOUNTS.md), mobile, and WalletConnect are future direction, not support claims.

Wren is a community-maintained continuation of the GPL-licensed [Frame wallet](https://github.com/floating/frame), not a Frame Labs release. It is distributed under the [GNU GPL v3.0](LICENSE).
