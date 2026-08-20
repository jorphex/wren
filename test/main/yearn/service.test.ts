import { normalizeKongCatalog } from '../../../main/yearn/kong'
import { CATALOG_TTL_MS, createYearnCatalogService } from '../../../main/yearn/service'
import { makeKongVaultList } from './fixtures'

const cachedCatalog = (fetchedAt: number) => normalizeKongCatalog(makeKongVaultList(), fetchedAt).cache

describe('Yearn catalog service', () => {
  it('uses a fresh validated cache without a network request', async () => {
    const fetchImpl = jest.fn()
    const service = createYearnCatalogService({
      readCache: () => cachedCatalog(10_000),
      writeCache: jest.fn(),
      fetchImpl,
      now: () => 10_000 + CATALOG_TTL_MS - 1
    })

    await expect(service.getCatalog()).resolves.toMatchObject({ status: 'fresh', fetchedAt: 10_000 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns stale cached data immediately without starting a refresh', async () => {
    const fetchImpl = jest.fn()
    const cache = cachedCatalog(10_000)
    const service = createYearnCatalogService({
      readCache: () => cache,
      writeCache: jest.fn(),
      fetchImpl,
      now: () => 10_000 + CATALOG_TTL_MS
    })

    await expect(service.getCatalog({ cacheOnly: true })).resolves.toMatchObject({
      status: 'stale',
      fetchedAt: 10_000,
      vaults: cache.vaults
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns the bundled unavailable catalog immediately when no cache exists', async () => {
    const fetchImpl = jest.fn()
    const service = createYearnCatalogService({
      readCache: () => null,
      writeCache: jest.fn(),
      fetchImpl
    })

    const result = await service.getCatalog({ cacheOnly: true })

    expect(result).toMatchObject({ status: 'unavailable', fetchedAt: null })
    expect(result.vaults).toHaveLength(8)
    expect(result.vaults.every(({ status }) => status === 'unavailable')).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes stale data, validates it, and deduplicates concurrent requests', async () => {
    const writeCache = jest.fn()
    const fetchImpl = jest.fn(
      async () =>
        new Response(JSON.stringify(makeKongVaultList()), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const service = createYearnCatalogService({
      readCache: () => null,
      writeCache,
      fetchImpl,
      now: () => 20_000
    })

    const [first, second] = await Promise.all([service.getCatalog(), service.getCatalog()])

    expect(first).toEqual(second)
    expect(first).toMatchObject({ status: 'fresh', fetchedAt: 20_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(writeCache).toHaveBeenCalledTimes(1)
  })

  it('returns timestamped stale data when refresh fails', async () => {
    const cache = cachedCatalog(10_000)
    const service = createYearnCatalogService({
      readCache: () => cache,
      writeCache: jest.fn(),
      fetchImpl: jest.fn(async () => new Response('', { status: 503 })),
      now: () => 10_000 + CATALOG_TTL_MS
    })

    await expect(service.getCatalog()).resolves.toMatchObject({
      status: 'stale',
      fetchedAt: 10_000,
      vaults: cache.vaults,
      errors: [{ message: 'Kong returned HTTP 503' }]
    })
  })

  it('fails closed with chain-isolated unavailable entries when no cache exists', async () => {
    const service = createYearnCatalogService({
      readCache: () => null,
      writeCache: jest.fn(),
      fetchImpl: jest.fn(async () => {
        throw new Error('offline')
      })
    })

    const result = await service.getCatalog()

    expect(result.status).toBe('unavailable')
    expect(result.fetchedAt).toBeNull()
    expect(result.vaults).toHaveLength(8)
    expect(result.vaults.every(({ status }) => status === 'unavailable')).toBe(true)
    expect(new Set(result.errors.map(({ chainId }) => chainId))).toEqual(new Set([1, 8453, 747474]))
  })
})
