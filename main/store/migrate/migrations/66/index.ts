import { z } from 'zod'

const StateSchema = z.object({ main: z.object({}).passthrough() }).passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial
  return { ...parsed.data, main: { ...parsed.data.main, dappGuardrails: {} } }
}

export default { version: 66, migrate }
