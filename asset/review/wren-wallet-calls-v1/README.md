# Wren wallet-call family

Production-sized visual proof for Wren's EIP-5792 non-atomic wallet-call flow.

- `01-batch-review.png` — ordered pre-submit evidence with aggregate simulation and fee preparation.
- `02-partial-batch-status.png` — post-submit partial execution with ordered transaction receipts.
- `04-adjust-fees-and-nonce.png` — focused editor for the starting nonce and each transaction's gas
  ceiling.
- `wallet-calls.html` — shared source; select a screen with `?view=review`, `?view=status`,
  or `?view=adjust`.

The design keeps exact batch identity, order, raw-value/calldata access, RPC qualification, execution
fee bounds, and non-atomic risk visible without presenting each item as a nested card. Status evidence
uses the same ordering as review so the user can relate submitted transactions back to the original batch.
Block heights and gas usage are decoded for primary display; exact raw RPC quantities remain secondary
evidence in production rather than being the user-facing default. Gas units remain distinct from fees:
EIP-1559 receipts show effective gas price and fee paid when validated receipt evidence is available,
while legacy transactions fall back to their gas-price model without inventing an EIP-1559 breakdown.
Call destinations prefer a locally known or verified contract name, then validated ERC-20 `name()` and
`symbol()` metadata, and finally the raw address. The identity source and address remain visible beneath
every name so untrusted or duplicate token names cannot replace destination evidence.
The primary batch scan path is intentionally limited to partial-execution risk, ordered destinations,
values, calldata access, and a compact maximum network-fee row matching Wren's transaction review.
Simulation provenance, raw quantities, and the adaptive EIP-1559 or legacy gas-price breakdown remain
available through details disclosures.
The collapsed review labels the fee sum and each transaction maximum explicitly so the aggregate cannot
be mistaken for one shared onchain fee. The optional fee disclosure expands each existing call in place
with its gas limit and EIP-1559 rates rather than repeating the destinations in a separate list; legacy
calls substitute their gas price. A later editor may offer an apply-to-all rate shortcut, but gas limits
remain independent.
The focused editor is entered from the review's fee action; it replaces the review instead of nesting a
panel over it. Only the starting nonce is editable because later nonces must remain contiguous. Applying
changes returns to review after fresh preparation and simulation; canceling preserves the prior snapshot.
The superseded standalone fee-details capture and route were removed.
