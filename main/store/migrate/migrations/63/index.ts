import { z } from 'zod'

import { ActivityEntrySchema } from '../../../state/types/activity'

const StateSchema = z.object({ main: z.object({}).passthrough() }).passthrough()

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const activity = Array.isArray(parsed.data.main['activity'])
    ? parsed.data.main['activity'].map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value
        const { transactionHash: _transactionHash, ...entry } = value as Record<string, unknown>
        return { ...entry, outcome: entry['outcome'] === 'dropped' ? 'replaced' : entry['outcome'] }
      })
    : parsed.data.main['activity']

  const normalizedActivity = Array.isArray(activity)
    ? activity
        .flatMap((value) => {
          const normalized = ActivityEntrySchema.safeParse(value)
          return normalized.success ? [normalized.data] : []
        })
        .sort((left, right) => right.completedAt - left.completedAt || right.id.localeCompare(left.id))
        .slice(0, 500)
    : []

  return {
    ...parsed.data,
    main: { ...parsed.data.main, activity: normalizedActivity }
  }
}

export default { version: 63, migrate }
