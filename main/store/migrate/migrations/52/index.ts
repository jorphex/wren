import { z } from 'zod'

const StateSchema = z
  .object({
    main: z
      .object({
        _version: z.number()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      colorway: 'dark',
      glideSide: parsed.data.main['glideSide'] === 'left' ? 'left' : 'right'
    }
  }
}

export default { version: 52, migrate }
