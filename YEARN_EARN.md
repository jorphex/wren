# Yearn Earn

For people using Wren's curated Yearn integration.

Earn is a focused, allowlisted integration, not a general DeFi marketplace. Wren owns the catalog and transaction boundary. Yearn Kong provides current metadata but cannot add an address, choose a target, or change calldata. Earn is in the Wren `0.1.0` candidate; the published Frame-derived `0.7.0` release did not include it.

The milestone has unit, integration, component, production-bundle, and isolated virtual-display Electron coverage. Manual Linux-package evidence covers a Base deposit, partial/full withdrawal, and physical Trezor signing. That does not qualify contract economics, every product/signer combination, or configured-RPC correctness outside those flows.

## Curated products

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

The catalog excludes Yearn single-strategy vaults and lower-priority alternatives. Base offers only the higher-risk Horizon USDC product. Katana accepts only these Vault Bridge assets; Earn does not swap, bridge, wrap, or acquire them.

### Pinned assets and routes

Wren pins the following scales and transaction addresses in source. Kong cannot alter them.

| Product       | Exact input asset                                   | Decimals | Additional pinned route                                                                                |
| ------------- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| yvUSD         | USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`   | 6        | Locked `0xAaaFEa48472f77563961Cdb53291DEDfB46F9040`; zap `0x7ba61c8e19414dcB8fe769a7Be63B508C8062bbA`  |
| USDS-1        | USDS `0xdC035D45d973E3EC169d2276DDab16f1e407384F`   | 18       | None                                                                                                   |
| WETH-1        | WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`   | 18       | None                                                                                                   |
| Staked yBOLD  | BOLD `0x6440f144b7e50D6a8439336510312d2F54beB01D`   | 18       | ysyBOLD `0x23346B04a7f55b8760E5860AA5A77383D63491cD`; zap `0xe7099092533a3fb693bb123cd96b8e53b4d83c58` |
| Base Horizon  | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`   | 6        | None                                                                                                   |
| Katana vbUSDC | vbUSDC `0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36` | 6        | None                                                                                                   |
| Katana vbETH  | vbETH `0xEE7D8BCFb72bC1880D0Cf19822eB0A2e6577aB62`  | 18       | None                                                                                                   |
| Katana vbUSDT | vbUSDT `0x2DCa96907fde857dd3D816880A0df407eeB2D2F2` | 6        | None                                                                                                   |

## Data, balances, and availability

- Kong data must match the local catalog, allocator policy, Yearn inclusion/highlight status, chain, vault/asset addresses, and pinned decimals. Wren rechecks asset/vault relationships and decimals on-chain before each queued step.
- Cards label Yearn's forward estimate `Est. APY`; historical fallback is `Historical APY`; missing yield is `Unavailable`, never `0%`. APY, TVL, labels, and simulation are third-party/configured-RPC evidence, not guarantees of return, liquidity, execution, or safety.
- `All` separates Ethereum, Base, and Katana; failure on one chain cannot erase another chain's products or positions. Deposits require fresh eligible metadata. Cached, retired, hidden, or failed data is withdraw-only when Wren recognizes an existing position.
- Wren reads positions and underlying balances for the selected account. Watch-only accounts can inspect but cannot transact.
- Curated assets, shares, and companion shares are hidden scanner defaults. A genuine nonzero ERC-20 balance appears in normal balances and Send without becoming a custom token; no zero balance is fabricated and remote omit metadata cannot suppress a locally pinned entry. Cooldown-only yvUSD remains an Earn position, not a transferable token balance.

## Transactions

Every step is made in the main process and follows Wren's normal request, configured-RPC simulation, approval, signer, broadcast, monitor, and receipt path. Earn never changes a dapp's chain route.

**Direct vaults.** Deposits accept only the exact underlying asset. Wren reuses an allowance only when it exactly equals the requested amount; otherwise it resets a nonzero allowance to zero and requests a new exact approval. Partial withdrawals use ERC-4626 `withdraw`; Max uses `redeem` with the complete on-chain share balance to avoid dust.

**yvUSD.** Flexible yvUSD is direct USDC ERC-4626. Locked deposits use the pinned zap and locked vault. Wren reads the locked vault's cooldown duration, withdrawal window, and account status. Users explicitly start or cancel cooldown. During the active window, Wren exits locked yvUSD to yvUSD and then yvUSD to USDC: exact exits use two `withdraw` calls and Max uses two `redeem` calls. The separately reviewed workflow persists across restart.

**yBOLD.** New BOLD deposits go through the pinned zap and finish staked as ysyBOLD. Existing unstaked yBOLD has a separate Stake action. Exits return BOLD through the zap with `maxLoss = 0`; Wren has no loss-tolerance/slippage setting and will not raise that value. Withdrawals requiring realized loss are outside this milestone.

## Workflow safety and recovery

- At most 64 bounded workflows persist. Only one step is queued at a time; after a matching receipt, the user must explicitly Resume.
- Before queuing, Wren re-recognizes the persisted target, chain, receiver/owner, amount, action, approval token, and spender against the current curated vault.
- Rejected, unsubmitted steps can retry. Submitted transactions are never blindly retried. Receipt monitoring survives restart once a hash is known. If Wren cannot prove whether an awaiting-review request broadcast before restart, it cancels the workflow; check on-chain before replacing it.
- Cancel and cleanup are blocked while a request awaits review/confirmation. If an exact approval completed but its operation did not, Wren offers one separately reviewed zero-allowance cleanup and prevents parallel resume. An uncertain prior approval requires a read-only allowance check and a separate Revoke again action; it is never converted directly into another transaction.
- Earn labels require allowlist-bound calldata recognition. A mismatch in chain, target, value, receiver/owner, token-spender relation, action, or zero-loss policy falls back to generic contract-call review. Persisted amounts must match the main-process record.
- Receipts list verified steps, bounded allowlisted ERC-20 `Transfer` inflow/outflow evidence when available, and the correct explorer link. Missing event evidence is not replaced with a renderer amount. Policy-version migrations discard older workflows rather than reinterpreting routes or amounts.
- Notifications use Wren's generic transaction-hash copy rather than balances or Earn amounts.

For the exact candidate and remaining signer limits, see [Linux Release Qualification](QUALIFICATION.md). Do not generalize a tested row to an untested product, chain, or signer.
