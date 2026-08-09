# Wren typography plate — review v1

Review reference at Wren's 760 × 900 shell size. Nothing in this directory is a runtime dependency;
the selected typography roles are integrated in production.

- `01-type-hierarchy-directions.png` — the same wallet hierarchy rendered as Current Wren, Sharper
  Recursive, Mono-forward names/titles, and a restricted true-pixel accent.
- `typography-plate.html` — self-contained source for the plate.

Every direction keeps Fira Code for addresses and numeric values. This isolates the actual decision:
how Wren should render account names, headings, labels, body copy, and actions.

**Selected:** `02 Sharper Recursive` for production headings and body copy. The true-pixel direction
is not suitable at Wren's working sizes: counters and apertures collapse, and its kerning becomes
uneven. A later density review selected a corrected hybrid: Fira Code supplies compact utility
texture while Recursive remains mandatory for headings, prose, row labels, and controls. Revisit
pixel typography only with a purpose-built face and small-size optical masters.
