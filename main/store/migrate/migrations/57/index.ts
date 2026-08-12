import { v4 as generateUuid, validate as isUuid } from 'uuid'
import { z } from 'zod'

const StateSchema = z
  .object({
    main: z
      .object({
        instanceId: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const { main } = parsed.data
  return {
    ...parsed.data,
    main: {
      ...main,
      instanceId:
        typeof main.instanceId === 'string' && isUuid(main.instanceId) ? main.instanceId : generateUuid()
    }
  }
}

export default { version: 57, migrate }
