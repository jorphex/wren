# Wren brand library

`wren-mark.svg` is the deterministic vector master. Do not edit generated PNGs
or SVGs in `exports/` directly. Regenerate them with:

```sh
npm run brand:generate
npm run brand:verify
```

## Export map

- `exports/app/` — matte charcoal rounded-square application icons from 16 to
  1024px. The plate reaches the canvas edges at its widest points, keeps
  transparent rounded corners, and uses the approved 120% character scale.
- `exports/mark/` — transparent full-color, monochrome-light, and
  monochrome-dark marks as SVG and PNG from 32 to 1024px.
- `exports/tray/` — optically corrected Windows color, macOS black template,
  and Linux light tray assets at native 24px and 48px source sizes.
- `exports/web/` — 16px and 32px favicons, a 180px Apple touch icon, and 192px
  and 512px web-app icons.
- `wren-brand-sheet.png` — visual proof of the family at full and native sizes.
- `source/wren-character-flat-reference.png` — approved generated concept kept
  as provenance only.

The generated runtime copies under `main/windows/` and `build/icons/` must be
byte-identical to the matching durable exports. macOS template icons are
intentionally black with transparency so the operating system can apply its
light or dark tint. Shipping identity artwork is always rendered from the
vector master.
