import { z } from 'zod'

import { ChainSchema, ChainMetadataSchema } from '../../../state/types/chain'
import { GasSchema } from '../../../state/types/gas'

const StateSchema = z
  .object({
    main: z
      .object({
        networks: z.unknown().optional(),
        networksMeta: z.unknown().optional()
      })
      .passthrough()
  })
  .passthrough()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const paletteKeys = new Set([
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'accent7',
  'accent8'
])
const gasLevels = ['slow', 'standard', 'fast', 'asap', 'custom'] as const

const knownCurrencies: Record<number, { symbol: string; name: string; primaryColor: string }> = {
  1: { symbol: 'ETH', name: 'Ether', primaryColor: 'accent1' },
  10: { symbol: 'ETH', name: 'Ether', primaryColor: 'accent4' },
  100: { symbol: 'xDAI', name: 'xDAI', primaryColor: 'accent5' },
  137: { symbol: 'MATIC', name: 'Matic', primaryColor: 'accent6' },
  8453: { symbol: 'ETH', name: 'Ether', primaryColor: 'accent8' },
  747474: { symbol: 'ETH', name: 'Ether', primaryColor: 'accent3' },
  42161: { symbol: 'ETH', name: 'Ether', primaryColor: 'accent7' },
  84532: { symbol: 'sepETH', name: 'Base Sepolia Ether', primaryColor: 'accent2' },
  11155111: { symbol: 'sepETH', name: 'Sepolia Ether', primaryColor: 'accent2' },
  11155420: { symbol: 'sepETH', name: 'Optimism Sepolia Ether', primaryColor: 'accent2' }
}

const defaultGas = () => ({
  samples: [],
  price: {
    selected: 'standard',
    levels: { slow: '', standard: '', fast: '', asap: '', custom: '' }
  }
})

const omit = (value: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

const normalizeGas = (value: unknown) => {
  const source = isRecord(value) ? value : {}
  const price = isRecord(source['price']) ? source['price'] : {}
  const savedLevels = isRecord(price['levels']) ? price['levels'] : {}
  const defaults = defaultGas()
  const levels = Object.fromEntries(
    gasLevels.map((level) => [level, typeof savedLevels[level] === 'string' ? savedLevels[level] : ''])
  )
  const selected = gasLevels.includes(price['selected'] as (typeof gasLevels)[number])
    ? price['selected']
    : defaults.price.selected
  const samples = Array.isArray(source['samples'])
    ? source['samples'].flatMap((sample) => {
        const parsed = GasSchema.safeParse({ ...defaults, samples: [sample] })
        return parsed.success ? parsed.data.samples : []
      })
    : []
  const parsed = GasSchema.safeParse({ ...defaults, samples, price: { selected, levels } })
  const safeGas = parsed.success ? parsed.data : defaults
  const withFees = GasSchema.safeParse({
    ...safeGas,
    price: { ...safeGas.price, fees: price['fees'] }
  })
  const fees = withFees.success ? withFees.data.price.fees : undefined

  return {
    ...omit(source, ['samples', 'price']),
    samples: safeGas.samples,
    price: {
      ...omit(price, ['selected', 'levels', 'fees']),
      selected: safeGas.price.selected,
      levels: safeGas.price.levels,
      ...(fees === undefined ? {} : { fees })
    }
  }
}

const defaultMetadata = (network: Record<string, unknown>, chain: { id: number; isTestnet: boolean }) => {
  const known = knownCurrencies[chain.id]
  return {
    blockHeight: 0,
    gas: defaultGas(),
    icon: typeof network['icon'] === 'string' ? network['icon'] : '',
    primaryColor:
      known?.primaryColor ||
      (typeof network['primaryColor'] === 'string' && paletteKeys.has(network['primaryColor'])
        ? network['primaryColor']
        : chain.isTestnet
          ? 'accent2'
          : 'accent1'),
    nativeCurrency: {
      symbol: known?.symbol || (typeof network['symbol'] === 'string' ? network['symbol'] : 'ETH'),
      icon: typeof network['nativeCurrencyIcon'] === 'string' ? network['nativeCurrencyIcon'] : '',
      name:
        known?.name ||
        (typeof network['nativeCurrencyName'] === 'string' ? network['nativeCurrencyName'] : network['name']),
      decimals: isFiniteNumber(network['nativeCurrencyDecimals']) ? network['nativeCurrencyDecimals'] : 18,
      usd: { price: 0, change24hr: 0 }
    }
  }
}

const normalizeMetadata = (
  value: unknown,
  network: Record<string, unknown>,
  chain: { id: number; isTestnet: boolean }
) => {
  const source = isRecord(value) ? value : {}
  const defaults = defaultMetadata(network, chain)
  const nativeCurrency = isRecord(source['nativeCurrency']) ? source['nativeCurrency'] : {}
  const usd = isRecord(nativeCurrency['usd']) ? nativeCurrency['usd'] : {}
  const primaryColor =
    typeof source['primaryColor'] === 'string' && paletteKeys.has(source['primaryColor'])
      ? source['primaryColor']
      : defaults.primaryColor

  const normalized = {
    ...omit(source, ['blockHeight', 'gas', 'icon', 'primaryColor', 'nativeCurrency']),
    blockHeight: isFiniteNumber(source['blockHeight']) ? source['blockHeight'] : defaults.blockHeight,
    gas: normalizeGas(source['gas']),
    icon: typeof source['icon'] === 'string' ? source['icon'] : defaults.icon,
    primaryColor,
    nativeCurrency: {
      ...omit(nativeCurrency, ['symbol', 'icon', 'name', 'decimals', 'usd']),
      symbol:
        typeof nativeCurrency['symbol'] === 'string'
          ? nativeCurrency['symbol']
          : defaults.nativeCurrency.symbol,
      icon:
        typeof nativeCurrency['icon'] === 'string' ? nativeCurrency['icon'] : defaults.nativeCurrency.icon,
      name:
        typeof nativeCurrency['name'] === 'string' ? nativeCurrency['name'] : defaults.nativeCurrency.name,
      decimals: isFiniteNumber(nativeCurrency['decimals'])
        ? nativeCurrency['decimals']
        : defaults.nativeCurrency.decimals,
      usd: {
        ...omit(usd, ['price', 'change24hr']),
        price: isFiniteNumber(usd['price']) ? usd['price'] : 0,
        change24hr: isFiniteNumber(usd['change24hr']) ? usd['change24hr'] : 0
      }
    }
  }

  const parsed = ChainMetadataSchema.safeParse(normalized)
  return parsed.success ? normalized : defaults
}

const migrate = (initial: unknown) => {
  const parsed = StateSchema.safeParse(initial)
  if (!parsed.success) return initial

  const networks = parsed.data.main.networks
  if (!isRecord(networks) || !isRecord(networks['ethereum'])) return parsed.data

  const networksMeta = isRecord(parsed.data.main.networksMeta) ? parsed.data.main.networksMeta : {}
  const savedEthereumMeta = isRecord(networksMeta['ethereum']) ? networksMeta['ethereum'] : {}
  const ethereum = Object.fromEntries(
    Object.entries(networks['ethereum']).flatMap(([chainId, network]) => {
      if (!isRecord(network)) return []
      const parsedChain = ChainSchema.safeParse(network)
      if (!parsedChain.success || String(parsedChain.data.id) !== chainId) return []
      return [[chainId, normalizeMetadata(savedEthereumMeta[chainId], network, parsedChain.data)]]
    })
  )

  return {
    ...parsed.data,
    main: {
      ...parsed.data.main,
      networksMeta: { ...networksMeta, ethereum }
    }
  }
}

export default { version: 71, migrate }
