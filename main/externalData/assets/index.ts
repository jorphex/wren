import log from 'electron-log'
import { loadGeckoTerminalPrices } from './geckoTerminal'
import { toTokenId } from '../../../resources/domain/balance'

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
  4663: { chain: 'robinhood', native: 'coingecko:ethereum' },
  8453: { chain: 'base', native: 'coingecko:ethereum' },
  42161: { chain: 'arbitrum', native: 'coingecko:ethereum' },
  747474: { chain: 'katana', native: 'coingecko:ethereum' }
}

type PriceTarget = { type: 'native'; chainId: number } | { type: 'token'; chainId: number; address: Address }

type PriceLoader = (
  identifiers: string[],
  signal?: AbortSignal,
  onPrices?: (prices: Record<string, ExternalPrice>) => void
) => Promise<Record<string, ExternalPrice>>

const defaultPriceLoader: PriceLoader = (identifiers, signal) =>
  loadDefiLlamaPrices(identifiers, fetch, Date.now, signal)

// Use pool USD prices for Robinhood tokens after inconsistent primary-provider quotes.
const usesPoolPricing = (identifier: string) => identifier.startsWith('robinhood:')

const tokenIdentifier = (token: Token) => {
  const chain = CHAIN_PRICE_IDENTIFIERS[token.chainId]?.chain
  const address = token.address.toLowerCase()
  return chain && /^0x[0-9a-f]{40}$/u.test(address) ? `${chain}:${address}` : undefined
}

export default function rates(
  store: Store,
  loadPrices: PriceLoader = defaultPriceLoader,
  loadFallback: PriceLoader = loadGeckoTerminalPrices
) {
  const storeApi = {
    getKnownTokens: (address?: Address) =>
      ((address && store('main.tokens.known', address)) || []) as Token[],
    getCustomTokens: () => (store('main.tokens.custom') || []) as Token[],
    setNativeCurrencyRate: (chainId: number, rate: Rate) =>
      requireStoreActionFrom(store, 'setNativeCurrencyData')('ethereum', chainId, {
        usd: rate
      } satisfies Partial<NativeCurrency>),
    setTokenRates: (rates: Record<string, UsdRate>) => requireStoreActionFrom(store, 'setRates')(rates)
  }

  let started = false
  let generation = 0
  let refreshTimer: NodeJS.Timeout | undefined
  let refreshController: AbortController | undefined
  let fallbackController: AbortController | undefined
  let primaryIdentifiers = new Set<string>()
  let targets = new Map<string, PriceTarget[]>()

  const schedule = (activeGeneration: number) => {
    if (!started || activeGeneration !== generation || targets.size === 0) return
    refreshTimer = setTimeout(() => void refresh(activeGeneration), PRICE_REFRESH_MS)
  }

  const applyPrices = (prices: Record<string, ExternalPrice>) => {
    const tokenRates: Record<string, UsdRate> = {}

    Object.entries(prices).forEach(([identifier, price]) => {
      const rate = { ...price }
      ;(targets.get(identifier) || []).forEach((target) => {
        if (target.type === 'native') {
          storeApi.setNativeCurrencyRate(target.chainId, rate)
        } else {
          tokenRates[toTokenId(target)] = { usd: rate }
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
      const identifiers = [...targets.keys()]
      let prices: Record<string, ExternalPrice> = {}
      try {
        const primary = await loadPrices(
          identifiers.filter((id) => !usesPoolPricing(id)),
          controller.signal
        )
        prices = Object.fromEntries(Object.entries(primary).filter(([id]) => !usesPoolPricing(id)))
      } catch {
        controller.signal.throwIfAborted()
      }
      if (started && activeGeneration === generation) {
        primaryIdentifiers = new Set(Object.keys(prices))
        applyPrices(prices)
      }
      controller.signal.throwIfAborted()
      const missing = identifiers.filter(
        (identifier) => !prices[identifier] && !identifier.startsWith('coingecko:')
      )
      if (missing.length && !fallbackController) {
        void refreshFallback(missing, activeGeneration)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        log.warn('Independent asset pricing is temporarily unavailable', error)
      }
    } finally {
      if (refreshController === controller) refreshController = undefined
      schedule(activeGeneration)
    }
  }

  async function refreshFallback(identifiers: string[], activeGeneration: number) {
    const controller = new AbortController()
    fallbackController = controller
    const delivered = new Set<string>()
    const publish = (quotes: Record<string, ExternalPrice>) => {
      if (!started || activeGeneration !== generation || controller.signal.aborted) return
      const fresh = Object.fromEntries(
        Object.entries(quotes).filter(([id]) => !delivered.has(id) && !primaryIdentifiers.has(id))
      )
      Object.keys(fresh).forEach((id) => delivered.add(id))
      applyPrices(fresh)
    }
    try {
      publish(await loadFallback(identifiers, controller.signal, publish))
    } catch (error) {
      if (!controller.signal.aborted) log.warn('Fallback asset pricing is temporarily unavailable', error)
    } finally {
      if (fallbackController === controller) fallbackController = undefined
    }
  }

  function setAssets(nextTargets: Map<string, PriceTarget[]>) {
    generation += 1
    targets = nextTargets
    primaryIdentifiers.clear()
    fallbackController?.abort()
    fallbackController = undefined
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
      fallbackController?.abort()
      fallbackController = undefined
      refreshController?.abort()
      refreshController = undefined
      clearTimeout(refreshTimer)
      refreshTimer = undefined
    },
    updateSubscription
  }
}
