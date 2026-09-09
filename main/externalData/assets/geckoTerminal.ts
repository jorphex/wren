import { readJsonWithLimit } from '../../../resources/utils/fetch'
import { MAX_PRICE_RESPONSE_BYTES, PRICE_REQUEST_TIMEOUT_MS, type ExternalPrice } from './provider'

export const GECKO_TERMINAL_URL = 'https://api.geckoterminal.com/api/v2'
export const GECKO_REQUEST_INTERVAL_MS = 6500
export const GECKO_QUOTE_TTL_MS = 5 * 60 * 1000
export const GECKO_POOL_TTL_MS = 30 * 60 * 1000
export const MIN_POOL_LIQUIDITY_USD = 10_000
const MAX_CACHE_ENTRIES = 1000
const MAX_POOL_PAGES = 10
const NETWORKS: Record<string, string> = {
  ethereum: 'eth',
  optimism: 'optimism',
  xdai: 'xdai',
  polygon: 'polygon_pos',
  base: 'base',
  arbitrum: 'arbitrum',
  katana: 'katana',
  robinhood: 'robinhood'
}
const ADDRESS = /^0x[0-9a-f]{40}$/u
const POOL_ADDRESS = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u

type Pool = {
  id?: string
  attributes?: {
    address?: string
    reserve_in_usd?: string
    volume_usd?: { h24?: string }
    transactions?: { h24?: { buys?: number; sells?: number } }
    base_token_price_usd?: string
    quote_token_price_usd?: string
  }
  relationships?: {
    base_token?: { data?: { id?: string } }
    quote_token?: { data?: { id?: string } }
  }
}
type Target = { identifier: string; network: string; address: string }
type Cached = {
  pool?: string | undefined
  selectedAt: number
  checkedAt: number
  quote?: ExternalPrice | undefined
}

const positive = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function poolQuote(
  pool: Pool,
  target: Target
): { pool: string; liquidity: number; price: number } | undefined {
  const attrs = pool?.attributes
  const address = typeof attrs?.address === 'string' ? attrs.address.toLowerCase() : undefined
  if (!address || !POOL_ADDRESS.test(address) || pool.id !== `${target.network}_${address}`) return
  const liquidity = positive(attrs?.reserve_in_usd)
  if (!liquidity || liquidity < MIN_POOL_LIQUIDITY_USD || !positive(attrs?.volume_usd?.h24)) return
  const trades = attrs?.transactions?.h24
  if (!positive(trades?.buys) && !positive(trades?.sells)) return
  const tokenId = `${target.network}_${target.address}`
  const side =
    pool.relationships?.base_token?.data?.id === tokenId
      ? 'base'
      : pool.relationships?.quote_token?.data?.id === tokenId
        ? 'quote'
        : undefined
  const price = side && positive(attrs?.[`${side}_token_price_usd`])
  if (!price) return
  return { pool: address, liquidity, price }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

// One instance is shared by the desktop process. No wallet address is sent.
export function createGeckoTerminalPrices(fetchImpl: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, Cached>()
  let queue: Promise<unknown> = Promise.resolve()
  let nextRequestAt = 0
  let blockedUntil = 0
  let failures = 0

  const save = (identifier: string, value: Cached) => {
    cache.delete(identifier)
    cache.set(identifier, value)
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
  }

  function request(path: string, signal?: AbortSignal): Promise<Pool[]> {
    const result = queue.then(async () => {
      signal?.throwIfAborted()
      if (now() < blockedUntil) throw new Error('GeckoTerminal is backing off')
      await wait(Math.max(0, nextRequestAt - now()), signal)
      signal?.throwIfAborted()
      nextRequestAt = now() + GECKO_REQUEST_INTERVAL_MS
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(
        () => controller.abort(new Error('GeckoTerminal request timed out')),
        PRICE_REQUEST_TIMEOUT_MS
      )
      try {
        const response = await fetchImpl(`${GECKO_TERMINAL_URL}${path}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error'
        })
        if (response.status === 429) {
          const retry = response.headers.get('retry-after')
          const seconds = retry && /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : 0
          const date = retry ? Date.parse(retry) - now() : 0
          blockedUntil =
            now() + Math.max(60_000 * 2 ** Math.min(failures++, 5), seconds, Number.isFinite(date) ? date : 0)
        }
        if (!response.ok) {
          // Do not leave an error response streaming after releasing the queue.
          controller.abort()
          void response.body?.cancel().catch(() => undefined)
          // A token with no indexed pools is a normal negative cache entry.
          if (response.status === 404) return []
          throw new Error(`GeckoTerminal returned HTTP ${response.status}`)
        }
        const payload = await readJsonWithLimit<{ data?: unknown }>(response, MAX_PRICE_RESPONSE_BYTES)
        if (!payload || !Array.isArray(payload.data)) throw new Error('Invalid GeckoTerminal pools')
        failures = 0
        return payload.data.filter((pool): pool is Pool => !!pool && typeof pool === 'object')
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
    })
    queue = result.catch(() => undefined)
    return result
  }

  async function discover(target: Target, signal?: AbortSignal) {
    let best: ReturnType<typeof poolQuote>
    const seen = new Set<string>()
    for (let page = 1; page <= MAX_POOL_PAGES; page++) {
      const pools = await request(
        `/networks/${target.network}/tokens/${target.address}/pools?page=${page}`,
        signal
      )
      let added = false
      for (const pool of pools.slice(0, 20)) {
        if (typeof pool.id !== 'string' || seen.has(pool.id)) continue
        seen.add(pool.id)
        added = true
        const candidate = poolQuote(pool, target)
        if (candidate && (!best || candidate.liquidity > best.liquidity)) best = candidate
      }
      if (pools.length < 20 || !added) break
    }
    const quote = best ? { price: best.price } : undefined
    save(target.identifier, { pool: best?.pool, quote, selectedAt: now(), checkedAt: now() })
    return quote
  }

  return async (
    identifiers: string[],
    signal?: AbortSignal,
    onPrices?: (prices: Record<string, ExternalPrice>) => void
  ): Promise<Record<string, ExternalPrice>> => {
    const prices: Record<string, ExternalPrice> = {}
    const refresh = new Map<string, Target[]>()
    const discovery: Target[] = []
    for (const identifier of new Set(identifiers)) {
      const [chain, address, extra] = identifier.split(':')
      const network =
        chain && Object.prototype.hasOwnProperty.call(NETWORKS, chain) ? NETWORKS[chain] : undefined
      if (!network || !address || extra !== undefined || !ADDRESS.test(address)) continue
      const target = { identifier, network, address }
      const cached = cache.get(identifier)
      if (cached && now() - cached.checkedAt < GECKO_QUOTE_TTL_MS) {
        if (cached.quote) prices[identifier] = cached.quote
      } else if (cached?.pool && now() - cached.selectedAt < GECKO_POOL_TTL_MS) {
        refresh.set(network, [...(refresh.get(network) || []), target])
      } else discovery.push(target)
    }
    if (Object.keys(prices).length) onPrices?.({ ...prices })
    for (const [network, targets] of refresh) {
      for (let offset = 0; offset < targets.length; offset += 30) {
        const batch = targets
          .slice(offset, offset + 30)
          .map((target) => ({ ...target, cached: cache.get(target.identifier) }))
          .filter((target) => target.cached?.pool)
        if (!batch.length) continue
        const addresses = [...new Set(batch.map((target) => target.cached!.pool!))]
        try {
          const pools = await request(`/networks/${network}/pools/multi/${addresses.join(',')}`, signal)
          for (const target of batch) {
            const cached = target.cached!
            const pool = pools.find((pool) => pool.id === `${network}_${cached.pool}`)
            const candidate = pool && poolQuote(pool, target)
            const quote = candidate ? { price: candidate.price } : undefined
            save(target.identifier, {
              ...cached,
              quote,
              checkedAt: now(),
              ...(!quote ? { pool: undefined } : {})
            })
            if (quote) {
              prices[target.identifier] = quote
              onPrices?.({ [target.identifier]: quote })
            }
          }
        } catch {
          signal?.throwIfAborted()
        }
      }
    }
    for (const target of discovery) {
      signal?.throwIfAborted()
      if (now() < blockedUntil) break
      try {
        const quote = await discover(target, signal)
        if (quote) {
          prices[target.identifier] = quote
          onPrices?.({ [target.identifier]: quote })
        }
      } catch {
        signal?.throwIfAborted()
      }
    }
    signal?.throwIfAborted()
    return prices
  }
}

export const loadGeckoTerminalPrices = createGeckoTerminalPrices()
