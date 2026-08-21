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
    /\.assetMarkGlyph[\s\S]*?img[\s\S]*?top 50%[\s\S]*?left 50%[\s\S]*?width var\(--asset-mark-image-size\)[\s\S]*?height var\(--asset-mark-image-size\)[\s\S]*?object-fit contain[\s\S]*?object-position center[\s\S]*?transform translate\(-50%, -50%\)/
  )
  expect(assetMarkStyle).toMatch(
    /--asset-mark-image-size 22px[\s\S]*?--asset-mark-vector-size 18px[\s\S]*?--asset-mark-art-size var\(--asset-mark-image-size\)/
  )
  expect(assetMarkStyle).toMatch(
    /> div[\s\S]*?top 50%[\s\S]*?left 50%[\s\S]*?width var\(--asset-mark-render-size\)[\s\S]*?min-width var\(--asset-mark-render-size\)[\s\S]*?height var\(--asset-mark-render-size\)[\s\S]*?transform translate\(-50%, -50%\)[\s\S]*?\.ringIconFallback[\s\S]*?place-items center/
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
  expect(mark.parentElement.parentElement.classList.contains('assetMarkGlyphVector')).toBe(true)
  expect(assetMarkStyle).toMatch(
    /\.assetMarkGlyphVector[\s\S]*?--asset-mark-render-size var\(--asset-mark-vector-size\)/
  )
})

it('accepts the resolved semantic chain color without reinterpreting it', () => {
  render(<AssetMark asset={{ chainColor: 'var(--wren-chain-ethereum)', symbol: 'ETH' }} />)

  expect(
    screen.getByRole('img', { name: 'ETH asset' }).style.getPropertyValue('--asset-mark-chain-color')
  ).toBe('var(--wren-chain-ethereum)')
})

it('offers a shared plain artwork treatment while keeping a round chain marker', () => {
  render(<AssetMark appearance='plain' asset={yvWeth} />)

  expect(screen.getByRole('img', { name: 'yvWETH-1 asset' }).classList.contains('assetMark-plain')).toBe(true)
  expect(assetMarkStyle).toMatch(
    /\.assetMark-plain \.assetMarkGlyph[\s\S]*?border-color transparent[\s\S]*?background transparent[\s\S]*?box-shadow none/
  )
  expect(assetMarkStyle).toMatch(
    /\.assetMarkChain[\s\S]*?aspect-ratio 1[\s\S]*?box-sizing border-box[\s\S]*?border-radius 999px/
  )
})

it('falls back to the asset initial if bundled artwork cannot load', () => {
  render(<AssetMark asset={yvWeth} size='hero' />)

  const mark = screen.getByRole('img', { name: 'yvWETH-1 asset' })
  fireEvent.error(within(mark).getByAltText(''))

  expect(screen.getByText('Y')).toBeTruthy()
  expect(mark.classList.contains('assetMark-hero')).toBe(true)
})
