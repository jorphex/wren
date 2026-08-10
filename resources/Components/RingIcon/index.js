import React, { useState } from 'react'
import Restore from 'react-restore'
import svg from '../../../resources/svg'
import { safeRemoteImageUrl } from '../../utils/image'
import WrenIcon from '../Icon'

const wrenIconNames = Object.freeze({
  accounts: 'accounts',
  alert: 'alert',
  chain: 'network',
  check: 'check',
  close: 'close',
  copy: 'copy',
  ellipsis: 'ellipsis',
  file: 'file',
  gas: 'gas',
  inbox: 'requests',
  inventory: 'inventory',
  key: 'key',
  lock: 'lock',
  plug: 'apps',
  search: 'search',
  seedling: 'seedling',
  send: 'send',
  settings: 'settings',
  sidebar: 'sidebar',
  sign: 'sign',
  sync: 'sync',
  tokens: 'tokens'
})

export const RingIconGlyph = ({ svgName, alt = '', fallback = '', svgSize = 16, img, bundledImg, small }) => {
  const imageUrl = bundledImg || safeRemoteImageUrl(img)
  const [failedImageUrl, setFailedImageUrl] = useState('')

  if (imageUrl && imageUrl !== failedImageUrl) {
    return <img src={imageUrl} alt={alt} onError={() => setFailedImageUrl(imageUrl)} />
  }
  if (svgName) {
    const iconName = svgName.toLowerCase()
    const ethChains = ['ethereum', 'mainnet', 'görli', 'sepolia', 'ropsten', 'rinkeby', 'kovan']
    if (ethChains.includes(iconName)) {
      return svg.eth(small ? 13 : svgSize)
    }

    if (wrenIconNames[iconName]) {
      return <WrenIcon label={alt || undefined} name={wrenIconNames[iconName]} size={svgSize} />
    }

    const svgIcon = svg[iconName]
    return svgIcon ? svgIcon(svgSize) : null
  }

  if (fallback) {
    return (
      <span className='ringIconFallback' aria-hidden='true'>
        {fallback}
      </span>
    )
  }

  return svg.eth(small ? 13 : 18)
}

class RingIcon extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {}
  }

  render() {
    const { color, svgName, svgSize, img, small, block, noRing, alt } = this.props
    let ringIconClass = 'ringIcon'
    if (small) ringIconClass += ' ringIconSmall'
    if (block) ringIconClass += ' ringIconBlock'
    if (noRing) ringIconClass += ' ringIconNoRing'
    return (
      <div
        className={ringIconClass}
        style={{
          borderColor: color
        }}
      >
        <div className='ringIconInner' style={block ? { color } : { background: color }}>
          <RingIconGlyph svgName={svgName} svgSize={svgSize} img={img} alt={alt} small={small} />
        </div>
      </div>
    )
  }
}

export default Restore.connect(RingIcon)
