const finiteNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export const safeNetworkMetadata = (metadata, network = {}) => {
  const source = metadata && typeof metadata === 'object' ? metadata : {}
  const currency =
    source.nativeCurrency && typeof source.nativeCurrency === 'object' ? source.nativeCurrency : {}
  const usd = currency.usd && typeof currency.usd === 'object' ? currency.usd : {}

  return {
    ...source,
    icon: typeof source.icon === 'string' ? source.icon : '',
    primaryColor: typeof source.primaryColor === 'string' ? source.primaryColor : undefined,
    nativeCurrency: {
      ...currency,
      symbol:
        typeof currency.symbol === 'string' && currency.symbol
          ? currency.symbol
          : typeof network.symbol === 'string' && network.symbol
            ? network.symbol
            : '?',
      name: typeof currency.name === 'string' ? currency.name : '',
      icon: typeof currency.icon === 'string' ? currency.icon : '',
      decimals: Number.isInteger(currency.decimals) ? currency.decimals : 18,
      usd: {
        ...usd,
        price: finiteNumber(usd.price),
        change24hr: finiteNumber(usd.change24hr)
      }
    }
  }
}
