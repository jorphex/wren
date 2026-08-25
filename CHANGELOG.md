# Changelog

Detailed release notes and platform boundaries live in
[`release-notes`](release-notes) and on the
[GitHub releases page](https://github.com/jorphex/wren/releases).

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
