import { z } from 'zod'

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

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const { main } = parsed.data
  const origins = Object.fromEntries(
    Object.entries(main.origins || {}).map(([id, rawOrigin]) => {
      if (!rawOrigin || typeof rawOrigin !== 'object' || Array.isArray(rawOrigin)) return [id, rawOrigin]
      return [id, { ...rawOrigin, provenance: 'legacy' }]
    })
  )

  return {
    ...parsed.data,
    main: {
      ...main,
      origins,
      // Legacy grants had neither finite scope nor authenticated transport provenance.
      // Requiring fresh consent is the only fail-closed migration to scoped capabilities.
      permissions: {}
    }
  }
}

export default { version: 58, migrate }
