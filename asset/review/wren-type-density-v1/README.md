# Wren type density check — review v1

Review-only 760 × 900 render used to qualify the functional type floor after the inherited tiny-text
migration. This is a density and clipping check, not a new layout proposal.

- `01-functional-type-density.png` — 1× headless render.
- `type-density-check.html` — self-contained source.
- `03-hybrid-pixel-accent-directions.png` — corrected hybrid, a VCR-led direction, conservative data
  mono, and restricted VCR display use.
- `hybrid-pixel-accent-check.html` — self-contained source for the hybrid/pixel comparison.

Visible functional copy uses 12px or larger. Text-indented spinner geometry remains exempt because it
does not render copy.

The VCR font remains review-only: its small-size legibility failed earlier evaluation and production
provenance should be resolved before any restricted use is integrated.

**Selected:** corrected hybrid. Recursive owns headings, prose, row labels, and controls; Fira Code is
restricted to compact utility roles. VCR remains excluded from production. The superseded intermediate
texture plate was removed after this selection.
