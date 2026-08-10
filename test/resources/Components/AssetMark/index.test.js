import { fireEvent, render, screen, within } from '@testing-library/react'

import AssetMark, { resolveAssetArtwork } from '../../../../resources/Components/AssetMark'

const yvWeth = {
  address: '0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0',
  chainId: 1,
  primaryColor: 'accent1',
  symbol: 'yvWETH-1'
}

it('resolves bundled vault artwork by normalized chain and token address', () => {
  expect(resolveAssetArtwork(yvWeth).bundledImg).toBeTruthy()

  render(<AssetMark asset={yvWeth} />)

  expect(within(screen.getByRole('img', { name: 'yvWETH-1 asset' })).getByAltText('')).toBeTruthy()
  expect(screen.queryByText('Y')).toBeNull()
})

it('shares bundled underlying artwork with known balance tokens', () => {
  const usds = {
    address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
    chainId: 1,
    symbol: 'USDS'
  }

  expect(resolveAssetArtwork(usds).bundledImg).toBeTruthy()
})

it('does not silently render a non-native wrapped asset as Ethereum', () => {
  const weth = {
    address: '0x0000000000000000000000000000000000000001',
    chainId: 1,
    logoURI: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    symbol: 'WETH'
  }

  const artwork = resolveAssetArtwork(weth)
  expect(artwork.svgName).toBeUndefined()
  expect(artwork.img).toContain('assets.coingecko.com')
})

it('requires native identity before selecting the Ethereum glyph', () => {
  expect(resolveAssetArtwork({ chainId: 1, symbol: 'ETH' }).svgName).toBeUndefined()
  expect(resolveAssetArtwork({ chainId: 1, native: true, symbol: 'ETH' }).svgName).toBe('mainnet')
})

it('falls back to the asset initial if bundled artwork cannot load', () => {
  render(<AssetMark asset={yvWeth} size='hero' />)

  const mark = screen.getByRole('img', { name: 'yvWETH-1 asset' })
  fireEvent.error(within(mark).getByAltText(''))

  expect(screen.getByText('Y')).toBeTruthy()
  expect(mark.classList.contains('assetMark-hero')).toBe(true)
})
