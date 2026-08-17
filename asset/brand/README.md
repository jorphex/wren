# Wren brand library

`wren-mark.svg` is the deterministic vector master. Do not edit generated PNGs
or the SVG files in `exports/` directly; regenerate them with
`npm run brand:generate`.

## Export map

- `exports/app/` — matte charcoal rounded-square application icons from 16 to
  1024 px. The plate reaches the canvas edges at its widest points, retains
  transparent rounded corners, and uses the approved 120 percent character
  scale.
- `exports/mark/` — transparent full-color, monochrome-light, and
  monochrome-dark marks as standalone SVG plus PNGs from 32 to 1024 px.
- `exports/tray/` — optically corrected Windows color, macOS black template,
  and Linux light tray assets at their native 24/48 px source sizes.
- `exports/web/` — ready-named 16/32 px favicons, 180 px Apple touch icon, and
  192/512 px web-app icons.
- `wren-brand-sheet.png` — visual proof of the current family at full and native
  sizes.

The generated runtime copies under `main/windows/` and `build/icons/` must
remain byte-identical to their corresponding durable exports. macOS template
icons are intentionally black with transparency so the operating system can
apply the appropriate light or dark tint.

`source/wren-character-flat-reference.png` preserves the approved generated
concept as provenance only. Shipping identity artwork is always rendered from
the vector master.
