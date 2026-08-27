import { z } from 'zod'

const StateSchema = z
  .object({
    main: z.object({ colorwayPrimary: z.unknown().optional() }).passthrough()
  })
  .passthrough()

const canonicalColorwayPrimary = () => ({
  dark: {
    background: 'rgb(17, 21, 19)',
    text: 'rgb(231, 238, 232)'
  },
  light: {
    background: 'rgb(17, 21, 19)',
    text: 'rgb(231, 238, 232)'
  }
})

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      colorwayPrimary: canonicalColorwayPrimary()
    }
  }
}

export default { version: 74, migrate }
