const PRIVATE_MAIN_PATHS = new Set([
  'main.activityClearedAt',
  'main.activityTransactionReferences',
  'main.accountActivityCursors'
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const activitySummary = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(activitySummary)
  if (!isRecord(value) || !isRecord(value['observed'])) return value
  const observed = value['observed']
  return { ...value, observed: { action: observed['action'], source: observed['source'] } }
}

const withoutPrivateActivityState = (value: unknown) => {
  if (!isRecord(value)) return value
  const {
    accountActivityCursors: _privateActivityCursors,
    activityClearedAt: _privateClearBoundary,
    activityTransactionReferences: _privateReferences,
    ...visible
  } = value
  return 'activity' in visible ? { ...visible, activity: activitySummary(visible['activity']) } : visible
}

export const rendererVisibleState = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value['main'])) return value
  return { ...value, main: withoutPrivateActivityState(value['main']) }
}

const rendererVisibleUpdate = (value: unknown) => {
  if (!isRecord(value) || typeof value['path'] !== 'string') return value
  const path = value['path']
  if (
    [...PRIVATE_MAIN_PATHS].some((privatePath) => path === privatePath || path.startsWith(`${privatePath}.`))
  ) {
    return
  }
  if (/^main\.activity(?:\.|$)/u.test(path)) {
    const field = path.split('.observed.')[1]
    if (field && !['action', 'source'].includes(field)) return
    if (path.endsWith('.observed'))
      return {
        ...value,
        value: (activitySummary({ observed: value['value'] }) as Record<string, unknown>)['observed']
      }
    return { ...value, value: activitySummary(value['value']) }
  }
  if (path === 'main') return { ...value, value: withoutPrivateActivityState(value['value']) }
  return value
}

export const rendererVisibleActions = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((action) => {
    if (!isRecord(action) || !Array.isArray(action['updates'])) return []
    const updates = action['updates'].flatMap((update) => {
      const visible = rendererVisibleUpdate(update)
      return visible === undefined ? [] : [visible]
    })
    return updates.length ? [{ ...action, updates }] : []
  })
}
