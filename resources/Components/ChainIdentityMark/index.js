import RingIcon from '../RingIcon'
import { getChainIdentity } from '../../utils/chainIdentity'

export const resolveChainIdentityColor = (chainId, isTestnet = false, primaryColor) => {
  const identity = getChainIdentity(chainId, isTestnet)
  const custom = identity.mark === 'chain'
  const color = custom && primaryColor ? `var(--${primaryColor})` : `var(${identity.colorToken})`

  return { ...identity, color, custom }
}

const ChainIdentityMark = ({ chainId, icon, isTestnet = false, primaryColor, small = false }) => {
  const identity = resolveChainIdentityColor(chainId, isTestnet, primaryColor)

  return (
    <RingIcon
      block={!identity.custom}
      color={identity.color}
      img={identity.custom ? icon : undefined}
      noRing={!identity.custom}
      small={small}
      svgName={identity.mark}
      svgSize={identity.custom ? undefined : small ? 18 : 30}
    />
  )
}

export default ChainIdentityMark
