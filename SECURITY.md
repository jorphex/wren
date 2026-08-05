# Security Policy

Wren is wallet software. Treat every change to signing, persisted state, local
RPC, renderer isolation, IPC, hardware transports, updates, and packaging as
security-sensitive.

## Supported Versions

Only the newest release published by
[`jorphex/wren`](https://github.com/jorphex/wren/releases) is considered for
security fixes. Wren has not received an independent security
audit and does not inherit support guarantees from Frame Labs.

## Reporting A Vulnerability

Do not include vulnerability details, proof-of-concept code, wallet data, seed
phrases, private keys, or device secrets in a public issue.

Use the repository's **Security** tab and choose **Report a vulnerability**. If
that option is unavailable, open a public issue containing only a request for a
private contact channel. Wait for a maintainer response before sharing technical
details.

Include, when available:

- the affected commit or release;
- the operating system and installation format;
- the affected signer, transport, RPC method, or renderer;
- impact and reproducible steps using test-only accounts;
- whether exploitation requires local access or user approval; and
- a proposed disclosure timeline.

Never test a report using another person's accounts, devices, applications, or
funds. Do not broadcast a proof-of-concept transaction to a public network unless
you control every affected account and asset.

## Response Expectations

This is a volunteer-maintained fork, so no response-time guarantee is offered.
Maintainers should acknowledge a private report, reproduce it, agree on a
disclosure plan, and publish a fixed release and advisory before discussing the
details publicly when practical.

## Security Scope

The current trust boundaries and known limitations are documented in
[`THREAT_MODEL.md`](THREAT_MODEL.md). Hardware and platform claims are documented
in [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md). Standards and local-provider
claims are bounded by [`SUPPORTED_EIPS.md`](SUPPORTED_EIPS.md) and
[`RPC_COMPATIBILITY.md`](RPC_COMPATIBILITY.md).
The separately released browser transport has its own
[security boundary](https://github.com/jorphex/wren-companion/blob/main/SECURITY.md).
