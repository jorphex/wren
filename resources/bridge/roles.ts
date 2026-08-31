export type RendererRole = 'dash' | 'dapp' | 'onboard' | 'tray'
export type BridgeMethod = 'event' | 'invoke' | 'rpc'

export const RENDERER_ROLE_ARGUMENT = '--frame-renderer-role='
export const rendererRoles: readonly RendererRole[] = ['dash', 'dapp', 'onboard', 'tray']

type LimitedRendererRole = Exclude<RendererRole, 'dash' | 'tray'>
type LimitedCapabilities = {
  actions: ReadonlySet<string>
  events: ReadonlySet<string>
  rpc: ReadonlySet<string>
}

const limitedCapabilities: Record<LimitedRendererRole, LimitedCapabilities> = {
  dapp: {
    actions: new Set(['navDash', 'retryDapp']),
    events: new Set(['*:contextmenu', 'frame:close', 'frame:max', 'frame:min', 'frame:unmax', 'tray:action']),
    rpc: new Set(['getFrameId', 'getState'])
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

const dashboardOnlyInvokeChannels = new Set([
  'settings:clearRecentRecipients',
  'contractVerification:credentialStatus',
  'contractVerification:get',
  'contractVerification:inspectArtifact',
  'contractVerification:list',
  'contractVerification:openResult',
  'contractVerification:prepare',
  'contractVerification:publish',
  'contractVerification:publishEtherscan',
  'contractVerification:refresh',
  'contractVerification:removeCredential',
  'contractVerification:reselect',
  'contractVerification:saveCredential',
  'contractVerification:selectArtifact'
])

const trustedWindowInvokeChannels = new Set(['tray:continueContractVerification'])
const trayOnlyInvokeChannels = new Set(['activity:clear', 'activity:details'])

const dashboardOnlyRpcMethods = new Set([
  'createFromKeystore',
  'createFromPhrase',
  'createFromPrivateKey',
  'removeSigner',
  'reserveGeneratedWallet',
  'beginGeneratedWallet',
  'completeGeneratedWallet',
  'discardGeneratedWallet'
])

export const isRendererRole = (value: unknown): value is RendererRole =>
  typeof value === 'string' && rendererRoles.includes(value as RendererRole)

export const hasRendererCapability = (
  rendererRole: RendererRole | null | undefined,
  method: BridgeMethod,
  args: unknown[]
) => {
  if (!rendererRole) return false
  const channel = args[0]
  if (method === 'invoke' && typeof channel === 'string') {
    if (
      channel === 'tray:writeClipboard' &&
      typeof args[1] === 'object' &&
      args[1] !== null &&
      'secret' in args[1] &&
      args[1].secret === true
    ) {
      return rendererRole === 'dash'
    }
    if (dashboardOnlyInvokeChannels.has(channel)) return rendererRole === 'dash'
    if (trayOnlyInvokeChannels.has(channel)) return rendererRole === 'tray'
    if (trustedWindowInvokeChannels.has(channel)) {
      return rendererRole === 'dash' || rendererRole === 'tray'
    }
  }
  if (
    method === 'invoke' &&
    typeof channel === 'string' &&
    (channel.startsWith('profile:') ||
      channel.startsWith('signers:') ||
      channel.startsWith('deployment:') ||
      channel.startsWith('inspector:') ||
      channel.startsWith('send:'))
  ) {
    return rendererRole === 'dash'
  }
  if (method === 'rpc' && typeof channel === 'string' && dashboardOnlyRpcMethods.has(channel)) {
    return rendererRole === 'dash'
  }
  if (rendererRole === 'dash' || rendererRole === 'tray') return true

  const capabilities = limitedCapabilities[rendererRole]
  if (method === 'rpc') return typeof args[0] === 'string' && capabilities.rpc.has(args[0])
  if (method === 'invoke') return false

  if (typeof channel !== 'string' || !capabilities.events.has(channel)) return false
  return channel !== 'tray:action' || (typeof args[1] === 'string' && capabilities.actions.has(args[1]))
}

export const rendererRoleForWindow = (name: string): RendererRole => {
  if (name === 'frameInstance') return 'dapp'
  if (isRendererRole(name)) return name

  throw new Error(`Window "${name}" has no renderer IPC role`)
}
