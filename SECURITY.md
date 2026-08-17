# Security policy

Wren is wallet software. Signing, signer storage, local RPC, renderer isolation,
IPC, hardware transports, updates, and packaging are security-sensitive.

## Policy scope

Only the latest release published by
[`jorphex/wren`](https://github.com/jorphex/wren/releases) receives security
fixes. Wren has not had an independent security audit. Wren does not inherit
Frame Labs support guarantees.

For implementation boundaries and limitations, see
[`THREAT_MODEL.md`](THREAT_MODEL.md). See [`HARDWARE_SUPPORT.md`](HARDWARE_SUPPORT.md)
for physical-device claims. See [`SUPPORTED_EIPS.md`](SUPPORTED_EIPS.md) and
[`RPC_COMPATIBILITY.md`](RPC_COMPATIBILITY.md) for the standards and local-provider
surface. Wren Companion is released separately and has its own
[security boundary](https://github.com/jorphex/wren-companion/blob/main/SECURITY.md).

Frame-profile import is opt-in. It works only before the Wren destination exists.
It uses a private staging directory and a bounded allowlist. It never changes
the source profile. Close both applications and keep a verified backup until
you have checked the imported state.

## How to report a vulnerability

1. Do not put vulnerability details, proof-of-concept code, wallet data, seed
   phrases, private keys, or device secrets in a public issue.
2. Use the repository **Security** tab's **Report a vulnerability** flow.
3. If that flow is unavailable, open a public issue that requests only a private
   contact channel. Wait for a maintainer before sending technical details.

Include the following in the private report:

- affected commit or release;
- OS and install format;
- affected signer, transport, RPC method, or renderer;
- impact and reproducible steps using test-only accounts;
- whether local access or user approval is needed; and
- a proposed disclosure timeline.

Do not test against other people's accounts, devices, apps, or funds. Do not
broadcast a proof of concept unless you control every affected account and
asset.

## What to expect after a report

Wren is maintained by volunteers. No response-time guarantee is offered. When
practical, maintainers will acknowledge a private report, reproduce it, agree
on a disclosure plan, and publish a fix and advisory before public discussion.
