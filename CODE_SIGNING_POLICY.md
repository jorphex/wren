# Code signing policy

Windows release signing requires reviewed source in the public
[`jorphex/wren`](https://github.com/jorphex/wren) repository. Requests must come
from Wren's release workflow, match an immutable release tag, pass release checks
and receive manual approval.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## Roles

- Committer and reviewer: [`@jorphex`](https://github.com/jorphex)
- Release signing approver: [`@jorphex`](https://github.com/jorphex)

Contributions from anyone without commit access require review before merge.
Signed release requests use the separate approval step required by SignPath.

## Privacy

See [Privacy](README.md#privacy) for network services and shared data. Wren has no
first-party hosted backend and does not collect telemetry. User-requested RPC,
pricing, IPFS, protocol-data, and artwork operations can contact the services
listed there.

## Current release boundary

Current Windows previews are unsigned. Release notes and filenames state the
signature status. Publisher signing needs an approved workflow and completed
qualification.
