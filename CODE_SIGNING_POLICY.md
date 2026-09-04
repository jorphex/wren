# Code signing policy

Wren signs Windows release packages only from reviewed source in the public
[`jorphex/wren`](https://github.com/jorphex/wren) repository. A release request
must come from Wren's GitHub Actions release workflow, match an immutable release
tag, pass the documented release gates, and receive manual approval.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## Roles

- Committer and reviewer: [`@jorphex`](https://github.com/jorphex)
- Release signing approver: [`@jorphex`](https://github.com/jorphex)

Contributions from anyone without commit access require review before merge.
Signed release requests use the separate approval step required by SignPath.

## Privacy

Wren's network behavior and third-party services are described in
[Network data and privacy](README.md#network-data-and-privacy). Wren has no
first-party hosted backend and does not collect telemetry. User-requested RPC,
pricing, IPFS, protocol-data, and artwork operations can contact the services
listed there.

## Current release boundary

The Wren 0.1.7 Windows preview is explicitly unsigned while the SignPath
Foundation service is being provisioned. Release notes and filenames state the
signature status. Wren will not claim a trusted publisher until the protected
signing workflow is approved and qualified.
