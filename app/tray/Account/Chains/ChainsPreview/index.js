import React from 'react'
import Restore from 'react-restore'
import { safeNetworkMetadata } from '../../../../../resources/domain/networkMetadata'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import Monitor from '../../../../../resources/Components/Monitor'
import { resolveChainIdentityColor } from '../../../../../resources/Components/ChainIdentityMark'

export class ChainsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.scrollHeight
          })
        }
      })
    }
    this.state = {
      expanded: false,
      index: 0,
      lockedOn: false
    }
  }

  setIndex(newIndex) {
    if (this.state.lockedOn) return
    const existingChains = Object.keys(this.store('main.networks.ethereum') || []).filter((chain) => {
      return chain && this.store('main.networks.ethereum', chain, 'on')
    })
    if (newIndex > existingChains.length - 1) {
      this.setState({ index: 0 })
    } else if (newIndex < 0) {
      this.setState({ index: existingChains.length - 1 })
    } else {
      this.setState({ index: newIndex })
    }
  }

  componentDidMount() {
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
  }

  componentWillUnmount() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
  }

  render() {
    const existingChains = Object.keys(this.store('main.networks.ethereum') || []).filter((chain) => {
      return chain && this.store('main.networks.ethereum', chain, 'on')
    })
    const currentChainId = existingChains[this.state.index] || '1'
    const currentChain = this.store('main.networks.ethereum', currentChainId)
    if (!currentChain) return null
    const currentChainMeta = safeNetworkMetadata(
      this.store('main.networksMeta.ethereum', currentChainId),
      currentChain
    )
    const { name } = currentChain
    const { primaryColor } = currentChainMeta
    const chainIdentity = resolveChainIdentityColor(currentChainId, currentChain.isTestnet, primaryColor)
    const chain = { type: 'ethereum', id: currentChain.id ?? Number(currentChainId) }
    const explorerAvailable =
      typeof currentChain.explorer === 'string' && currentChain.explorer.trim().length > 0
    return (
      <div className='balancesBlock chainMonitorPreview' ref={this.moduleRef}>
        <div className='chainMonitorCompactRow'>
          <span className='chainMonitorLabel'>Gas</span>
          <span className='chainMonitorSummary'>
            <strong>{name}</strong>
            <Monitor inline chainId={chain.id} color={chainIdentity.color} />
          </span>
          <span className='chainMonitorControls' role='group' aria-label='Displayed network controls'>
            {existingChains.length > 1 ? (
              <button
                type='button'
                aria-label={`Previous network from ${name}`}
                className='chainMonitorSwitchButton wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
                onClick={() => this.setIndex(this.state.index - 1)}
              >
                <Icon name='chevron-left' size={17} />
              </button>
            ) : null}
            {existingChains.length > 1 ? (
              <button
                type='button'
                aria-label={`Next network from ${name}`}
                className='chainMonitorSwitchButton wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
                onClick={() => this.setIndex(this.state.index + 1)}
              >
                <Icon name='chevron-right' size={17} />
              </button>
            ) : null}
            <button
              type='button'
              aria-label={
                explorerAvailable
                  ? `View ${name} account on block explorer`
                  : `Block explorer unavailable for ${name}`
              }
              className='chainMonitorExplorer wrenControl wrenControlGhost wrenControlIcon'
              disabled={!explorerAvailable}
              onClick={() => link.send('tray:openExplorer', chain, null, this.props.account)}
            >
              <Icon name='external' size={15} />
            </button>
            <button
              aria-expanded={this.state.expanded}
              aria-label={`${this.state.expanded ? 'Hide' : 'Show'} gas details for ${name}`}
              className='chainMonitorDisclosure wrenControl wrenControlGhost'
              onClick={() => this.setState(({ expanded }) => ({ expanded: !expanded }))}
              type='button'
            >
              <span>Details</span>
              <Icon name={this.state.expanded ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
          </span>
        </div>
        {this.state.expanded ? <Monitor details chainId={chain.id} color={chainIdentity.color} /> : null}
      </div>
    )
  }
}

export default Restore.connect(ChainsPreview)
