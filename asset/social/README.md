# Wren social artwork

The selected social direction is **Night Rounds**. The profile uses Wren's
canonical full-color character on a dark textured canvas. The header is a
purpose-built 3:1 pixel-art garden panorama. Neither image uses an app-icon
tile, wordmark, or marketing copy.

## Delivery files

- `wren-profile-400.png` — 400 × 400. Keep the full character inside the
  centered 320px safe circle for a circular crop.
- `wren-x-header-1500x500.png` — 1500 × 500. The gate lantern balances the
  left; a path crosses the middle; the detailed wren and main lantern anchor
  the right. Keep essential content legible when X removes the outer 60px at
  the top and bottom.
- `source/wren-night-rounds-v1.png` — approved 2172 × 724 source panorama.

Regenerate the delivery files with:

```sh
npm run brand:generate
npm run brand:verify
```

The profile uses `asset/brand/wren-mark.svg` and
`resources/svg/wren-grain.svg`. The header uses the Night Rounds source. Do not
edit delivery PNGs directly. Current X dimensions and crop guidance are at
<https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo>.

The Night Rounds source was generated with the built-in image-generation tool
using `asset/ui/onboarding-welcome.png` as its visual reference. Its brief
specified a native 3:1 nocturnal garden panorama with an open gate and
secondary lantern on the left, a winding path and distant lantern in the
middle, and one detailed wren beside the main lantern on the right. It
excluded text, logos, crypto imagery, UI panels, and fantasy effects.

## Desktop launch-scene sources

- `source/wren-linux-0.1.0-launch-v6.png` — original Linux and Windows launch
  scene retained as the clean pre-Apple source.
- `source/wren-linux-0.1.0-launch-v13-apple-ledge.png` — selected final
  three-platform composition with the Apple mark on the upper ledge.

Intermediate Apple-placement, cleanup, and lighting attempts are review
artifacts rather than production sources and do not belong in this directory.
