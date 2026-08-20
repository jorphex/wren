import {
  YearnCatalogCacheSchema,
  YearnCatalogResultSchema,
  type YearnCatalogCache,
  type YearnCatalogResult
} from '../../resources/domain/yearn'
import { fetchWithTimeout, readJsonWithLimit } from '../../resources/utils/fetch'
import { YEARN_CATALOG } from './catalog'
import { normalizeKongCatalog } from './kong'

export const KONG_VAULT_LIST_URL = 'https://kong.yearn.fi/api/rest/list/vaults?origin=yearn'
export const CATALOG_TTL_MS = 15 * 60 * 1000
export const FETCH_TIMEOUT_MS = 15_000
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

type FetchLike = typeof fetch

interface YearnCatalogServiceDependencies {
  readCache: () => unknown
  writeCache: (cache: YearnCatalogCache) => void
  fetchImpl?: FetchLike
  now?: () => number
  endpoint?: string
  timeoutMs?: number
  onError?: (message: string) => void
}

const boundedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Yearn vault data is unavailable'
  return message.trim().slice(0, 240) || 'Yearn vault data is unavailable'
}

const unavailableResult = (message: string): YearnCatalogResult => {
  const { cache } = normalizeKongCatalog([], 0)
  return {
    status: 'unavailable',
    fetchedAt: null,
    vaults: cache.vaults,
    errors: YEARN_CATALOG.map(({ chainId }) => ({ chainId, message }))
  }
}

export function createYearnCatalogService({
  readCache,
  writeCache,
  fetchImpl = fetch,
  now = Date.now,
  endpoint = KONG_VAULT_LIST_URL,
  timeoutMs = FETCH_TIMEOUT_MS,
  onError = () => {}
}: YearnCatalogServiceDependencies) {
  let inFlight: Promise<YearnCatalogResult> | undefined

  const getCached = () => {
    const parsed = YearnCatalogCacheSchema.safeParse(readCache())
    return parsed.success ? parsed.data : undefined
  }

  const fetchCatalog = async (): Promise<YearnCatalogResult> => {
    const cached = getCached()
    try {
      const response = await fetchWithTimeout(
        endpoint,
        { headers: { accept: 'application/json' } },
        timeoutMs,
        fetchImpl
      )
      if (!response.ok) throw new Error(`Kong returned HTTP ${response.status}`)
      const payload = await readJsonWithLimit<unknown>(response, MAX_RESPONSE_BYTES)
      const normalized = normalizeKongCatalog(payload, now())
      writeCache(normalized.cache)
      return YearnCatalogResultSchema.parse({
        status: 'fresh',
        fetchedAt: normalized.cache.fetchedAt,
        vaults: normalized.cache.vaults,
        errors: normalized.errors
      })
    } catch (error) {
      const message = boundedError(error)
      onError(message)
      if (cached) {
        return {
          status: 'stale',
          fetchedAt: cached.fetchedAt,
          vaults: cached.vaults,
          errors: [{ message }]
        }
      }
      return unavailableResult(message)
    }
  }

  return {
    getCatalog: async ({
      force = false,
      cacheOnly = false
    }: { force?: boolean; cacheOnly?: boolean } = {}): Promise<YearnCatalogResult> => {
      const cached = getCached()
      const fresh = cached && now() - cached.fetchedAt < CATALOG_TTL_MS
      if (cacheOnly) {
        if (!cached) return unavailableResult('Yearn data is loading')
        return {
          status: fresh ? 'fresh' : 'stale',
          fetchedAt: cached.fetchedAt,
          vaults: cached.vaults,
          errors: []
        }
      }
      if (!force && fresh) {
        return {
          status: 'fresh',
          fetchedAt: cached.fetchedAt,
          vaults: cached.vaults,
          errors: []
        }
      }

      if (!inFlight) {
        inFlight = fetchCatalog().finally(() => {
          inFlight = undefined
        })
      }
      return inFlight
    }
  }
}
