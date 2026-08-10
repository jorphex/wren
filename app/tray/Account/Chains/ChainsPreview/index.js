import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'
import Monitor from '../../../../../resources/Components/Monitor'
import { roundGwei } from '../../../../../resources/utils'

export class ChainsPreview extends React.Component {
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
      this.setState({ expanded: false, index: 0 })
    } else if (newIndex < 0) {
      this.setState({ expanded: false, index: existingChains.length - 1 })
    } else {
      this.setState({ expanded: false, index: newIndex })
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
    const currentChainMeta = this.store('main.networksMeta.ethereum', currentChainId)
    if (!currentChain || !currentChainMeta) return null
    const { name } = currentChain
    const { primaryColor } = currentChainMeta
    const levels = currentChainMeta.gas?.price?.levels || {}
    const fees = currentChainMeta.gas?.price?.fees
    const feeValue =
      fees?.nextBaseFee && fees?.maxPriorityFeePerGas
        ? BigNumber(fees.nextBaseFee).plus(BigNumber(fees.maxPriorityFeePerGas)).shiftedBy(-9).toNumber()
        : levels.fast
          ? BigNumber(levels.fast).shiftedBy(-9).toNumber()
          : null
    const displayFee =
      feeValue === null ? 'Gas price unavailable' : `${roundGwei(feeValue) || 'under 0.001'} gwei`
    const gasAction = this.state.expanded ? 'Hide' : 'Show'
    return (
      <div className='balancesBlock chainMonitorPreview' ref={this.moduleRef}>
        <div className='moduleHeader'>
          <button
            aria-expanded={this.state.expanded}
            aria-label={`${name}: ${displayFee}. ${gasAction} gas details.`}
            className='chainMonitorDisclosure'
            onClick={() => this.setState(({ expanded }) => ({ expanded: !expanded }))}
            type='button'
          >
            <span className='chainMonitorIdentity'>
              <span>
                <Icon name='network' size={16} />
              </span>
              <span>
                <strong>Gas</strong>
                <small>{name}</small>
              </span>
            </span>
            <Monitor ariaHidden inline chainId={currentChain.id} color={`var(--${primaryColor})`} />
            <Icon name={this.state.expanded ? 'chevron-up' : 'chevron-down'} size={17} />
          </button>
          {existingChains.length > 1 && (
            <div className='chainMonitorSwitch'>
              <button
                type='button'
                aria-label='Previous network'
                className='chainMonitorSwitchButton wrenControl wrenControlGhost wrenControlIcon wrenControlCompact'
                onClick={() => this.setIndex(this.state.index - 1)}
              >
                <Icon name='chevron-left' size={18} />
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
        {this.state.expanded ? (
          <Monitor details chainId={currentChain.id} color={`var(--${primaryColor})`} />
        ) : null}
      </div>
    )
  }
}

export default Restore.connect(ChainsPreview)
