import {
  DEFI_LLAMA_PRICE_URL,
  loadDefiLlamaPrices,
  MAX_IDENTIFIERS_PER_REQUEST
} from '../../../../main/externalData/assets/provider'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

test('loads current and historical prices and calculates the 24-hour change', async () => {
  const fetchImpl = jest.fn(async (url: string | URL | Request) => {
    const requestUrl = String(url)
    if (requestUrl.includes('/prices/current/')) {
      return jsonResponse({ coins: { 'coingecko:ethereum': { price: 120 } } })
    }
    return jsonResponse({ coins: { 'coingecko:ethereum': { price: 100 } } })
  }) as unknown as typeof fetch

  await expect(loadDefiLlamaPrices(['coingecko:ethereum'], fetchImpl, () => 200_000_000)).resolves.toEqual({
    'coingecko:ethereum': { price: 120, change24hr: 20 }
  })

  expect(fetchImpl).toHaveBeenCalledWith(
    `${DEFI_LLAMA_PRICE_URL}/prices/current/coingecko:ethereum`,
    expect.objectContaining({ headers: { accept: 'application/json' }, signal: expect.any(AbortSignal) })
  )
  expect(fetchImpl).toHaveBeenCalledWith(
    `${DEFI_LLAMA_PRICE_URL}/prices/historical/113600/coingecko:ethereum`,
    expect.objectContaining({ headers: { accept: 'application/json' }, signal: expect.any(AbortSignal) })
  )
})

test('keeps current prices when historical data is unavailable', async () => {
  const identifier = `ethereum:0x${'1'.repeat(40)}`
  const fetchImpl = jest.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/prices/current/')) {
      return jsonResponse({ coins: { [identifier]: { price: 2 } } })
    }
    return jsonResponse({}, 503)
  }) as unknown as typeof fetch

  await expect(loadDefiLlamaPrices([identifier], fetchImpl)).resolves.toEqual({
    [identifier]: { price: 2, change24hr: 0 }
  })
})

test('deduplicates and bounds identifiers per request', async () => {
  const identifiers = Array.from(
    { length: MAX_IDENTIFIERS_PER_REQUEST + 1 },
    (_, index) => `ethereum:0x${index.toString(16).padStart(40, '0')}`
  )
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ coins: { [identifiers[0]]: { price: 1 } } })
  ) as unknown as typeof fetch

  await loadDefiLlamaPrices([...identifiers, identifiers[0]], fetchImpl)

  expect(fetchImpl).toHaveBeenCalledTimes(4)
  expect(fetchImpl.mock.calls.every(([url]) => String(url).length < 4096)).toBe(true)
})

test('rejects malformed or empty current responses', async () => {
  const identifier = `ethereum:0x${'2'.repeat(40)}`
  const fetchImpl = jest.fn(async () =>
    jsonResponse({ coins: { [identifier]: { price: 'not-a-number' } } })
  ) as unknown as typeof fetch
  await expect(loadDefiLlamaPrices([identifier], fetchImpl)).rejects.toThrow('no current prices')
})

test('drops malformed identifiers before constructing a request URL', async () => {
  const fetchImpl = jest.fn()
  await expect(
    loadDefiLlamaPrices(['ethereum:../../account', 'coingecko:ethereum?account=secret'], fetchImpl)
  ).resolves.toEqual({})
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('keeps the timeout active while reading the response body', async () => {
  jest.useFakeTimers()
  const fetchImpl = jest.fn(async (_url, options) => {
    const signal = options?.signal
    return new Response(
      new ReadableStream({
        start(stream) {
          signal?.addEventListener('abort', () => stream.error(signal.reason), { once: true })
        }
      })
    )
  }) as unknown as typeof fetch

  try {
    const request = loadDefiLlamaPrices(['coingecko:ethereum'], fetchImpl)
    await Promise.resolve()
    jest.advanceTimersByTime(10_000)
    await expect(request).rejects.toThrow('no current prices')
  } finally {
    jest.useRealTimers()
  }
})

test('honors lifecycle cancellation between response chunks', async () => {
  const controller = new AbortController()
  const fetchImpl = jest.fn(async (_url, options) => {
    const signal = options?.signal
    return new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{'))
          signal?.addEventListener('abort', () => stream.error(signal.reason), { once: true })
        }
      })
    )
  }) as unknown as typeof fetch

  const request = loadDefiLlamaPrices(['coingecko:ethereum'], fetchImpl, Date.now, controller.signal)
  await Promise.resolve()
  controller.abort(new Error('subscription changed'))

  await expect(request).rejects.toThrow('subscription changed')
})
