# Wren Character-flat release proof

Production proof for the user-approved Character-flat direction. The vector
master is `asset/brand/wren-mark.svg`; generated PNG assets are produced by
`scripts/generate-brand-assets.mjs`.

The pack uses one authoritative exterior contour for full-size color and mono
marks, plus explicit optical reductions at 32, 24, and 16 px. Light-on-dark mono
is inset 1.5 percent to compensate for irradiation. The 16 px reduction is
silhouette-first and intentionally drops all internal detail.

Square color and mono marks are positioned from their contrast-weighted center,
not equal bounding-box margins: the approved geometry is translated 8 source
units left and 51 units up. Monochrome tray exports use a 42-unit upward optical
correction, equivalent to 1 px at 24 px and 2 px at 48 px after rendering.
Linux system-tray exports use the silhouette-first 16 px contour at 128 percent
scale so desktop panels that normalize the 24 px source to a 16 px logical slot
retain a clear 15-by-10 px optical footprint with safe raster margins. A
10-source-unit left correction balances the enlarged asymmetric tail.

The social profile export uses the same dark canvas, restrained warm lift, and
shared grain as the product UI. The X header uses the purpose-built Night Rounds
pixel-art panorama: a gate and second lantern balance the left, a winding path
connects the scene, and the detailed wren and main lantern anchor the right.
Both deliberately omit the app-icon tile and marketing copy. Source and
delivery notes live in `asset/social/README.md`.

The original user-approved generated image is retained beside this file as
`approved-character-flat-source.png`. It records provenance and visual intent;
it is not a shipping asset. Rejected exploration rounds and superseded review
renders are intentionally excluded from the release pack.

The installed app tile enlarges the canonical full-color mark to 120 percent
around the canvas center for clearer taskbar and dock recognition. This optical
scale applies only to the app tile; tray and menu-bar reductions retain their
independent native-size corrections.
