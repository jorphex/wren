import { z } from 'zod'

const StateSchema = z
  .object({
    panel: z
      .object({
        account: z
          .object({
            moduleOrder: z.array(z.unknown())
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const { panel } = parsed.data
  return {
    ...parsed.data,
    panel: {
      ...panel,
      account: {
        ...panel.account,
        moduleOrder: panel.account.moduleOrder.filter((moduleName) => moduleName !== 'activity')
      }
    }
  }
}

export default { version: 56, migrate }
