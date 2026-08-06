import React from 'react'
import {
  AlertIcon,
  ArrowDownLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BlockedIcon,
  BookIcon,
  BrowserIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  DevicesIcon,
  EllipsisIcon,
  EyeIcon,
  FileIcon,
  FlameIcon,
  GearIcon,
  GlobeIcon,
  GraphIcon,
  HistoryIcon,
  InboxIcon,
  IssueOpenedIcon,
  KeyIcon,
  LinkExternalIcon,
  ListUnorderedIcon,
  LockIcon,
  MeterIcon,
  PackageIcon,
  PeopleIcon,
  PersonIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  PulseIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SidebarExpandIcon,
  SignOutIcon,
  StackIcon,
  SyncIcon,
  TrashIcon,
  XIcon
} from '@primer/octicons-react'

const icons = Object.freeze({
  account: PersonIcon,
  accounts: PersonIcon,
  activity: HistoryIcon,
  add: PlusIcon,
  alert: AlertIcon,
  back: ChevronLeftIcon,
  blocked: BlockedIcon,
  browser: BrowserIcon,
  check: CheckIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-up': ChevronUpIcon,
  close: XIcon,
  contacts: PeopleIcon,
  copy: CopyIcon,
  details: ListUnorderedIcon,
  earn: GraphIcon,
  ellipsis: EllipsisIcon,
  external: LinkExternalIcon,
  file: FileIcon,
  hot: FlameIcon,
  hardware: DevicesIcon,
  inventory: PackageIcon,
  key: KeyIcon,
  lock: LockIcon,
  gas: MeterIcon,
  network: GlobeIcon,
  next: ArrowRightIcon,
  permissions: ShieldIcon,
  pulse: PulseIcon,
  receive: ArrowDownLeftIcon,
  remove: TrashIcon,
  requests: InboxIcon,
  search: SearchIcon,
  server: ServerIcon,
  send: ArrowUpRightIcon,
  settings: GearIcon,
  sign: PencilIcon,
  sidebar: SidebarExpandIcon,
  support: IssueOpenedIcon,
  sync: SyncIcon,
  tokens: StackIcon,
  tutorial: BookIcon,
  quit: SignOutIcon,
  verify: ShieldCheckIcon,
  apps: PlugIcon,
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
