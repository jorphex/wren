# Yearn Earn

## Status

The current `main` branch contains the first Yearn Earn milestone. It has unit,
integration, component, production-bundle, and isolated virtual-display Electron
coverage plus manual Linux-package testing of a Base deposit, partial and full
withdrawals, and physical Trezor signing. It is included in the Wren `0.1.0`
candidate; the earlier published Frame-derived `0.7.0` release did not include
Earn.

Earn is a focused Yearn integration, not a general DeFi marketplace. Wren owns
the catalog and transaction boundary. Yearn Kong supplies current metadata but
cannot promote an address, change calldata, or select a transaction target.

## Curated Products

| Chain    | Product                    | Vault                                        |
| -------- | -------------------------- | -------------------------------------------- |
| Ethereum | yvUSD, flexible and locked | `0x696d02Db93291651ED510704c9b286841d506987` |
| Ethereum | USDS-1 yVault              | `0x182863131F9a4630fF9E27830d945B1413e347E8` |
| Ethereum | WETH-1 yVault              | `0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0` |
| Ethereum | Staked yBOLD               | `0x9F4330700a36B29952869fac9b33f45EEdd8A3d8` |
| Base     | USDC Horizon yVault        | `0xc3BD0A2193c8F027B82ddE3611D18589ef3f62a9` |
| Katana   | vbUSDC yVault              | `0x80c34BD3A3569E126e7055831036aa7b212cB159` |
| Katana   | vbETH yVault               | `0xE007CA01894c863d7898045ed5A3B4Abf0b18f37` |
| Katana   | vbUSDT yVault              | `0x9A6bd7B6Fd5C4F87eb66356441502fc7dCdd185B` |

The catalog intentionally excludes Yearn single-strategy vaults and lower-priority
alternatives. Base exposes only the Horizon USDC product, which Wren labels as
higher risk. Katana accepts only the listed Vault Bridge assets; Earn does not
swap, bridge, wrap, or acquire them.

### Pinned Transaction Policy

Wren pins the token scale and transaction addresses below in source. Kong
cannot change them.

| Product       | Exact input asset                                   | Decimals | Additional trusted route                                                                               |
| ------------- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| yvUSD         | USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`   | 6        | Locked `0xAaaFEa48472f77563961Cdb53291DEDfB46F9040`; zap `0x7ba61c8e19414dcB8fe769a7Be63B508C8062bbA`  |
| USDS-1        | USDS `0xdC035D45d973E3EC169d2276DDab16f1e407384F`   | 18       | None                                                                                                   |
| WETH-1        | WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`   | 18       | None                                                                                                   |
| Staked yBOLD  | BOLD `0x6440f144b7e50D6a8439336510312d2F54beB01D`   | 18       | ysyBOLD `0x23346B04a7f55b8760E5860AA5A77383D63491cD`; zap `0xe7099092533a3fb693bb123cd96b8e53b4d83c58` |
| Base Horizon  | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`   | 6        | None                                                                                                   |
| Katana vbUSDC | vbUSDC `0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36` | 6        | None                                                                                                   |
| Katana vbETH  | vbETH `0xEE7D8BCFb72bC1880D0Cf19822eB0A2e6577aB62`  | 18       | None                                                                                                   |
| Katana vbUSDT | vbUSDT `0x2DCa96907fde857dd3D816880A0df407eeB2D2F2` | 6        | None                                                                                                   |

## Data And Availability

- Kong REST metadata is validated against the local catalog, allocator policy,
  Yearn inclusion/highlight status, chain, vault and asset addresses, and pinned
  decimals. Vault/asset relationships and decimal scales are rechecked on-chain
  before every queued step.
- Cards use Yearn's forward estimate under `Est. APY`. A historical fallback is
  labeled `Historical APY`; missing yield is `Unavailable`, never `0%`.
- `All` renders separate Ethereum, Base, and Katana sections. A failed chain read
  cannot erase another chain's catalog or positions.
- Fresh eligible metadata is required for deposits. Cached, retired, hidden, or
  failed data is withdraw-only when Wren can identify an existing position.
- Positions and underlying balances are read for the selected account. Watch-only
  accounts can inspect them but cannot create a transaction.
- Curated underlying, vault-share, and companion-share contracts are also hidden
  balance-scanner defaults. A real nonzero ERC-20 balance appears in Wren's
  normal balances and Send token picker without becoming a custom token; zero
  balances are not fabricated, and remote token-list omit metadata cannot
  suppress these locally pinned entries. Cooldown-only yvUSD accounting remains
  an Earn position rather than a transferable token balance.
- APY, TVL, risk labels, and simulations are third-party or configured-RPC
  evidence, not guarantees of return, liquidity, execution, or contract safety.

## Transaction Flows

Every step is created in the main process and enters Wren's normal account
request, configured-RPC simulation, approval, signer, broadcast, monitor, and
receipt path. Earn never silently changes a dapp's chain assignment.

### Direct Vaults

Deposits accept only the vault's exact underlying asset. Wren reuses an existing
allowance only when it exactly equals the requested amount. Otherwise it resets a
nonzero allowance to zero and requests a new exact approval before `deposit`.

Partial withdrawals use ERC-4626 `withdraw` with an underlying-asset amount. Max
uses `redeem` with the complete on-chain share balance to avoid share dust.

### yvUSD

Flexible yvUSD is a direct USDC ERC-4626 flow. Locked yvUSD deposits USDC through
the pinned Yearn zap `0x7ba61c8e19414dcB8fe769a7Be63B508C8062bbA`
into locked vault `0xAaaFEa48472f77563961Cdb53291DEDfB46F9040`.

Wren reads the locked vault's current cooldown duration, withdrawal window, and
account status. The user explicitly starts or cancels cooldown. During the active
window, Wren exits the locked vault to yvUSD and then exits yvUSD to USDC. Exact
exits use two `withdraw` calls; Max exits use two `redeem` calls. The workflow
persists between those separately reviewed transactions and across restart.

### yBOLD

New BOLD deposits finish staked as ysyBOLD through pinned Yearn zap
`0xe7099092533a3fb693bb123cd96b8e53b4d83c58` and staking vault
`0x23346B04a7f55b8760E5860AA5A77383D63491cD`. Existing unstaked
yBOLD remains visible with a separate Stake action. Exits return BOLD through the
pinned zap.

The yBOLD exit always submits `maxLoss = 0`. Wren does not expose a persistent
loss-tolerance or swap-slippage setting and will not silently increase this value.
A withdrawal that requires realized loss must be handled outside this milestone.

## Persistence And Review

- At most 64 bounded workflows are persisted. Only one step is queued at a time;
  the next step requires an explicit Resume after a successful matching receipt.
- Persisted target, chain, receiver/owner, amount, action, approval token, and
  spender are re-recognized against the current curated vault before queueing.
- A rejected unsubmitted step can be retried. A submitted transaction is never
  blindly retried. Receipt monitoring survives restart once a hash is recorded.
  If Wren restarts while a request is awaiting review and cannot prove whether
  it was broadcast, the workflow is canceled and cannot be resumed; verify the
  account on-chain before starting a replacement.
- An interrupted approval cleanup first offers a read-only allowance recheck. If
  the allowance remains nonzero, Wren requires a separate Revoke again action
  after warning the user to verify that no prior request is pending. It never
  converts the unknown outcome directly into another transaction.
- Cancel and approval cleanup are blocked while a request is awaiting review or
  confirmation. If an exact approval was confirmed but its operation did not
  complete, Wren offers one separately reviewed zero-allowance cleanup and
  prevents the parent operation from being resumed in parallel.
- Yearn review labels come from allowlist-bound calldata recognition. Any chain,
  target, native value, receiver, owner, token-spender relationship, unsupported
  action, or zero-loss mismatch falls back to generic contract-call review.
  Amounts are decoded and displayed from calldata; a persisted workflow whose
  amount no longer matches its main-process record is rejected before queueing.
- Workflow receipts show each verified step, bounded account inflows/outflows
  derived from allowlisted ERC-20 Transfer logs when available, and its
  chain-correct explorer link. Missing event evidence is never replaced with a
  renderer-supplied amount.
- Persisted workflows carry a local policy version. State migrations discard
  workflows created before the current policy rather than interpreting old
  amounts or routes under newer trust rules.
- Native success notifications retain Wren's privacy-preserving generic hash
  copy rather than exposing account balances or Earn amounts.

## Verification Boundary

Automated coverage includes catalog admission and cache failures, chain-isolated
positions, cooldown state, direct/yvUSD/yBOLD calldata, exact approvals, workflow
transitions and restart recovery, renderer/main IPC bounds, provider admission,
Yearn recognition, review summaries, and Earn interactions. An isolated Xvfb
Electron run at the milestone commit rendered all chain sections and yvUSD details
from live Kong data with no renderer exception.

Manual Linux-package evidence additionally covers a Base yvUSDC-H deposit,
partial withdrawal, Max redeem without share dust, and physical Trezor review.
It does not qualify contract economics, every curated product on every signer,
or configured RPC correctness beyond the exercised flows. The exact release
candidate and remaining signer limitations are recorded through
[Linux Release Qualification](QUALIFICATION.md); do not generalize a tested row
to an untested product, chain, or signer.
