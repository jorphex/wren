import { Component, useState } from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import link from '../../link'

import { ClusterRow, ClusterValue } from '../Cluster'
import Icon from '../Icon'

import { weiToGwei, hexToInt, roundGwei } from '../../utils'

function levelDisplay(level) {
  const gwei = weiToGwei(hexToInt(level))
  return roundGwei(gwei) || 0
}

function toDisplayUSD(num) {
  if (!num || num === 0) return '?'
  return BigNumber(num).toFixed(num >= 10 ? 0 : 2)
}

const GasFees = ({ gasPrice, color }) => (
  <div className='gasItem gasItemLarge'>
    <div className='gasGweiNum'>{gasPrice}</div>
    <span className='gasGweiLabel' style={{ color }}>
      {'GWEI'}
    </span>
    <span className='gasLevelLabel'>{'Recommended'}</span>
  </div>
)

const GasFeesMarket = ({ gasPrice, fees: { nextBaseFee, maxPriorityFeePerGas }, color }) => {
  const [displayBaseHint, setDisplayBaseHint] = useState(false)
  const [displayPriorityHint, setDisplayPriorityHint] = useState(false)
  const calculatedFees = {
    actualBaseFee: roundGwei(weiToGwei(hexToInt(nextBaseFee))),
    priorityFee: levelDisplay(maxPriorityFeePerGas)
  }

  return (
    <>
      {displayBaseHint && (
        <div className='feeToolTip feeToolTipBase cardShow'>
          Wren adds a buffer to the current base fee to cover the next three blocks. Any amount above your
          block&apos;s base fee is refunded.
        </div>
      )}
      {displayPriorityHint && (
        <div className='feeToolTip feeToolTipPriority cardShow'>
          A priority fee (tip) is paid to validators to help include your transaction sooner.
        </div>
      )}
      <div className='gasItem gasItemSmall'>
        <div className='gasGweiNum'>{calculatedFees.actualBaseFee || '‹0.001'}</div>
        <span className='gasGweiLabel' style={{ color }}>
          {'GWEI'}
        </span>
        <span className='gasLevelLabel'>{'Current base fee'}</span>
      </div>
      <div className='gasItem gasItemLarge'>
        <button
          type='button'
          aria-label='Explain current base fee'
          className='gasArrow'
          onClick={() => setDisplayBaseHint(true)}
          onFocus={() => setDisplayBaseHint(true)}
          onBlur={() => setDisplayBaseHint(false)}
          onMouseLeave={() => setDisplayBaseHint(false)}
        >
          <div className='gasArrowNotify'>+</div>
          <div className='gasArrowInner'>
            <Icon name='back' size={22} />
          </div>
        </button>
        <div className='gasGweiNum'>{gasPrice || '‹0.001'}</div>
        <span className='gasGweiLabel' style={{ color }}>
          {'GWEI'}
        </span>
        <span className='gasLevelLabel'>{'Recommended'}</span>
        <button
          type='button'
          aria-label='Explain priority fee'
          className='gasArrow gasArrowRight'
          onClick={() => setDisplayPriorityHint(true)}
          onFocus={() => setDisplayPriorityHint(true)}
          onBlur={() => setDisplayPriorityHint(false)}
          onMouseLeave={() => setDisplayPriorityHint(false)}
        >
          <div className='gasArrowInner'>
            <Icon name='chevron-right' size={22} />
          </div>
        </button>
      </div>
      <div className='gasItem gasItemSmall'>
        <div className='gasGweiNum'>{calculatedFees.priorityFee || '‹0.001'}</div>
        <span className='gasGweiLabel' style={{ color }}>
          {'GWEI'}
        </span>
        <span className='gasLevelLabel'>{'Priority fee'}</span>
      </div>
    </>
  )
}

export class ChainSummaryComponent extends Component {
  constructor(...args) {
    super(...args)
    this.state = { expanded: false }
  }

  render() {
    const { address, chainId } = this.props
    const type = 'ethereum'
    const currentChain = { type, id: chainId }
    const fees = this.store('main.networksMeta', type, chainId, 'gas.price.fees')
    const levels = this.store('main.networksMeta', type, chainId, 'gas.price.levels')
    const gasPrice = levelDisplay(levels.fast)

    const explorer = this.store('main.networks', type, chainId, 'explorer')
    const sampleOperations = this.store('main.networksMeta', type, chainId, 'gas.samples') || []

    // fees is either a populated object (EIP-1559 compatible) or falsy
    const displayFeeMarket = !!fees

    const actualFee = displayFeeMarket
      ? roundGwei(
          BigNumber(fees.maxPriorityFeePerGas).plus(BigNumber(fees.nextBaseFee)).shiftedBy(-9).toNumber()
        )
      : gasPrice
    return (
      <>
        <ClusterRow>
          <ClusterValue
            ariaLabel={`${this.state.expanded ? 'Collapse' : 'Expand'} gas details`}
            ariaExpanded={this.state.expanded}
            onClick={() => {
              this.setState({ expanded: !this.state.expanded })
            }}
          >
            <div className='sliceTileGasPrice'>
              <div className='sliceTileGasPriceIcon' style={{ color: this.props.color }}>
                <Icon name='gas' size={14} />
              </div>
              <div className='sliceTileGasPriceNumber'>{actualFee || '‹0.001'}</div>
              <div className='sliceTileGasPriceUnit'>{'gwei'}</div>
            </div>
          </ClusterValue>
          <ClusterValue
            ariaLabel={
              explorer
                ? address
                  ? 'Open account in block explorer'
                  : 'Open network block explorer'
                : undefined
            }
            style={{ minWidth: '70px', maxWidth: '70px' }}
            onClick={
              explorer
                ? () => {
                    if (address) {
                      link.send('tray:openExplorer', currentChain, null, address)
                    } else {
                      link.rpc('openExplorer', currentChain, () => {})
                    }
                  }
                : undefined
            }
          >
            <div style={{ padding: '6px', color: !explorer && 'var(--outerspace05)' }}>
              <div>
                <Icon name='external' size={address ? 16 : 18} />
              </div>
            </div>
          </ClusterValue>
        </ClusterRow>
        {this.state.expanded && (
          <ClusterRow>
            <ClusterValue pointerEvents={true}>
              <div className='sliceGasBlock'>
                {displayFeeMarket ? (
                  <GasFeesMarket gasPrice={gasPrice} fees={fees} color={this.props.color} />
                ) : (
                  <GasFees gasPrice={gasPrice} color={this.props.color} />
                )}
              </div>
            </ClusterValue>
          </ClusterRow>
        )}
        <ClusterRow>
          {sampleOperations.map(({ label, estimates }, i) => {
            const cost = estimates.low?.cost.usd
            return (
              <ClusterValue key={i}>
                <div className='gasEstimate'>
                  <div className='gasEstimateRange'>
                    <span className='gasEstimateSymbol'>
                      {!cost || cost >= 0.01 || cost === '?' ? `$` : '<$'}
                    </span>
                    <span className='gasEstimateRangeLow'>{toDisplayUSD(cost)}</span>
                  </div>
                  <div className='gasEstimateLabel' style={{ color: this.props.color }}>
                    {label}
                  </div>
                </div>
              </ClusterValue>
            )
          })}
        </ClusterRow>
      </>
    )
  }
}

const Monitor = Restore.connect(ChainSummaryComponent)

export default Restore.connect(Monitor)
