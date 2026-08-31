const PRIVATE_ACTIVITY_REFERENCE_PATH = 'main.activityTransactionReferences'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withoutReferences = (value: unknown) => {
  if (!isRecord(value)) return value
  const { activityTransactionReferences: _privateReferences, ...visible } = value
  return visible
}

export const rendererVisibleState = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value['main'])) return value
  return { ...value, main: withoutReferences(value['main']) }
}

const rendererVisibleUpdate = (value: unknown) => {
  if (!isRecord(value) || typeof value['path'] !== 'string') return value
  const path = value['path']
  if (path === PRIVATE_ACTIVITY_REFERENCE_PATH || path.startsWith(`${PRIVATE_ACTIVITY_REFERENCE_PATH}.`)) {
    return
  }
  if (path === 'main') return { ...value, value: withoutReferences(value['value']) }
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
