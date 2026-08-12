import { z } from 'zod'
import { pruneActivity } from '../../../state/types/activity'

const StateSchema = z
  .object({
    main: z.object({}).passthrough(),
    panel: z
      .object({
        account: z
          .object({
            moduleOrder: z.array(z.unknown())
          })
          .passthrough()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const panel = parsed.data.panel
  const moduleOrder = panel?.account.moduleOrder
  const balancesIndex = moduleOrder?.indexOf('balances') ?? -1
  const nextOrder = moduleOrder?.filter((moduleName) => moduleName !== 'activity')
  if (nextOrder && balancesIndex >= 0) nextOrder.splice(balancesIndex + 1, 0, 'activity')

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      activity: pruneActivity(parsed.data.main['activity'])
    },
    ...(panel && nextOrder
      ? {
          panel: {
            ...panel,
            account: { ...panel.account, moduleOrder: nextOrder }
          }
        }
      : {})
  }
}

export default { version: 59, migrate }
