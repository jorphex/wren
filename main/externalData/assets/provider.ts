import { readJsonWithLimit } from '../../../resources/utils/fetch'

export const DEFI_LLAMA_PRICE_URL = 'https://coins.llama.fi'
export const PRICE_REQUEST_TIMEOUT_MS = 10_000
export const MAX_PRICE_RESPONSE_BYTES = 1024 * 1024
export const MAX_IDENTIFIERS_PER_REQUEST = 75
const PRICE_IDENTIFIER_PATTERN = /^(?:coingecko:[a-z0-9-]+|[a-z0-9-]+:0x[0-9a-f]{40})$/u

export interface ExternalPrice {
  price: number
  change24hr: number
}

interface RawQuote {
  price: number
}

type FetchLike = typeof fetch

const chunks = <T>(values: T[], size: number) => {
  const result: T[][] = []
  for (let offset = 0; offset < values.length; offset += size)
    result.push(values.slice(offset, offset + size))
  return result
}

const parseQuotes = (payload: unknown): Record<string, RawQuote> => {
  if (!payload || typeof payload !== 'object') return {}
  const coins = Reflect.get(payload, 'coins')
  if (!coins || typeof coins !== 'object') return {}

  return Object.entries(coins).reduce<Record<string, RawQuote>>((quotes, [identifier, value]) => {
    if (value && typeof value === 'object') {
      const price = Reflect.get(value, 'price')
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) quotes[identifier] = { price }
    }
    return quotes
  }, {})
}

async function requestQuotes(
  path: 'current' | `historical/${number}`,
  identifiers: string[],
  fetchImpl: FetchLike,
  signal?: AbortSignal
) {
  const quotes: Record<string, RawQuote> = {}

  // Sequential chunks cap both request concurrency and response memory.
  for (const batch of chunks(identifiers, MAX_IDENTIFIERS_PER_REQUEST)) {
    if (signal?.aborted) throw signal.reason

    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new Error('DefiLlama request timed out')),
      PRICE_REQUEST_TIMEOUT_MS
    )

    try {
      const response = await fetchImpl(`${DEFI_LLAMA_PRICE_URL}/prices/${path}/${batch.join(',')}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`DefiLlama returned HTTP ${response.status}`)
      Object.assign(quotes, parseQuotes(await readJsonWithLimit<unknown>(response, MAX_PRICE_RESPONSE_BYTES)))
    } catch (error) {
      if (signal?.aborted) throw signal.reason
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  return quotes
}

export async function loadDefiLlamaPrices(
  identifiers: string[],
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
  signal?: AbortSignal
): Promise<Record<string, ExternalPrice>> {
  const unique = [...new Set(identifiers)].filter((identifier) => PRICE_IDENTIFIER_PATTERN.test(identifier))
  if (unique.length === 0) return {}

  const current = await requestQuotes('current', unique, fetchImpl, signal)
  if (Object.keys(current).length === 0) throw new Error('DefiLlama returned no current prices')

  const historical = await requestQuotes(
    `historical/${Math.floor(now() / 1000) - 24 * 60 * 60}`,
    unique,
    fetchImpl,
    signal
  )

  return Object.entries(current).reduce<Record<string, ExternalPrice>>((prices, [identifier, quote]) => {
    const previous = historical[identifier]?.price
    const change24hr = previous && previous > 0 ? ((quote.price - previous) / previous) * 100 : 0
    prices[identifier] = { price: quote.price, change24hr }
    return prices
  }, {})
}
