# Wren quiet network editor — review v2

**Purpose:** production-sized restart of the rejected network-editor v1 study.

**Status — selected:** quiet proposal-and-editor flow. It is the production reference integrated on
2026-08-08.

- **Selected evidence:** `01-add-network.png` combines a dapp proposal and editable network form.
- **Selected evidence:** `02-rpc-mismatch.png` keeps validation feedback in the RPC label.
- **Selected evidence:** `03-edit-network.png` makes RPC values editable in place and validates on
  blur.
- **Source:** `network-editor.html`; use `?view=add`, `?view=error`, or `?view=edit`.

The selected flow keeps field labels, values, connection state, and the final action. It rejects section
headings, helper captions, metadata controls, status rows, RPC `Change` buttons, footer explanation,
and a separate proposal-to-editor handoff. Chiseled wells remain ordinary editable inputs; footer
actions reuse the approved request/signing geometry and material treatment.

Warmth comes from pacing, feather-gold focus/action treatment, and one low-contrast approved branch
accent. No new illustration or routine-settings mascot was introduced.
