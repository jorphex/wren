import { RingIconGlyph } from '../RingIcon'

const ethereumLogo = (logoURI = '') => logoURI.includes('/coins/images/279/large/ethereum.png')

const AssetMark = ({ asset, className = '' }) => {
  const symbol = asset?.symbol || '?'
  const isEthereum = symbol.toUpperCase() === 'ETH' || ethereumLogo(asset?.logoURI)
  const chainColor = asset?.primaryColor ? `var(--${asset.primaryColor})` : 'var(--wren-text-muted)'

  return (
    <span
      aria-label={`${symbol} asset`}
      className={`assetMark ${className}`.trim()}
      role='img'
      style={{ '--asset-mark-chain-color': chainColor }}
    >
      <span className='assetMarkGlyph' aria-hidden='true'>
        <RingIconGlyph
          fallback={symbol.slice(0, 1).toUpperCase()}
          img={!isEthereum ? asset?.logoURI : undefined}
          svgName={isEthereum ? 'mainnet' : undefined}
          svgSize={17}
        />
      </span>
      <span className='assetMarkChain' aria-hidden='true' />
    </span>
  )
}

export default AssetMark
