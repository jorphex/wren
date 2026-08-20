import { v5 as uuid } from 'uuid'

export const FRAME_SEND_ORIGIN = 'http://send.frame.eth.localhost:8421'
export const FRAME_SEND_DISPLAY_NAME = 'Wren Send'
export const WREN_DEPLOY_ORIGIN = 'http://deploy.wren.localhost:8421'
export const WREN_DEPLOY_DISPLAY_NAME = 'Wren Deploy'
export const WREN_INTERNAL_ORIGIN = 'frame-internal'
export const WREN_INTERNAL_DISPLAY_NAME = 'Wren'
export const WREN_EXTENSION_ORIGIN = 'frame-extension'

export const originIdForName = (origin: string) => uuid(origin, uuid.DNS)

export type InvokerContext =
  | { provenance: 'direct' }
  | { provenance: 'companion'; sourceId: string }
  | { provenance: 'native'; sourceId: string }
  | { provenance: 'internal' }
  | { provenance: 'managed' }

export const originIdForInvoker = (origin: string, context: InvokerContext) => {
  if (context.provenance === 'internal' || context.provenance === 'managed') return originIdForName(origin)

  if (context.provenance === 'native') return uuid(`native\u0000${context.sourceId}`, uuid.URL)
  const sourceId = context.provenance === 'companion' ? context.sourceId : ''
  return uuid(`${context.provenance}\u0000${sourceId}\u0000${origin}`, uuid.URL)
}

export const WREN_MANAGED_ORIGIN_NAMES = Object.freeze([FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN] as const)
const managedOriginEntries = WREN_MANAGED_ORIGIN_NAMES.map(
  (origin) => [originIdForInvoker(origin, { provenance: 'managed' }), origin] as const
)
export const WREN_MANAGED_ORIGIN_IDS = Object.freeze(managedOriginEntries.map(([originId]) => originId))

const managedOriginNameById = new Map(managedOriginEntries)

export const isManagedOriginName = (origin: unknown): origin is (typeof WREN_MANAGED_ORIGIN_NAMES)[number] =>
  typeof origin === 'string' && WREN_MANAGED_ORIGIN_NAMES.some((name) => name === origin)

export const getManagedOriginNameForId = (originId: string) => managedOriginNameById.get(originId)

export const isWrenOwnedOriginName = (origin: unknown) =>
  origin === WREN_INTERNAL_ORIGIN || origin === WREN_EXTENSION_ORIGIN || isManagedOriginName(origin)

const trustedOriginIds = [WREN_EXTENSION_ORIGIN, WREN_INTERNAL_ORIGIN].map(originIdForName)

export const isTrustedOriginId = (originId: string) => trustedOriginIds.includes(originId)

export function getOriginDisplayName(origin: unknown): string {
  if (origin === FRAME_SEND_ORIGIN) return FRAME_SEND_DISPLAY_NAME
  if (origin === WREN_DEPLOY_ORIGIN) return WREN_DEPLOY_DISPLAY_NAME
  if (origin === WREN_INTERNAL_ORIGIN) return WREN_INTERNAL_DISPLAY_NAME
  return typeof origin === 'string' && origin.length > 0 ? origin : 'Unknown origin'
}
