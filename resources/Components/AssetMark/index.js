import { RingIconGlyph } from '../RingIcon'

import baseYvusdc from 'url:./assets/base-yvusdc-h.png'
import ethereumYbold from 'url:./assets/ethereum-ybold.png'
import ethereumYvusd from 'url:./assets/ethereum-yvusd.png'
import ethereumYvusds from 'url:./assets/ethereum-yvusds-1.png'
import ethereumYvweth from 'url:./assets/ethereum-yvweth-1.png'
import katanaYvvbeth from 'url:./assets/katana-yvvbeth.png'
import katanaYvvbusdc from 'url:./assets/katana-yvvbusdc.png'
import katanaYvvbusdt from 'url:./assets/katana-yvvbusdt.png'

const ethereumLogo = (logoURI = '') => logoURI.includes('/coins/images/279/large/ethereum.png')

const artworkByKey = Object.freeze({
  'base-yvusdc-h': baseYvusdc,
  'ethereum-ybold': ethereumYbold,
  'ethereum-yvusd': ethereumYvusd,
  'ethereum-yvusds-1': ethereumYvusds,
  'ethereum-yvweth-1': ethereumYvweth,
  'katana-yvvbeth': katanaYvvbeth,
  'katana-yvvbusdc': katanaYvvbusdc,
  'katana-yvvbusdt': katanaYvvbusdt
})

const artworkEntries = [
  ['ethereum-yvusd', 1, ['0x696d02db93291651ed510704c9b286841d506987', '0xaaafea48472f77563961cdb53291dedfb46f9040']],
  ['ethereum-yvusds-1', 1, ['0x182863131f9a4630ff9e27830d945b1413e347e8', '0xdc035d45d973e3ec169d2276ddab16f1e407384f']],
  ['ethereum-yvweth-1', 1, ['0xc56413869c6cdf96496f2b1ef801fedbdfa7ddb0', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']],
  ['ethereum-ybold', 1, ['0x9f4330700a36b29952869fac9b33f45eedd8a3d8', '0x6440f144b7e50d6a8439336510312d2f54beb01d', '0x23346b04a7f55b8760e5860aa5a77383d63491cd']],
  ['base-yvusdc-h', 8453, ['0xc3bd0a2193c8f027b82dde3611d18589ef3f62a9', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']],
  ['katana-yvvbusdc', 747474, ['0x80c34bd3a3569e126e7055831036aa7b212cb159', '0x203a662b0bd271a6ed5a60edfbd04bfce608fd36']],
  ['katana-yvvbeth', 747474, ['0xe007ca01894c863d7898045ed5a3b4abf0b18f37', '0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62']],
  ['katana-yvvbusdt', 747474, ['0x9a6bd7b6fd5c4f87eb66356441502fc7dcdd185b', '0x2dca96907fde857dd3d816880a0df407eeb2d2f2']]
]

const artworkByAsset = Object.freeze(
  Object.fromEntries(
    artworkEntries.flatMap(([artworkKey, chainId, addresses]) =>
      addresses.map((address) => [`${chainId}:${address}`, artworkByKey[artworkKey]])
    )
  )
)

export const resolveAssetArtwork = (asset = {}) => {
  const symbol = asset.symbol || '?'
  const address = typeof asset.address === 'string' ? asset.address.toLowerCase() : ''
  const assetKey = Number.isInteger(Number(asset.chainId)) && address ? `${Number(asset.chainId)}:${address}` : ''
  const bundledImg = artworkByKey[asset.artworkKey] || artworkByAsset[assetKey]
  const isEthereum = asset.native === true && (symbol.toUpperCase() === 'ETH' || ethereumLogo(asset.logoURI))

  return {
    fallback: symbol.slice(0, 1).toUpperCase(),
    bundledImg,
    img: !bundledImg && !isEthereum && !asset.isTestnet ? asset.logoURI : undefined,
    svgName: isEthereum ? 'mainnet' : undefined,
  }
}

const AssetMark = ({ asset, className = '', showChain = true, size = 'default' }) => {
  const symbol = asset?.symbol || '?'
  const chainColor = asset?.primaryColor ? `var(--${asset.primaryColor})` : 'var(--wren-text-muted)'
  const artwork = resolveAssetArtwork(asset)

  return (
    <span
      aria-label={`${symbol} asset`}
      className={`assetMark assetMark-${size} ${className}`.trim()}
      role='img'
      style={{ '--asset-mark-chain-color': chainColor }}
    >
      <span className='assetMarkGlyph' aria-hidden='true'>
        <RingIconGlyph
          fallback={artwork.fallback}
          img={artwork.img}
          svgName={artwork.svgName}
          svgSize={17}
          bundledImg={artwork.bundledImg}
        />
      </span>
      {showChain ? <span className='assetMarkChain' aria-hidden='true' /> : null}
    </span>
  )
}

export default AssetMark
