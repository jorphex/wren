import { z } from 'zod'

import { StoredYearnCatalogCacheSchema, YearnWorkflowsSchema } from '../../../../resources/domain/yearn'

export const YearnStateSchema = z
  .object({
    catalogCache: StoredYearnCatalogCacheSchema.nullable(),
    workflows: YearnWorkflowsSchema
  })
  .strict()

export type YearnState = z.infer<typeof YearnStateSchema>
