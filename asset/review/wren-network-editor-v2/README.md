# Wren quiet network editor — review v2

Production-sized restart of the rejected network-editor v1 study.

- `01-add-network.png` — a dapp proposal and editable network form combined into one decision.
- `02-rpc-mismatch.png` — validation feedback stays in the RPC label instead of adding another notice.
- `03-edit-network.png` — existing RPC values are editable in place; validation runs when focus leaves
  the field.
- `network-editor.html` — shared source; use `?view=add`, `?view=error`, or `?view=edit`.

This direction deliberately removes section headings, helper captions, metadata controls, status rows,
RPC `Change` buttons, footer explanation, and the extra proposal-to-editor handoff. Only field labels,
values, connection state, and the final action remain. The chiseled wells are ordinary editable inputs,
and the footer actions reuse the approved request/signing geometry and material treatment exactly.

Warmth comes from pacing, the feather-gold focus/action language, and one low-contrast approved branch
accent in otherwise quiet space. No new illustration was generated and no routine-settings mascot was
introduced.
