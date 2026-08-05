import React from 'react'
import Restore from 'react-restore'
import svg from '../../../resources/svg'
import { safeRemoteImageUrl } from '../../utils/image'

const Icon = ({ svgName, alt = '', svgSize = 16, img, small }) => {
  const imageUrl = safeRemoteImageUrl(img)
  if (imageUrl) {
    return <img src={imageUrl} alt={alt} />
  }
  if (svgName) {
    const iconName = svgName.toLowerCase()
    const ethChains = ['mainnet', 'görli', 'sepolia', 'ropsten', 'rinkeby', 'kovan']
    if (ethChains.includes(iconName)) {
      return svg.eth(small ? 13 : 18)
    }

    const svgIcon = svg[iconName]
    return svgIcon ? svgIcon(svgSize) : null
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
          <Icon svgName={svgName} svgSize={svgSize} img={img} alt={alt} small={small} />
        </div>
      </div>
    )
  }
}

export default Restore.connect(RingIcon)
