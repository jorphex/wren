import log from 'electron-log'

import { loadDefiLlamaPrices, type ExternalPrice } from './provider'
import type { NativeCurrency, Rate, Token } from '../../store/state'
import type { UsdRate } from '../../provider/assets'
import { requireStoreActionFrom } from '../../store/actionFrom'

export const PRICE_REFRESH_MS = 5 * 60 * 1000

const CHAIN_PRICE_IDENTIFIERS: Record<number, { chain: string; native: string }> = {
  1: { chain: 'ethereum', native: 'coingecko:ethereum' },
  10: { chain: 'optimism', native: 'coingecko:ethereum' },
  100: { chain: 'xdai', native: 'coingecko:xdai' },
  137: { chain: 'polygon', native: 'coingecko:polygon-ecosystem-token' },
  8453: { chain: 'base', native: 'coingecko:ethereum' },
  42161: { chain: 'arbitrum', native: 'coingecko:ethereum' },
  747474: { chain: 'katana', native: 'coingecko:ethereum' }
}

type PriceTarget = { type: 'native'; chainId: number } | { type: 'token'; chainId: number; address: Address }

type PriceLoader = (identifiers: string[], signal?: AbortSignal) => Promise<Record<string, ExternalPrice>>

const defaultPriceLoader: PriceLoader = (identifiers, signal) =>
  loadDefiLlamaPrices(identifiers, fetch, Date.now, signal)

const tokenIdentifier = (token: Token) => {
  const chain = CHAIN_PRICE_IDENTIFIERS[token.chainId]?.chain
  const address = token.address.toLowerCase()
  return chain && /^0x[0-9a-f]{40}$/u.test(address) ? `${chain}:${address}` : undefined
}

export default function rates(store: Store, loadPrices: PriceLoader = defaultPriceLoader) {
  const storeApi = {
    getKnownTokens: (address?: Address) =>
      ((address && store('main.tokens.known', address)) || []) as Token[],
    getCustomTokens: () => (store('main.tokens.custom') || []) as Token[],
    setNativeCurrencyRate: (chainId: number, rate: Rate) =>
      requireStoreActionFrom(store, 'setNativeCurrencyData')('ethereum', chainId, {
        usd: rate
      } satisfies Partial<NativeCurrency>),
    setTokenRates: (rates: Record<Address, UsdRate>) => requireStoreActionFrom(store, 'setRates')(rates)
  }

  let started = false
  let generation = 0
  let refreshTimer: NodeJS.Timeout | undefined
  let refreshController: AbortController | undefined
  let targets = new Map<string, PriceTarget[]>()

  const schedule = (activeGeneration: number) => {
    if (!started || activeGeneration !== generation || targets.size === 0) return
    refreshTimer = setTimeout(() => void refresh(activeGeneration), PRICE_REFRESH_MS)
  }

  const applyPrices = (prices: Record<string, ExternalPrice>) => {
    const tokenRates: Record<Address, UsdRate> = {}

    Object.entries(prices).forEach(([identifier, price]) => {
      const rate = { price: price.price, change24hr: price.change24hr }
      ;(targets.get(identifier) || []).forEach((target) => {
        if (target.type === 'native') {
          storeApi.setNativeCurrencyRate(target.chainId, rate)
        } else {
          tokenRates[target.address.toLowerCase()] = { usd: rate }
        }
      })
    })

    if (Object.keys(tokenRates).length > 0) storeApi.setTokenRates(tokenRates)
  }

  async function refresh(activeGeneration = generation) {
    if (!started || activeGeneration !== generation || targets.size === 0) return
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    const controller = new AbortController()
    refreshController = controller

    try {
      const prices = await loadPrices([...targets.keys()], controller.signal)
      if (started && activeGeneration === generation) applyPrices(prices)
    } catch (error) {
      if (!controller.signal.aborted) {
        log.warn('Independent asset pricing is temporarily unavailable', error)
      }
    } finally {
      if (refreshController === controller) refreshController = undefined
      schedule(activeGeneration)
    }
  }

  function setAssets(nextTargets: Map<string, PriceTarget[]>) {
    generation += 1
    targets = nextTargets
    refreshController?.abort()
    refreshController = undefined
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    if (started && targets.size > 0) void refresh(generation)
  }

  function updateSubscription(chains: number[], address?: Address) {
    const nextTargets = new Map<string, PriceTarget[]>()
    const addTarget = (identifier: string, target: PriceTarget) => {
      nextTargets.set(identifier, [...(nextTargets.get(identifier) || []), target])
    }

    chains.forEach((chainId) => {
      const identifier = CHAIN_PRICE_IDENTIFIERS[chainId]?.native
      if (identifier) addTarget(identifier, { type: 'native', chainId })
    })

    const knownTokens = storeApi.getKnownTokens(address).filter((token) => chains.includes(token.chainId))
    const knownIds = new Set(knownTokens.map((token) => `${token.chainId}:${token.address.toLowerCase()}`))
    const customTokens = storeApi
      .getCustomTokens()
      .filter((token) => chains.includes(token.chainId))
      .filter((token) => !knownIds.has(`${token.chainId}:${token.address.toLowerCase()}`))

    ;[...knownTokens, ...customTokens].forEach((token) => {
      const identifier = tokenIdentifier(token)
      if (identifier) {
        addTarget(identifier, {
          type: 'token',
          chainId: token.chainId,
          address: token.address
        })
      }
    })

    setAssets(nextTargets)
  }

  return {
    start() {
      started = true
      if (targets.size > 0) void refresh(generation)
    },
    stop() {
      started = false
      generation += 1
      refreshController?.abort()
      refreshController = undefined
      clearTimeout(refreshTimer)
      refreshTimer = undefined
    },
    updateSubscription
  }
}
