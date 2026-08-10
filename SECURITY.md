# Security Policy

Wren is wallet software. Signing, signer storage, local RPC, renderer isolation,
IPC, hardware transports, updates, and packaging are security-sensitive.

## Support and scope

Only the newest release published by
[`jorphex/wren`](https://github.com/jorphex/wren/releases) receives security
fixes. Wren has not had an independent security audit and does not inherit Frame
Labs support guarantees.

The implementation boundaries and limitations are in
[`THREAT_MODEL.md`](THREAT_MODEL.md). See [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md)
for physical-device claims and [`SUPPORTED_EIPS.md`](SUPPORTED_EIPS.md) and
[`RPC_COMPATIBILITY.md`](RPC_COMPATIBILITY.md) for the standards and local-provider
surface. Wren Companion is separately released and has its own
[security boundary](https://github.com/jorphex/wren-companion/blob/main/SECURITY.md).

Frame-profile import is opt-in, only works before the Wren destination exists,
uses a private staging directory and bounded allowlist, and never changes the
source profile. Close both applications and keep a verified backup until the
imported state has been checked.

## Report a vulnerability

Do not put vulnerability details, proof-of-concept code, wallet data, seed
phrases, private keys, or device secrets in a public issue. Use the repository
**Security** tab's **Report a vulnerability** flow. If it is unavailable, open a
public issue requesting only a private contact channel, then wait for a
maintainer before sending technical details.

Include the affected commit or release, OS and install format, affected signer,
transport, RPC method, or renderer, impact and reproducible steps with test-only
accounts, whether local access or user approval is needed, and a proposed
disclosure timeline. Do not test against other people's accounts, devices, apps,
or funds, and do not broadcast a proof of concept unless you control every
affected account and asset.

## What to expect

This is volunteer maintained; no response-time guarantee is offered. When
practical, maintainers will acknowledge a private report, reproduce it, agree a
disclosure plan, and publish a fix and advisory before public discussion.
