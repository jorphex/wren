import { z } from 'zod'

import { WREN_EXTENSION_ORIGIN, originIdForName } from '../../../../../resources/domain/origin'

const StateSchema = z
  .object({
    main: z
      .object({
        origins: z.record(z.string(), z.unknown()).optional()
      })
      .passthrough()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const { main } = parsed.data
  const originId = originIdForName(WREN_EXTENSION_ORIGIN)
  const origin = main.origins?.[originId]
  // Only the legacy record at Wren's deterministic internal identity can
  // have originated from the pre-provenance Companion control channel.
  if (
    !isRecord(origin) ||
    origin['name'] !== WREN_EXTENSION_ORIGIN ||
    origin['provenance'] !== 'legacy' ||
    origin['sourceId'] !== undefined
  ) {
    return parsed.data
  }

  return {
    ...parsed.data,
    main: {
      ...main,
      origins: { ...main.origins, [originId]: { ...origin, provenance: 'internal' } }
    }
  }
}

export default { version: 73, migrate }
