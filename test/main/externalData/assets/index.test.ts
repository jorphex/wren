import Rates from '../../../../main/externalData/assets'
import store from '../../../../main/store'

jest.mock('../../../../main/store')

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
    [knownToken.address.toLowerCase()]: { usd: { price: 1, change24hr: -0.1 } }
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
