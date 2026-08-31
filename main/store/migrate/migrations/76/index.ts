import { z } from 'zod'

import { ACTIVITY_RETENTION_MS, pruneActivity } from '../../../state/types/activity'
import {
  activityTransactionReferenceForOperation,
  pruneActivityTransactionReferences,
  recordActivityTransactionReference,
  type ActivityTransactionReferences
} from '../../../state/types/activityTransactionReference'
import { pruneOperationLifecycles } from '../../../state/types/operationLifecycle'
import { WalletCallBatchesSchema } from '../../../state/types/walletCallBatch'

const StateSchema = z
  .object({
    main: z
      .object({
        activity: z.unknown().optional(),
        activityTransactionReferences: z.unknown().optional(),
        operationLifecycles: z.unknown().optional(),
        walletCallBatches: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const now = Date.now()
  const activity = pruneActivity(parsed.data.main.activity, now)
  const operations = pruneOperationLifecycles(parsed.data.main.operationLifecycles, now)
  const parsedBatches = WalletCallBatchesSchema.safeParse(parsed.data.main.walletCallBatches)
  const batches = parsedBatches.success ? parsedBatches.data : {}
  let references: ActivityTransactionReferences = pruneActivityTransactionReferences(
    parsed.data.main.activityTransactionReferences,
    now
  )

  activity.forEach((entry) => {
    const operation = operations[entry.id]
    if (
      !operation ||
      operation.account !== entry.account ||
      operation.origin !== entry.origin ||
      operation.chainId !== entry.chainId ||
      operation.kind !== entry.type
    ) {
      return
    }
    const projected = activityTransactionReferenceForOperation(operation, batches)
    if (!projected) return
    const updatedAt = Math.max(projected.updatedAt, entry.completedAt)
    references = recordActivityTransactionReference(
      references,
      {
        ...projected,
        updatedAt,
        expiresAt: updatedAt + ACTIVITY_RETENTION_MS
      },
      now
    )
  })

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      activityTransactionReferences: references
    }
  }
}

export default { version: 76, migrate }
