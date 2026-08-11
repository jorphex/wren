import fs from 'fs'
import { fireEvent, render, screen, within } from '@testing-library/react'

import AssetMark, { resolveAssetArtwork } from '../../../../resources/Components/AssetMark'

const yvWeth = {
  address: '0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0',
  chainId: 1,
  primaryColor: 'accent1',
  symbol: 'yvWETH-1'
}

const assetMarkStyle = fs.readFileSync('resources/Components/AssetMark/index.styl', 'utf8')

it('centers every artwork path in one shared inset without moving the chain marker', () => {
  expect(assetMarkStyle).toMatch(
    /\.assetMarkGlyph[\s\S]*?img[\s\S]*?width var\(--asset-mark-image-size\)[\s\S]*?height var\(--asset-mark-image-size\)[\s\S]*?object-fit contain[\s\S]*?object-position center/
  )
  expect(assetMarkStyle).toMatch(/--asset-mark-art-size var\(--asset-mark-image-size\)/)
  expect(assetMarkStyle).toMatch(
    /svg[\s\S]*?width var\(--asset-mark-art-size\)[\s\S]*?height var\(--asset-mark-art-size\)[\s\S]*?\.ringIconFallback[\s\S]*?width var\(--asset-mark-art-size\)[\s\S]*?height var\(--asset-mark-art-size\)[\s\S]*?align-items center[\s\S]*?justify-content center/
  )
  expect(assetMarkStyle).toMatch(
    /\.assetMarkChain[\s\S]*?position absolute[\s\S]*?right -2px[\s\S]*?bottom -2px/
  )
})

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

it('centers the native Ethereum artwork without a vertical transform', () => {
  render(<AssetMark asset={{ chainId: 1, native: true, symbol: 'ETH' }} />)

  const mark = screen.getByTestId('ethereum-mark')
  expect(mark.style.transform).toBe('')
  expect(mark.parentElement.parentElement.classList.contains('assetMarkGlyph')).toBe(true)
})

it('falls back to the asset initial if bundled artwork cannot load', () => {
  render(<AssetMark asset={yvWeth} size='hero' />)

  const mark = screen.getByRole('img', { name: 'yvWETH-1 asset' })
  fireEvent.error(within(mark).getByAltText(''))

  expect(screen.getByText('Y')).toBeTruthy()
  expect(mark.classList.contains('assetMark-hero')).toBe(true)
})
