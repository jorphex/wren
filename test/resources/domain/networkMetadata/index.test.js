import { safeNetworkMetadata } from '../../../../resources/domain/networkMetadata'

test('preserves valid metadata without inventing missing market evidence', () => {
  expect(
    safeNetworkMetadata({
      icon: 'network.svg',
      primaryColor: 'accent3',
      nativeCurrency: {
        symbol: 'RISE',
        name: 'Rise',
        icon: 'rise.svg',
        decimals: 18,
        usd: { price: 2, change24hr: -1 }
      }
    })
  ).toEqual({
    icon: 'network.svg',
    primaryColor: 'accent3',
    nativeCurrency: {
      symbol: 'RISE',
      name: 'Rise',
      icon: 'rise.svg',
      decimals: 18,
      usd: { price: 2, change24hr: -1 }
    }
  })
})

test('returns a render-safe shape for absent or incomplete custom-network metadata', () => {
  expect(safeNetworkMetadata(undefined, { symbol: 'NEW' })).toEqual({
    icon: '',
    primaryColor: undefined,
    nativeCurrency: {
      symbol: 'NEW',
      name: '',
      icon: '',
      decimals: 18,
      usd: { price: undefined, change24hr: undefined }
    }
  })
  expect(safeNetworkMetadata({ nativeCurrency: {} }).nativeCurrency.symbol).toBe('?')
})
