import { v5 as uuid } from 'uuid'

export const FRAME_SEND_ORIGIN = 'http://send.frame.eth.localhost:8421'
export const FRAME_SEND_DISPLAY_NAME = 'Wren Send'

export const originIdForName = (origin: string) => uuid(origin, uuid.DNS)

const trustedOriginIds = ['frame-extension', 'frame-internal'].map(originIdForName)

export const isTrustedOriginId = (originId: string) => trustedOriginIds.includes(originId)

export function getOriginDisplayName(origin: unknown): string {
  if (origin === FRAME_SEND_ORIGIN) return FRAME_SEND_DISPLAY_NAME
  return typeof origin === 'string' && origin.length > 0 ? origin : 'Unknown origin'
}
