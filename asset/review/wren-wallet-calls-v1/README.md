# Wren wallet-call family

**Purpose:** production-sized proof for Wren's EIP-5792 non-atomic wallet-call flow.

**Status — selected:** ordered batch review, partial-execution status, and a focused fee/nonce editor.

- **Selected evidence:** `01-batch-review.png` shows ordered pre-submit evidence, aggregate
  simulation, and fee preparation.
- **Selected evidence:** `02-partial-batch-status.png` shows post-submit partial execution with
  ordered receipts.
- **Selected evidence:** `04-adjust-fees-and-nonce.png` shows the starting-nonce and per-transaction
  gas-ceiling editor.
- **Source:** `wallet-calls.html`; use `?view=review`, `?view=status`, or `?view=adjust`.

The scan path shows non-atomic risk, ordered destinations, values, calldata access, and a compact maximum
network-fee row; it avoids nested item cards. Review and status use the same order. Simulation provenance,
raw quantities, and EIP-1559 or legacy gas-price detail remain in disclosures.

Block heights and gas use are decoded for primary display; raw RPC quantities remain secondary evidence.
Gas units and fees remain distinct: validated EIP-1559 receipts show effective gas price and fee paid,
while legacy transactions use their gas-price model. Destinations prefer a locally known or verified
contract name, then validated ERC-20 `name()` and `symbol()`, then the raw address. The identity source
and address remain visible beneath every name.

The collapsed review labels the fee sum and every transaction maximum so the aggregate cannot read as one
shared onchain fee. Fee details expand each existing call in place with its gas limit and EIP-1559 rates;
legacy calls use gas price. A future apply-to-all rate shortcut must keep gas limits independent.

The editor replaces, rather than nests over, review. Only the starting nonce is editable because later
nonces must remain contiguous. Apply returns to review after fresh preparation and simulation; Cancel
preserves the prior snapshot. The standalone fee-details capture and route were superseded and removed.
