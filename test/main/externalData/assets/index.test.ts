import Rates, { PRICE_REFRESH_MS } from '../../../../main/externalData/assets'
import store from '../../../../main/store'

jest.mock('../../../../main/store')
jest.mock('../../../../main/externalData/assets/geckoTerminal', () => ({
  loadGeckoTerminalPrices: jest.fn(async () => ({}))
}))

const account = '0x1111111111111111111111111111111111111111'
const knownToken = {
  chainId: 1,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6
}

beforeEach(() => {
  store.clear()
  store.set('main.tokens.known', account, [knownToken])
  store.set('main.tokens.custom', [{ ...knownToken, name: 'duplicate' }])
  store.setNativeCurrencyData = jest.fn()
  store.setRates = jest.fn()
})

test('prices connected assets without disclosing the account address', async () => {
  const loadPrices = jest.fn(async () => ({
    'coingecko:ethereum': { price: 2000, change24hr: 1.5 },
    [`ethereum:${knownToken.address.toLowerCase()}`]: { price: 1, change24hr: -0.1 }
  }))
  const rates = Rates(store, loadPrices)
  rates.start()
  rates.updateSubscription([1, 11155111], account)
  await Promise.resolve()
  await Promise.resolve()

  expect(loadPrices).toHaveBeenCalledWith(
    ['coingecko:ethereum', `ethereum:${knownToken.address.toLowerCase()}`],
    expect.any(AbortSignal)
  )
  expect(JSON.stringify(loadPrices.mock.calls)).not.toContain(account)
  expect(store.setNativeCurrencyData).toHaveBeenCalledWith('ethereum', 1, {
    usd: { price: 2000, change24hr: 1.5 }
  })
  expect(store.setRates).toHaveBeenCalledWith({
    [`1:${knownToken.address.toLowerCase()}`]: { usd: { price: 1, change24hr: -0.1 } }
  })

  rates.stop()
})

test('cancels and ignores a stale price response after tracked assets change', async () => {
  let firstSignal: AbortSignal | undefined
  const loadPrices = jest
    .fn()
    .mockImplementationOnce(
      (_identifiers, signal) =>
        new Promise((_resolve, reject) => {
          firstSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    .mockResolvedValueOnce({ 'coingecko:polygon-ecosystem-token': { price: 0.2, change24hr: 0 } })
  const rates = Rates(store, loadPrices)
  rates.start()
  rates.updateSubscription([1], account)
  rates.updateSubscription([137], undefined)
  await Promise.resolve()
  await Promise.resolve()

  expect(firstSignal?.aborted).toBe(true)
  expect(store.setNativeCurrencyData).not.toHaveBeenCalledWith('ethereum', 1, expect.anything())
  expect(store.setNativeCurrencyData).toHaveBeenCalledWith('ethereum', 137, {
    usd: { price: 0.2, change24hr: 0 }
  })

  rates.stop()
})

test('does not request pricing for malformed persisted token addresses', async () => {
  store.set('main.tokens.known', account, [{ ...knownToken, address: '../../account' }])
  store.set('main.tokens.custom', [])
  const loadPrices = jest.fn(async () => ({}))
  const rates = Rates(store, loadPrices)
  rates.start()
  rates.updateSubscription([1], account)
  await Promise.resolve()

  expect(loadPrices).toHaveBeenCalledWith(['coingecko:ethereum'], expect.any(AbortSignal))
  rates.stop()
})

test('aborts an active price request when stopped', async () => {
  let requestSignal: AbortSignal | undefined
  const loadPrices = jest.fn(
    (_identifiers, signal) =>
      new Promise((_resolve, reject) => {
        requestSignal = signal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
  )
  const rates = Rates(store, loadPrices)
  rates.start()
  rates.updateSubscription([1], account)

  rates.stop()
  await Promise.resolve()

  expect(requestSignal?.aborted).toBe(true)
})

test('applies primary prices before fallback and keeps the same contract separate across chains', async () => {
  store.set('main.tokens.custom', [{ ...knownToken, chainId: 8453 }])
  const address = knownToken.address.toLowerCase()
  const loadPrices = jest.fn(async () => ({ [`ethereum:${address}`]: { price: 1, change24hr: 0 } }))
  let resolveFallback!: (value: Record<string, { price: number }>) => void
  const fallback = jest.fn(
    () =>
      new Promise<Record<string, { price: number }>>((resolve) => {
        resolveFallback = resolve
      })
  )
  const rates = Rates(store, loadPrices, fallback)
  rates.updateSubscription([1, 8453], account)
  rates.start()
  await Promise.resolve()
  expect(store.setRates).toHaveBeenCalledWith({ [`1:${address}`]: { usd: { price: 1, change24hr: 0 } } })
  expect(fallback).toHaveBeenCalledWith([`base:${address}`], expect.any(AbortSignal), expect.any(Function))
  resolveFallback({ [`base:${address}`]: { price: 7 } })
  await Promise.resolve()
  await Promise.resolve()
  expect(store.setRates).toHaveBeenLastCalledWith({ [`8453:${address}`]: { usd: { price: 7 } } })
  rates.stop()
})

test('uses the token fallback when the primary provider fails entirely', async () => {
  const address = knownToken.address.toLowerCase()
  const fallback = jest.fn(async () => ({ [`ethereum:${address}`]: { price: 2 } }))
  const rates = Rates(store, jest.fn().mockRejectedValue(new Error('offline')), fallback)
  rates.updateSubscription([1], account)
  rates.start()
  await Promise.resolve()
  await Promise.resolve()
  expect(fallback).toHaveBeenCalledWith(
    [`ethereum:${address}`],
    expect.any(AbortSignal),
    expect.any(Function)
  )
  expect(store.setRates).toHaveBeenCalledWith({ [`1:${address}`]: { usd: { price: 2 } } })
  rates.stop()
})

test('does not apply a fallback response from a previous subscription', async () => {
  let resolveFallback!: (value: Record<string, { price: number }>) => void
  const fallback = jest.fn(
    () =>
      new Promise<Record<string, { price: number }>>((resolve) => {
        resolveFallback = resolve
      })
  )
  const rates = Rates(
    store,
    jest.fn(async () => ({})),
    fallback
  )
  rates.updateSubscription([1], account)
  rates.start()
  await Promise.resolve()
  rates.updateSubscription([], undefined)
  resolveFallback({ [`ethereum:${knownToken.address.toLowerCase()}`]: { price: 9 } })
  await Promise.resolve()
  await Promise.resolve()
  expect(store.setRates).not.toHaveBeenCalled()
  rates.stop()
})

test('publishes fallback progress once and ignores progress after stop', async () => {
  type Quotes = Record<string, { price: number }>
  let publish!: (quotes: Quotes) => void
  let resolve!: (quotes: Quotes) => void
  const fallback = jest.fn((_ids, _signal, onPrices) => {
    publish = onPrices
    return new Promise<Quotes>((done) => {
      resolve = done
    })
  })
  const rates = Rates(
    store,
    jest.fn(async () => ({})),
    fallback
  )
  rates.updateSubscription([1], account)
  rates.start()
  await Promise.resolve()
  const quote = { [`ethereum:${knownToken.address.toLowerCase()}`]: { price: 2 } }
  publish(quote)
  expect(store.setRates).toHaveBeenCalledTimes(1)
  resolve(quote)
  await Promise.resolve()
  expect(store.setRates).toHaveBeenCalledTimes(1)
  rates.stop()
  publish({ [`ethereum:${knownToken.address.toLowerCase()}`]: { price: 9 } })
  expect(store.setRates).toHaveBeenCalledTimes(1)
})

test('refreshes primary prices while fallback is pending without overlapping fallback or replacing primary quotes', async () => {
  jest.useFakeTimers()
  const identifier = `ethereum:${knownToken.address.toLowerCase()}`
  let publish!: (quotes: Record<string, { price: number }>) => void
  let resolve!: (quotes: Record<string, { price: number }>) => void
  let signal!: AbortSignal
  const fallback = jest.fn((_ids, activeSignal, onPrices) => {
    signal = activeSignal
    publish = onPrices
    return new Promise<Record<string, { price: number }>>((done) => {
      resolve = done
    })
  })
  const primary = jest.fn().mockResolvedValue({}).mockResolvedValueOnce({})
  const rates = Rates(store, primary, fallback)
  try {
    rates.updateSubscription([1], account)
    rates.start()
    await jest.advanceTimersByTimeAsync(PRICE_REFRESH_MS * 2)
    expect(primary).toHaveBeenCalledTimes(3)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(false)

    primary.mockResolvedValue({ [identifier]: { price: 3 } })
    await jest.advanceTimersByTimeAsync(PRICE_REFRESH_MS)
    expect(primary).toHaveBeenCalledTimes(4)
    expect(store.setRates).toHaveBeenCalledTimes(1)
    publish({ [identifier]: { price: 2 } })
    resolve({ [identifier]: { price: 2 } })
    await Promise.resolve()
    expect(store.setRates).toHaveBeenCalledTimes(1)
    expect(store.setRates).toHaveBeenLastCalledWith({
      [`1:${knownToken.address.toLowerCase()}`]: { usd: { price: 3 } }
    })
  } finally {
    rates.stop()
    jest.useRealTimers()
  }
})

test.each(['stop', 'subscription'])(
  'cancels pending fallback on %s and ignores late progress',
  async (action) => {
    let signal!: AbortSignal
    let publish!: (quotes: Record<string, { price: number }>) => void
    const fallback = jest.fn((_ids, activeSignal, onPrices) => {
      signal = activeSignal
      publish = onPrices
      return new Promise<Record<string, { price: number }>>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const rates = Rates(store, jest.fn().mockResolvedValue({}), fallback)
    rates.updateSubscription([1], account)
    rates.start()
    await Promise.resolve()
    if (action === 'stop') rates.stop()
    else rates.updateSubscription([], undefined)
    expect(signal.aborted).toBe(true)
    publish({ [`ethereum:${knownToken.address.toLowerCase()}`]: { price: 9 } })
    await Promise.resolve()
    expect(store.setRates).not.toHaveBeenCalled()
    rates.stop()
  }
)
