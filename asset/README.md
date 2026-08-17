# Wren assets

This directory contains the current durable artwork used by Wren. It is a
production library, not a design-review transcript.

- `brand/` — canonical identity source, reproducible exports, brand sheet, and
  provenance reference.
- `social/` — approved social profile and X header artwork, including the
  purpose-built Night Rounds source panorama.
- `ui/` — current illustrations imported by the application.

Run `npm run brand:generate` after changing the canonical Wren mark or social
source. Run `npm run brand:verify` to check dimensions, app-tile geometry,
monochrome polarity, platform copies, social crop safety, and removal of stale
asset paths.

Historical review screenshots are available through Git history. They are not
kept in the working tree because their decisions are recorded in `DESIGN.md`
and their rendered UI frequently becomes obsolete.
