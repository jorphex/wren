import React from 'react'
import {
  AlertIcon,
  ArrowDownLeftIcon,
  BlockedIcon,
  BrowserIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  DevicesIcon,
  EllipsisIcon,
  EyeIcon,
  FileIcon,
  FlameIcon,
  HistoryIcon,
  InboxIcon,
  KeyIcon,
  LinkExternalIcon,
  ListUnorderedIcon,
  LockIcon,
  MeterIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  PulseIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SyncIcon,
  TrashIcon
} from '@primer/octicons-react'

const createWrenGlyph = (content) => {
  const WrenGlyph = ({ size = 16, style, verticalAlign = 'middle', ...props }) => (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.7'
      strokeLinecap='square'
      strokeLinejoin='round'
      style={{ ...style, verticalAlign }}
    >
      {content}
    </svg>
  )
  return WrenGlyph
}

// Orthogonal joins and restrained curves give routine controls a hand-built Wren character.
const wrenGlyphs = Object.freeze({
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
  earn: createWrenGlyph(
    <>
      <path d='M4 19h16M6 16l3-3 3 2 6-7' />
      <path d='M14 8h4v4' />
      <path d='M7 8c0-2 1.5-3.5 4-4 0 2.5-1.2 4-4 4Z' />
    </>
  ),
  network: createWrenGlyph(
    <>
      <circle cx='5' cy='12' r='2' />
      <circle cx='18' cy='6' r='2' />
      <circle cx='19' cy='18' r='2' />
      <path d='m7 11 9-4M7 13l10 4M18 8v8' />
    </>
  ),
  tokens: createWrenGlyph(
    <>
      <path d='M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Z' />
      <path d='M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5' />
    </>
  ),
  apps: createWrenGlyph(
    <>
      <path d='M8 4v5M16 4v5M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6V9ZM12 17v3' />
      <path d='M9 20h6' />
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
  activity: HistoryIcon,
  add: PlusIcon,
  alert: AlertIcon,
  back: wrenGlyphs.back,
  blocked: BlockedIcon,
  browser: BrowserIcon,
  check: CheckIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-up': ChevronUpIcon,
  close: wrenGlyphs.close,
  contacts: wrenGlyphs.contacts,
  copy: CopyIcon,
  details: ListUnorderedIcon,
  earn: wrenGlyphs.earn,
  ellipsis: EllipsisIcon,
  external: LinkExternalIcon,
  file: FileIcon,
  hot: FlameIcon,
  hardware: DevicesIcon,
  inventory: PackageIcon,
  key: KeyIcon,
  lock: LockIcon,
  gas: MeterIcon,
  network: wrenGlyphs.network,
  next: wrenGlyphs.next,
  permissions: ShieldIcon,
  pulse: PulseIcon,
  receive: ArrowDownLeftIcon,
  remove: TrashIcon,
  requests: InboxIcon,
  search: SearchIcon,
  server: ServerIcon,
  send: wrenGlyphs.send,
  settings: wrenGlyphs.settings,
  sign: PencilIcon,
  sidebar: wrenGlyphs.sidebar,
  support: wrenGlyphs.support,
  sync: SyncIcon,
  tokens: wrenGlyphs.tokens,
  tutorial: wrenGlyphs.tutorial,
  quit: wrenGlyphs.quit,
  verify: ShieldCheckIcon,
  apps: wrenGlyphs.apps,
  watch: EyeIcon
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
