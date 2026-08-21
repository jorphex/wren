import { z } from 'zod'

import {
  FRAME_SEND_ORIGIN,
  WREN_DEPLOY_ORIGIN,
  originIdForName
} from '../../../../../resources/domain/origin'

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validManagedOrigin = (value: unknown, name: string) => {
  if (!isRecord(value) || value['name'] !== name || value['provenance'] !== 'managed') return false
  if (value['sourceId'] !== undefined || value['sessionOnly'] !== false) return false
  const chain = value['chain']
  const session = value['session']
  return Boolean(
    isRecord(chain) &&
    chain['type'] === 'ethereum' &&
    Number.isSafeInteger(chain['id']) &&
    (chain['id'] as number) > 0 &&
    isRecord(session) &&
    typeof session['requests'] === 'number' &&
    session['requests'] >= 0 &&
    typeof session['startedAt'] === 'number' &&
    typeof session['lastUpdatedAt'] === 'number'
  )
}

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const { main } = parsed.data
  const origins = { ...(main.origins || {}) }
  const removed = new Set<string>()
  for (const name of [FRAME_SEND_ORIGIN, WREN_DEPLOY_ORIGIN]) {
    const originId = originIdForName(name)
    if (originId in origins && !validManagedOrigin(origins[originId], name)) {
      delete origins[originId]
      removed.add(originId)
    }
  }

  const permissions = Object.fromEntries(
    Object.entries(main.permissions || {}).map(([account, grants]) => [
      account,
      isRecord(grants)
        ? Object.fromEntries(Object.entries(grants).filter(([originId]) => !removed.has(originId)))
        : grants
    ])
  )

  return { ...parsed.data, main: { ...main, origins, permissions } }
}

export default { version: 72, migrate }
