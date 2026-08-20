import { z } from 'zod'

const StateSchema = z
  .object({
    main: z
      .object({
        networksMeta: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validRateValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const networksMeta = parsed.data.main.networksMeta
  if (!isRecord(networksMeta) || !isRecord(networksMeta['ethereum'])) return parsed.data

  let changed = false
  const ethereum = Object.fromEntries(
    Object.entries(networksMeta['ethereum']).map(([chainId, metadata]) => {
      if (!isRecord(metadata) || !isRecord(metadata['nativeCurrency'])) return [chainId, metadata]

      const nativeCurrency = metadata['nativeCurrency']
      const savedRate = isRecord(nativeCurrency['usd']) ? nativeCurrency['usd'] : {}
      const price = validRateValue(savedRate['price']) ? savedRate['price'] : 0
      const change24hr = validRateValue(savedRate['change24hr']) ? savedRate['change24hr'] : 0
      if (savedRate['price'] === price && savedRate['change24hr'] === change24hr) {
        return [chainId, metadata]
      }

      changed = true
      return [
        chainId,
        {
          ...metadata,
          nativeCurrency: {
            ...nativeCurrency,
            usd: { ...savedRate, price, change24hr }
          }
        }
      ]
    })
  )

  if (!changed) return parsed.data
  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      networksMeta: { ...networksMeta, ethereum }
    }
  }
}

export default { version: 70, migrate }
