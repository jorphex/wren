import React from 'react'
import Restore from 'react-restore'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import Monitor from '../../../../../resources/Components/Monitor'

import { Cluster } from '../../../../../resources/Components/Cluster'

class ChainsPreview extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.clientHeight
          })
        }
      })
    }
    this.state = {
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
    const { address } = this.store('main.accounts', this.props.account)
    const existingChains = Object.keys(this.store('main.networks.ethereum') || []).filter((chain) => {
      return chain && this.store('main.networks.ethereum', chain, 'on')
    })
    const currentChainId = existingChains[this.state.index] || '1'
    const currentChain = this.store('main.networks.ethereum', currentChainId)
    const currentChainMeta = this.store('main.networksMeta.ethereum', currentChainId)
    if (!currentChain || !currentChainMeta) return null
    const { name } = currentChain
    const { primaryColor } = currentChainMeta
    return (
      <div className='balancesBlock chainMonitorPreview' ref={this.moduleRef}>
        <div className='moduleHeader'>
          <span style={{ marginLeft: '-2px' }}>
            <Icon name='network' size={16} />
          </span>
          <span>{`${name} Monitor`}</span>
          {existingChains.length > 1 && (
            <div className='chainMonitorSwitch'>
              <button
                type='button'
                aria-label='Previous network'
                className='chainMonitorSwitchButton wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
                onClick={() => this.setIndex(this.state.index - 1)}
              >
                <Icon name='back' size={18} />
              </button>
              <button
                type='button'
                aria-label='Next network'
                className='chainMonitorSwitchButton wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
                onClick={() => this.setIndex(this.state.index + 1)}
              >
                <Icon name='chevron-right' size={18} />
              </button>
            </div>
          )}
        </div>
        <Cluster>
          <Monitor address={address} chainId={currentChain.id} color={`var(--${primaryColor})`} />
        </Cluster>
      </div>
    )
  }
}

export default Restore.connect(ChainsPreview)
