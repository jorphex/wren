import React from 'react'

const createWrenGlyph = (content) => {
  const WrenGlyph = ({ size = 16, style, verticalAlign = 'middle', ...props }) => (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      shapeRendering='geometricPrecision'
      style={{ ...style, verticalAlign }}
    >
      {content}
    </svg>
  )
  return WrenGlyph
}

const createPixelGlyph = ({ compact, regular }) => {
  const PixelGlyph = ({ size = 16, style, verticalAlign = 'middle', ...props }) => {
    const numericSize = Number.parseFloat(size)
    const useCompactMaster = !Number.isNaN(numericSize) && numericSize <= 16

    return (
      <svg
        {...props}
        width={size}
        height={size}
        viewBox={useCompactMaster ? '0 0 16 16' : '0 0 20 20'}
        fill='currentColor'
        shapeRendering='crispEdges'
        style={{ ...style, verticalAlign }}
      >
        {useCompactMaster ? compact : regular}
      </svg>
    )
  }
  return PixelGlyph
}

// Pixel-authored product glyphs have separate compact and regular optical masters. They are kept
// sparse so the aliased construction reads as intentional at native UI sizes instead of as a
// low-resolution illustration enlarged inside a control.
const pixelGlyphs = Object.freeze({
  earn: createPixelGlyph({
    compact: <path d='M1 14h14v1H1v-1Zm3-4h1v4H4v-4Zm3-3h1v7H7V7Zm3-4h1v11h-1V3Z' />,
    regular: <path d='M2 18h16v1H2v-1Zm3-5h2v5H5v-5Zm4-4h2v9H9V9Zm4-5h2v14h-2V4Z' />
  }),
  network: createPixelGlyph({
    compact: <path d='M1 6h3v3H1V6Zm12-4h2v3h-2V2Zm0 10h2v3h-2v-3ZM4 7h3V4h6v1H8v3H4V7Zm3 1h1v5h5v1H7V8Z' />,
    regular: (
      <path d='M2 8h4v4H2V8Zm14-5h3v4h-3V3Zm0 11h3v4h-3v-4ZM6 9h4V6h6v1h-5v3H6V9Zm4 1h1v6h5v1h-6v-7Z' />
    )
  }),
  tokens: createPixelGlyph({
    compact: (
      <>
        <path
          fillRule='evenodd'
          d='M5 1h6v1h2v2h2v8h-2v2h-2v1H5v-1H3v-2H1V4h2V2h2V1Zm1 2H5v1H4v1H3v6h1v1h1v1h6v-1h1v-1h1V5h-1V4h-1V3H6Z'
        />
        <path d='M7 5h2v1h1v1h1v2h-1v1H9v1H7v-1H6V9H5V7h1V6h1V5Z' />
      </>
    ),
    regular: (
      <>
        <path
          fillRule='evenodd'
          d='M6 2h8v1h2v1h1v2h1v8h-1v2h-1v1h-2v1H6v-1H4v-1H3v-2H2V6h1V4h1V3h2V2Zm1 2H6v1H5v2H4v6h1v2h1v1h8v-1h1v-2h1V7h-1V5h-1V4H7Z'
        />
        <path d='M9 7h2v1h1v1h1v2h-1v1h-1v1H9v-1H8v-1H7V9h1V8h1V7Z' />
      </>
    )
  }),
  seedling: createPixelGlyph({
    compact: <path d='M8 7h1v7H8V7ZM3 5h4v1h1v3H6V8H4V7H3V5Zm6-2h1V2h4v3h-1v1h-1v1H9V3ZM4 14h8v1H4v-1Z' />,
    regular: <path d='M10 8h1v9h-1V8ZM4 6h4v1h1v3H7V9H5V8H4V6Zm7-2h1V3h5v3h-1v1h-2v1h-3V4ZM5 17h10v1H5v-1Z' />
  }),
  pending: createPixelGlyph({
    compact: (
      <path d='M3 1h10v1H3V1Zm1 1h1v3h1v1h1v1h2V6h1V5h1V2h1v3h-1v2h-1v1h1v1h1v2h1v3h-1v-3h-1v-1h-1V9H6v1H5v1H4v3H3v-3h1V9h1V8H6V7H5V6H4V5H3V2h1Zm-1 12h10v1H3v-1Z' />
    ),
    regular: (
      <path d='M4 2h12v1H4V2Zm1 1h1v4h1v1h1v1h4V8h1V7h1V3h1v4h-1v2h-1v1h-1v1h1v1h1v2h1v4h-1v-4h-1v-1h-1v-1H8v1H7v1H6v4H5v-4h1v-2h1v-1h1v-1H7V9H6V7H5V3Zm-1 15h12v1H4v-1Z' />
    )
  }),
  failed: createPixelGlyph({
    compact: (
      <path d='M3 2h2v2h1v1h4V4h1V2h2v3h-1v1h-1v1h-1v2h1v1h1v1h1v3h-2v-2h-1v-1H6v1H5v2H3v-3h1v-1h1V9h1V7H5V6H4V5H3V2Z' />
    ),
    regular: (
      <path d='M4 3h2v2h1v1h1v1h4V6h1V5h1V3h2v3h-1v1h-1v1h-1v1h-1v2h1v1h1v1h1v1h1v3h-2v-2h-1v-1h-1v-1H8v1H7v1H6v2H4v-3h1v-1h1v-1h1v-1h1V9H7V8H6V7H5V6H4V3Z' />
    )
  }),
  verified: createPixelGlyph({
    compact: (
      <>
        <path
          fillRule='evenodd'
          d='M4 1h8v1h3v7h-1v2h-2v2h-1v2H5v-2H4v-2H2V9H1V2h3V1Zm1 2H3v6h1v1h2v2h1v1h2v-1h1v-2h2V9h1V3h-2V2H5v1Z'
        />
        <path d='M4 7h1v2h2V8h1V7h1V6h2v2h-1v1H9v1H8v1H6v-1H5V9H4V7Z' />
      </>
    ),
    regular: (
      <>
        <path
          fillRule='evenodd'
          d='M5 2h10v1h3v9h-1v3h-2v2h-2v2H7v-2H5v-2H3v-3H2V3h3V2Zm1 2H4v8h1v2h2v2h2v1h2v-1h2v-2h2v-2h1V4h-2V3H6v1Z'
        />
        <path d='M6 9h1v2h2v-1h1V9h1V8h1V7h2v2h-1v1h-1v1h-1v1h-1v1H8v-1H7v-1H6V9Z' />
      </>
    )
  })
})

// Restrained curves and compact geometry keep routine controls precise with a hand-drawn edge.
const wrenGlyphs = Object.freeze({
  activity: createWrenGlyph(
    <>
      <circle cx='12' cy='12' r='8' />
      <path d='M12 7v5l3 2M7 4 4-2M17 4l-4-2' />
    </>
  ),
  add: createWrenGlyph(<path d='M12 5v14M5 12h14' />),
  alert: createWrenGlyph(
    <>
      <path d='M12 3 21 20H3L12 3Z' />
      <path d='M12 9v5M12 17.5v.5' />
    </>
  ),
  accounts: createWrenGlyph(
    <>
      <circle cx='12' cy='8' r='3' />
      <path d='M5 20v-2.5C5 14.5 7.5 13 12 13s7 1.5 7 4.5V20' />
      <path d='M8 4h8' />
    </>
  ),
  contacts: createWrenGlyph(
    <>
      <circle cx='9' cy='8' r='2.7' />
      <path d='M3.5 19v-2c0-2.8 2-4.2 5.5-4.2s5.5 1.4 5.5 4.2v2' />
      <path d='M15 6.2a2.5 2.5 0 0 1 0 4.8M16.5 13.2c2.7.4 4 1.8 4 4.3V19' />
    </>
  ),
  earn: pixelGlyphs.earn,
  network: pixelGlyphs.network,
  tokens: pixelGlyphs.tokens,
  apps: createWrenGlyph(
    <>
      <path d='M8 4v5M16 4v5M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6V9ZM12 17v3' />
      <path d='M9 20h6' />
    </>
  ),
  blocked: createWrenGlyph(
    <>
      <circle cx='12' cy='12' r='8' />
      <path d='m6.5 17.5 11-11' />
    </>
  ),
  browser: createWrenGlyph(
    <>
      <rect x='3' y='4' width='18' height='16' rx='1.5' />
      <path d='M3 8h18M6 6h.5M9 6h.5' />
    </>
  ),
  check: createWrenGlyph(<path d='m5 12 4.5 4.5L19 7' />),
  chevronDown: createWrenGlyph(<path d='m6.5 9 5.5 5.5L17.5 9' />),
  chevronLeft: createWrenGlyph(<path d='m15 6.5-5.5 5.5 5.5 5.5' />),
  chevronRight: createWrenGlyph(<path d='m9 6.5 5.5 5.5L9 17.5' />),
  chevronUp: createWrenGlyph(<path d='m6.5 15 5.5-5.5 5.5 5.5' />),
  copy: createWrenGlyph(
    <>
      <rect x='8' y='8' width='11' height='12' rx='1' />
      <path d='M16 8V4H5v12h3' />
    </>
  ),
  settings: createWrenGlyph(
    <>
      <path d='M4 6h5M13 6h7M4 12h10M18 12h2M4 18h2M10 18h10' />
      <rect x='9' y='4' width='4' height='4' rx='.5' />
      <rect x='14' y='10' width='4' height='4' rx='.5' />
      <rect x='6' y='16' width='4' height='4' rx='.5' />
    </>
  ),
  support: createWrenGlyph(
    <>
      <path d='M4 5h16v11H9l-4 3v-3H4V5Z' />
      <path d='M8 10h8M8 13h5' />
    </>
  ),
  tutorial: createWrenGlyph(
    <>
      <path d='M4 5h6c1.2 0 2 .8 2 2v13c0-1.2-.8-2-2-2H4V5ZM20 5h-6c-1.2 0-2 .8-2 2v13c0-1.2.8-2 2-2h6V5Z' />
    </>
  ),
  quit: createWrenGlyph(
    <>
      <path d='M13 4H6v16h7M10 12h10M17 9l3 3-3 3' />
    </>
  ),
  back: createWrenGlyph(<path d='m14.5 5-7 7 7 7M8 12h11' />),
  next: createWrenGlyph(<path d='M6 12h11M13.5 7l5 5-5 5' />),
  close: createWrenGlyph(<path d='M6 6l12 12M18 6 6 18' />),
  details: createWrenGlyph(<path d='M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1' />),
  devices: createWrenGlyph(
    <>
      <rect x='4' y='3' width='11' height='17' rx='1.5' />
      <path d='M8 17h3M17 8h3v11h-3' />
    </>
  ),
  ellipsis: createWrenGlyph(<path d='M5 12h.5M11.75 12h.5M18.5 12h.5' />),
  external: createWrenGlyph(
    <>
      <path d='M13 5h6v6M19 5l-9 9' />
      <path d='M18 14v5H5V6h5' />
    </>
  ),
  eye: createWrenGlyph(
    <>
      <path d='M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Z' />
      <circle cx='12' cy='12' r='2.5' />
    </>
  ),
  file: createWrenGlyph(
    <>
      <path d='M6 3h8l4 4v14H6V3Z' />
      <path d='M14 3v5h4M9 12h6M9 16h6' />
    </>
  ),
  hot: createWrenGlyph(
    <path d='M13 3c1 4-2 5-2 8 0 1.5 1 2.5 2 3-1-3 3-4 3-7 3 3 4 6 4 9a8 8 0 0 1-16 0c0-4 2-7 5-10 0 3 1 5 3 6-1-4 2-7 2-11Z' />
  ),
  globe: createWrenGlyph(
    <>
      <circle cx='12' cy='12' r='8' />
      <path d='M4 12h16' />
      <path d='M12 4c2.4 2.1 3.6 4.9 3.6 8s-1.2 5.9-3.6 8c-2.4-2.1-3.6-4.9-3.6-8s1.2-5.9 3.6-8Z' />
    </>
  ),
  inbox: createWrenGlyph(
    <>
      <path d='M4 5h16v14H4V5Z' />
      <path d='M4 14h5l1.5 2h3L15 14h5' />
    </>
  ),
  inventory: createWrenGlyph(
    <>
      <path d='m4 7 8-4 8 4-8 4-8-4Z' />
      <path d='M4 7v10l8 4 8-4V7M12 11v10' />
    </>
  ),
  key: createWrenGlyph(
    <>
      <circle cx='8' cy='12' r='4' />
      <path d='M12 12h9M17 12v3M20 12v2' />
    </>
  ),
  lock: createWrenGlyph(
    <>
      <rect x='5' y='10' width='14' height='11' rx='1.5' />
      <path d='M8 10V7a4 4 0 0 1 8 0v3M12 14v3' />
    </>
  ),
  meter: createWrenGlyph(
    <>
      <path d='M5 18a8 8 0 1 1 14 0H5Z' />
      <path d='m12 14 4-5M8 18h8' />
    </>
  ),
  minimize: createWrenGlyph(<path d='M6 15h12' />),
  maximize: createWrenGlyph(<path d='M5 5h14v14H5V5ZM8 8h8v8H8V8Z' />),
  restore: createWrenGlyph(
    <>
      <path d='M8 5h11v11h-3M5 8h11v11H5V8Z' />
    </>
  ),
  pencil: createWrenGlyph(
    <>
      <path d='m5 16-1 4 4-1L19 8l-3-3L5 16Z' />
      <path d='m14 7 3 3' />
    </>
  ),
  pulse: createWrenGlyph(<path d='M3 12h4l2-6 4 12 2-6h6' />),
  receive: createWrenGlyph(<path d='M18 6 6 18M6 9v9h9' />),
  remove: createWrenGlyph(
    <>
      <path d='M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6' />
    </>
  ),
  search: createWrenGlyph(
    <>
      <circle cx='10.5' cy='10.5' r='6.5' />
      <path d='m15.5 15.5 5 5' />
    </>
  ),
  seedling: pixelGlyphs.seedling,
  server: createWrenGlyph(
    <>
      <rect x='4' y='4' width='16' height='6' rx='1' />
      <rect x='4' y='14' width='16' height='6' rx='1' />
      <path d='M7 7h.5M7 17h.5M11 7h6M11 17h6' />
    </>
  ),
  shield: createWrenGlyph(<path d='M12 3 19 6v5c0 5-2.5 8-7 10-4.5-2-7-5-7-10V6l7-3Z' />),
  shieldCheck: pixelGlyphs.verified,
  sync: createWrenGlyph(
    <>
      <path d='M19 8a8 8 0 0 0-13-2L4 8M4 4v4h4' />
      <path d='M5 16a8 8 0 0 0 13 2l2-2M20 20v-4h-4' />
    </>
  ),
  sidebar: createWrenGlyph(
    <>
      <rect x='3.5' y='4' width='17' height='16' rx='1.5' />
      <path d='M10 4v16M14 9l3 3-3 3' />
    </>
  ),
  send: createWrenGlyph(
    <>
      <path d='M5 19 19 5M10 5h9v9' />
      <path d='M5 12v7h7' />
    </>
  )
})

const icons = Object.freeze({
  account: wrenGlyphs.accounts,
  accounts: wrenGlyphs.accounts,
  activity: wrenGlyphs.activity,
  add: wrenGlyphs.add,
  alert: wrenGlyphs.alert,
  back: wrenGlyphs.back,
  blocked: wrenGlyphs.blocked,
  browser: wrenGlyphs.browser,
  check: wrenGlyphs.check,
  'chevron-down': wrenGlyphs.chevronDown,
  'chevron-left': wrenGlyphs.chevronLeft,
  'chevron-right': wrenGlyphs.chevronRight,
  'chevron-up': wrenGlyphs.chevronUp,
  close: wrenGlyphs.close,
  contacts: wrenGlyphs.contacts,
  copy: wrenGlyphs.copy,
  details: wrenGlyphs.details,
  earn: wrenGlyphs.earn,
  ellipsis: wrenGlyphs.ellipsis,
  eye: wrenGlyphs.eye,
  external: wrenGlyphs.external,
  failed: pixelGlyphs.failed,
  file: wrenGlyphs.file,
  hot: wrenGlyphs.hot,
  hardware: wrenGlyphs.devices,
  inventory: wrenGlyphs.inventory,
  key: wrenGlyphs.key,
  lock: wrenGlyphs.lock,
  maximize: wrenGlyphs.maximize,
  minimize: wrenGlyphs.minimize,
  gas: wrenGlyphs.meter,
  globe: wrenGlyphs.globe,
  network: wrenGlyphs.network,
  next: wrenGlyphs.next,
  pending: pixelGlyphs.pending,
  permissions: wrenGlyphs.shield,
  pulse: wrenGlyphs.pulse,
  receive: wrenGlyphs.receive,
  restore: wrenGlyphs.restore,
  remove: wrenGlyphs.remove,
  requests: wrenGlyphs.inbox,
  search: wrenGlyphs.search,
  seedling: wrenGlyphs.seedling,
  server: wrenGlyphs.server,
  send: wrenGlyphs.send,
  settings: wrenGlyphs.settings,
  sign: wrenGlyphs.pencil,
  sidebar: wrenGlyphs.sidebar,
  support: wrenGlyphs.support,
  sync: wrenGlyphs.sync,
  tokens: wrenGlyphs.tokens,
  tutorial: wrenGlyphs.tutorial,
  quit: wrenGlyphs.quit,
  verify: wrenGlyphs.shieldCheck,
  verified: pixelGlyphs.verified,
  apps: wrenGlyphs.apps,
  watch: wrenGlyphs.eye
})

export const iconNames = Object.freeze(Object.keys(icons))

const Icon = ({ className, label, name, size = 16, ...props }) => {
  const IconComponent = icons[name]
  if (!IconComponent) throw new Error(`Unknown Wren icon: ${name}`)

  return (
    <IconComponent
      {...props}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      className={className}
      focusable='false'
      role={label ? 'img' : undefined}
      size={size}
      verticalAlign='middle'
    />
  )
}

export default Icon
