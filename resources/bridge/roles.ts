export type RendererRole = 'dash' | 'dapp' | 'notify' | 'onboard' | 'tray'
export type BridgeMethod = 'event' | 'invoke' | 'rpc'

export const RENDERER_ROLE_ARGUMENT = '--frame-renderer-role='
export const rendererRoles: readonly RendererRole[] = ['dash', 'dapp', 'notify', 'onboard', 'tray']

type LimitedRendererRole = Exclude<RendererRole, 'dash' | 'tray'>
type LimitedCapabilities = {
  actions: ReadonlySet<string>
  events: ReadonlySet<string>
  rpc: ReadonlySet<string>
}

const limitedCapabilities: Record<LimitedRendererRole, LimitedCapabilities> = {
  dapp: {
    actions: new Set(['navDash']),
    events: new Set(['*:contextmenu', 'frame:close', 'frame:max', 'frame:min', 'frame:unmax', 'tray:action']),
    rpc: new Set(['getFrameId', 'getState'])
  },
  notify: {
    actions: new Set(),
    events: new Set(['*:contextmenu', 'frame:close', 'frame:max', 'frame:min', 'frame:unmax', 'tray:action']),
    rpc: new Set(['getState'])
  },
  onboard: {
    actions: new Set(['navDash', 'navReplace', 'setKeyboardLayout']),
    events: new Set([
      '*:contextmenu',
      'frame:close',
      'frame:max',
      'frame:min',
      'frame:unmax',
      'tray:action',
      'tray:openExternal'
    ]),
    rpc: new Set(['getState'])
  }
} as const

export const isRendererRole = (value: unknown): value is RendererRole =>
  typeof value === 'string' && rendererRoles.includes(value as RendererRole)

export const hasRendererCapability = (
  rendererRole: RendererRole | null | undefined,
  method: BridgeMethod,
  args: unknown[]
) => {
  if (!rendererRole) return false
  if (rendererRole === 'dash' || rendererRole === 'tray') return true

  const capabilities = limitedCapabilities[rendererRole]
  if (method === 'rpc') return typeof args[0] === 'string' && capabilities.rpc.has(args[0])
  if (method === 'invoke') return false

  const channel = args[0]
  if (typeof channel !== 'string' || !capabilities.events.has(channel)) return false
  return channel !== 'tray:action' || (typeof args[1] === 'string' && capabilities.actions.has(args[1]))
}

export const rendererRoleForWindow = (name: string): RendererRole => {
  if (name === 'frameInstance') return 'dapp'
  if (isRendererRole(name)) return name

  throw new Error(`Window "${name}" has no renderer IPC role`)
}
