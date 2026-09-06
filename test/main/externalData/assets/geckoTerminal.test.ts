import {
  createGeckoTerminalPrices,
  GECKO_REQUEST_INTERVAL_MS,
  GECKO_QUOTE_TTL_MS,
  GECKO_POOL_TTL_MS,
  MIN_POOL_LIQUIDITY_USD
} from '../../../../main/externalData/assets/geckoTerminal'

const token = `0x${'1'.repeat(40)}`
const other = `0x${'2'.repeat(40)}`
const identifier = `ethereum:${token}`
const response = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify({ data }), { status, headers })
const pool = (id: number, liquidity = 20000, price = '2', side = 'base', network = 'eth') => {
  const address = `0x${id.toString(16).padStart(40, '0')}`
  return {
    id: `${network}_${address}`,
    attributes: {
      address,
      reserve_in_usd: String(liquidity),
      volume_usd: { h24: '1000' },
      transactions: { h24: { buys: 1, sells: 2 } },
      base_token_price_usd: side === 'base' ? price : '999',
      quote_token_price_usd: side === 'quote' ? price : '999'
    },
    relationships: {
      base_token: { data: { id: `${network}_${side === 'base' ? token : other}` } },
      quote_token: { data: { id: `${network}_${side === 'quote' ? token : other}` } }
    }
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(1_800_000_000_000)
})
afterEach(() => {
  jest.useRealTimers()
})
const finish = async <T>(promise: Promise<T>) => {
  await jest.runAllTimersAsync()
  return promise
}

test('selects maximum eligible liquidity across pages and reads the correct quote side', async () => {
  const first = Array.from({ length: 20 }, (_, index) => pool(index + 10, 20000, '1'))
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(response(first))
    .mockResolvedValueOnce(response([pool(50, 50000, '3', 'quote')]))
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(await finish(load([identifier]))).toEqual({ [identifier]: { price: 3 } })
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(fetchImpl.mock.calls[1][0]).toContain('page=2')
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
})

test('rejects thin, inactive, unrelated and invalid-price pools without fabricating a change', async () => {
  const inactive = pool(2, 999999)
  inactive.attributes.transactions.h24 = { buys: 0, sells: 0 }
  const noVolume = pool(3, 999999)
  noVolume.attributes.volume_usd.h24 = '0'
  const unrelated = pool(4, 999999)
  unrelated.relationships.base_token.data.id = `eth_${other}`
  const fetchImpl = jest.fn(async () =>
    response([
      pool(1, MIN_POOL_LIQUIDITY_USD - 1),
      inactive,
      noVolume,
      unrelated,
      pool(5, 999999, 'NaN'),
      pool(6, 999999, '-1'),
      pool(7, 999999, '0'),
      pool(8, 20000, '4')
    ])
  )
  expect(await finish(createGeckoTerminalPrices(fetchImpl)([identifier]))).toEqual({
    [identifier]: { price: 4 }
  })
})

test('caches quotes and batches selected pools for refresh, then rediscovers after expiry', async () => {
  const fetchImpl = jest.fn(async () => response([pool(1)]))
  const load = createGeckoTerminalPrices(fetchImpl)
  await finish(load([identifier, `ethereum:${other}`]))
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  await finish(load([identifier, `ethereum:${other}`]))
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  jest.advanceTimersByTime(GECKO_QUOTE_TTL_MS)
  await finish(load([identifier, `ethereum:${other}`]))
  expect(fetchImpl).toHaveBeenCalledTimes(3)
  expect(fetchImpl.mock.calls[2][0]).toContain('/pools/multi/')
  jest.advanceTimersByTime(GECKO_POOL_TTL_MS)
  await finish(load([identifier]))
  expect(fetchImpl.mock.calls[3][0]).toContain('/tokens/')
})

test('negative caches missing pools and makes no requests for unsupported or malformed identifiers', async () => {
  const fetchImpl = jest.fn(async () => response([], 404))
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(
    await finish(
      load(['coingecko:ethereum', `unknown:${token}`, 'ethereum:../../secret', `${identifier}:extra`])
    )
  ).toEqual({})
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(await finish(load([identifier, identifier]))).toEqual({})
  await finish(load([identifier]))
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(GECKO_QUOTE_TTL_MS)
  await finish(load([identifier]))
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('shares request pacing across concurrent calls and respects Retry-After', async () => {
  const starts: number[] = []
  const fetchImpl = jest.fn(async () => {
    starts.push(Date.now())
    return response([], 429, { 'retry-after': '120' })
  })
  const load = createGeckoTerminalPrices(fetchImpl)
  await finish(Promise.all([load([identifier]), load([`base:${token}`])]))
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(119_000)
  await finish(load([identifier]))
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(1000)
  await finish(load([identifier]))
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(120_000)
  expect(GECKO_REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(6000)
})

test('paces requests across networks and keeps their cache entries separate', async () => {
  const starts: number[] = []
  const fetchImpl = jest.fn(async (url: string | URL | Request) => {
    starts.push(Date.now())
    const base = String(url).includes('/base/')
    return response([pool(1, 20000, base ? '7' : '2', 'base', base ? 'base' : 'eth')])
  })
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(await finish(load([identifier, `base:${token}`]))).toEqual({
    [identifier]: { price: 2 },
    [`base:${token}`]: { price: 7 }
  })
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(GECKO_REQUEST_INTERVAL_MS)
})

test('aborts a queued request without fetching it', async () => {
  const fetchImpl = jest.fn(async () => response([]))
  const load = createGeckoTerminalPrices(fetchImpl)
  await finish(load([identifier]))
  const controller = new AbortController()
  const pending = load([`base:${token}`], controller.signal)
  const rejection = expect(pending).rejects.toThrow('changed')
  await jest.advanceTimersByTimeAsync(0)
  controller.abort(new Error('changed'))
  await rejection
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('bounds body reads and cancels an active response stream', async () => {
  const fetchImpl = jest.fn(
    async (_url, options) =>
      new Response(
        new ReadableStream({
          start(stream) {
            options.signal.addEventListener('abort', () => stream.error(options.signal.reason), {
              once: true
            })
          }
        })
      )
  )
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(await finish(load([identifier]))).toEqual({})
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  const pending = load([identifier], controller.signal)
  const rejection = expect(pending).rejects.toThrow('stopped')
  await jest.advanceTimersByTimeAsync(GECKO_REQUEST_INTERVAL_MS)
  controller.abort(new Error('stopped'))
  await rejection
})

test('bounds discovery to ten pages and accepts 32-byte pool IDs', async () => {
  let page = 0
  const fetchImpl = jest.fn(async () => {
    page++
    return response(
      Array.from({ length: 20 }, (_, index) => {
        const candidate = pool(page * 20 + index, 20000 + page, String(page))
        candidate.attributes.address = `0x${(page * 20 + index).toString(16).padStart(64, '0')}`
        candidate.id = `eth_${candidate.attributes.address}`
        return candidate
      })
    )
  })
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(await finish(load([identifier]))).toEqual({ [identifier]: { price: 10 } })
  expect(fetchImpl).toHaveBeenCalledTimes(10)
})

test('ignores malformed pool fields and oversized responses', async () => {
  const malformed = { ...pool(1), attributes: { address: 123 } }
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(response([malformed, pool(2)]))
    .mockResolvedValueOnce(response([pool(3)], 200, { 'content-length': String(1024 * 1024 + 1) }))
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(await finish(load([identifier]))).toEqual({ [identifier]: { price: 2 } })
  jest.advanceTimersByTime(GECKO_QUOTE_TTL_MS)
  expect(await finish(load([identifier]))).toEqual({})
})

test('does not retain a partial discovery when a later page fails', async () => {
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(response(Array.from({ length: 20 }, (_, index) => pool(index + 10))))
    .mockResolvedValueOnce(response([], 503))
    .mockResolvedValueOnce(response([pool(1, 50000, '8')]))
  const load = createGeckoTerminalPrices(fetchImpl)
  expect(await finish(load([identifier]))).toEqual({})
  expect(await finish(load([identifier]))).toEqual({ [identifier]: { price: 8 } })
})

test('publishes a token price while another token is still queued', async () => {
  const fetchImpl = jest.fn(async () => response([pool(1)]))
  const publish = jest.fn()
  const load = createGeckoTerminalPrices(fetchImpl)
  const pending = load([identifier, `ethereum:${other}`], undefined, publish)
  await jest.advanceTimersByTimeAsync(0)
  expect(publish).toHaveBeenCalledWith({ [identifier]: { price: 2 } })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  await finish(pending)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test.each([404, 429, 503])(
  'closes an unfinished HTTP %s body before releasing the request',
  async (status) => {
    const cancel = jest.fn()
    let signal!: AbortSignal
    const fetchImpl = jest.fn(async (_url, options) => {
      signal = options.signal
      return new Response(new ReadableStream({ cancel }), { status })
    })
    const load = createGeckoTerminalPrices(fetchImpl)
    expect(await finish(load([identifier]))).toEqual({})
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  }
)
