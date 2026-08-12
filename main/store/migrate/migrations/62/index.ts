import { z } from 'zod'
import { v4 as generateUuid } from 'uuid'

import { createDesktopAuthIdentity, DesktopAuthIdentitySchema } from '../../../../api/desktopAuthIdentity'

const StateSchema = z
  .object({
    main: z
      .object({
        origins: z.record(z.string(), z.unknown()).optional(),
        permissions: z.record(z.string(), z.unknown()).optional()
      })
      .passthrough()
  })
  .passthrough()

const companionOrigin = (value: unknown) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { provenance?: unknown }).provenance === 'companion'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial
  const { main } = parsed.data
  const existing = DesktopAuthIdentitySchema.safeParse(main['desktopAuthIdentity'])
  const companionOriginIds = new Set(
    Object.entries(main.origins || {})
      .filter(([, origin]) => companionOrigin(origin))
      .map(([originId]) => originId)
  )
  const origins = Object.fromEntries(
    Object.entries(main.origins || {}).filter(([originId]) => !companionOriginIds.has(originId))
  )
  const permissions = Object.fromEntries(
    Object.entries(main.permissions || {}).map(([account, grants]) => [
      account,
      isRecord(grants)
        ? Object.fromEntries(Object.entries(grants).filter(([originId]) => !companionOriginIds.has(originId)))
        : grants
    ])
  )
  return {
    ...parsed.data,
    main: {
      ...main,
      desktopAuthIdentity: existing.success ? existing.data : createDesktopAuthIdentity(generateUuid()),
      nativePeerCredentials: {},
      // Protocol-2 credentials contain a single key and cannot be upgraded to
      // the v3 control + page bundle without fresh user consent. Their
      // source-bound origins and grants must be removed with the credential.
      extensionCredentials: {},
      origins,
      permissions
    }
  }
}

export default { version: 62, migrate }
