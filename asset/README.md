# Wren assets

This directory contains durable artwork used by Wren. It is a production
library, not a design-review archive.

- `brand/` contains the deterministic identity master, generated exports, the
  brand sheet, and approved concept provenance.
- `social/` contains the approved profile and X header, plus the Night Rounds
  source panorama.
- `ui/` contains current illustrations imported by the application.

After changing the canonical mark or social source, run:

```sh
npm run brand:generate
npm run brand:verify
```

The generator writes the delivery PNGs and runtime copies. The verifier checks
dimensions, app-tile geometry, monochrome polarity, platform copies, social
crop safety, and stale asset paths. Do not edit generated delivery files
directly.

Historical review screenshots stay in Git history. Their decisions are
recorded in `DESIGN.md`; rendered UI becomes obsolete as the product changes.
