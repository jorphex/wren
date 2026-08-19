import { MAX_RECENT_RECIPIENT_USES, RECENT_RECIPIENT_RETENTION_MS } from './constants'

const ADDRESS = /^0x[0-9a-f]{40}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export type ProjectedRecentRecipientUse = Readonly<{
  operationId: string
  address: string
  confirmedAt: number
}>

export function projectRecentRecipients(value: unknown, now = Date.now()): ProjectedRecentRecipientUse[] {
  if (!Array.isArray(value)) return []
  const cutoff = Math.max(0, now - RECENT_RECIPIENT_RETENTION_MS)
  const operations = new Set<string>()
  const addresses = new Set<string>()

  return value
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const record = candidate as Record<string, unknown>
      const operationId = record['operationId']
      const address = record['address']
      const confirmedAt = record['confirmedAt']
      if (
        Object.keys(record).length !== 3 ||
        typeof operationId !== 'string' ||
        !UUID.test(operationId) ||
        typeof address !== 'string' ||
        !ADDRESS.test(address) ||
        !Number.isInteger(confirmedAt) ||
        (confirmedAt as number) < cutoff ||
        (confirmedAt as number) > now
      ) {
        return []
      }
      return [record as ProjectedRecentRecipientUse]
    })
    .sort(
      (left, right) =>
        right.confirmedAt - left.confirmedAt || right.operationId.localeCompare(left.operationId)
    )
    .filter(({ operationId, address }) => {
      if (operations.has(operationId) || addresses.has(address)) return false
      operations.add(operationId)
      addresses.add(address)
      return true
    })
    .slice(0, MAX_RECENT_RECIPIENT_USES)
}
