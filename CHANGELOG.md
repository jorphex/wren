# Changelog

Detailed release notes and platform boundaries live in
[`release-notes`](release-notes) and on the
[GitHub releases page](https://github.com/jorphex/wren/releases).

## 0.1.5 - 2026-08-31

### Added

- Made Activity rows open detailed, keyboard-accessible views with exact timing,
  transaction hashes, explorer actions, native amounts, recipients, bounded
  contract-call context, and truthful partial Wallet Calls evidence.
- Kept on-demand transaction action details available for the full 90-day
  Activity window through a private, bounded main-process reference ledger.

### Fixed

- Reworked the desktop and wallet interface around one consistent Perch hierarchy,
  including account selectors, Send and Sweep fields, request reviews, balances,
  Activity, navigation, empty states, spacing, and control alignment.
- Restored legacy Frame color palettes during profile migration and normalized
  mixed-case account keys without losing canonical account records.
- Kept Activity transaction references out of renderer state and profile backups;
  clearing Activity removes them with the visible history.
- Prevented unchanged retained transaction lifecycle evidence, including replacement
  observations, from recreating rows after Activity is cleared. A genuinely newer
  pending or terminal update may still appear.

### Distribution

- Kept Linux x64 as the qualified release target, Windows x64 explicitly unsigned,
  and macOS x64/arm64 explicitly ad-hoc-signed, unnotarized, and unqualified.
- Retained Wren Companion 0.1.2 and authenticated protocol 3 as the paired browser
  boundary. Chrome store distribution is available; Firefox store review is pending.

See [the complete 0.1.5 release notes](release-notes/v0.1.5.md).

## 0.1.4 - 2026-08-24

### Fixed

- Restored native and ERC-20 sends on Base, Base Sepolia, Optimism, Optimism
  Sepolia, Zora, and recognized legacy OP Stack networks by encoding refreshed L1
  data fees as canonical JSON-RPC quantities.
- Made initial approval await fresh OP Stack fee evidence and made retained
  funding failures genuinely recoverable. Recheck refreshes failed gas estimates
  and current network fees before repeating the final fail-closed funding check.
- Kept FIFO transaction review moving after submission. Queued transactions are
  inspectable but read-only while Wren monitors earlier transactions for
  confirmation or reorganization without duplicating completion activity.
- Kept retry feedback from moving the warning and action controls, and restored a
  continuous Wren background across the Send panel and Review Send action.
- Bounded compiler-version validation so malformed source-verification input
  cannot trigger excessive regular-expression work.

### Distribution

- Added exact-commit, source-attested Intel and Apple Silicon macOS previews.
  They are ad-hoc signed, unnotarized, have no Apple publisher identity, and are
  not physically qualified.
- Kept the Windows x64 installer explicitly unsigned and unqualified while the
  protected SignPath service is being provisioned.
- Made release SBOM identity portable across Linux, Windows, and macOS and
  consolidated qualified dependency updates.

See [the complete 0.1.4 release notes](release-notes/v0.1.4.md).

## Earlier releases

- [0.1.3](release-notes/v0.1.3.md)
- [0.1.2](release-notes/v0.1.2.md)
- [0.1.1](release-notes/v0.1.1.md)
- [0.1.0](release-notes/v0.1.0.md)
