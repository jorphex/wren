# Wren assets

This directory contains artwork used by Wren. Keep review drafts elsewhere.

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

The generator uses the project’s Electron dependency. On Linux, it needs Xvfb
for a private display. It writes the delivery PNGs and runtime copies. The verifier checks
dimensions, app-tile geometry, monochrome polarity, platform copies, social
crop safety, and stale asset paths. Do not edit generated delivery files
directly.

To generate a separate review copy:

```sh
npm run brand:generate -- --output-dir /absolute/path/to/review
```

Historical review screenshots stay in Git history. Local design notes may
provide context, but the current application is the reference for its UI.
