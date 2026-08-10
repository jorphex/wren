import { Component } from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import Icon from '../Icon'

import { weiToGwei, hexToInt, roundGwei } from '../../utils'

const unavailable = 'Unavailable'

function levelDisplay(level) {
  if (!level) return unavailable
  const gwei = weiToGwei(hexToInt(level))
  return roundGwei(gwei) || '‹0.001'
}

function totalFeeDisplay(fees, fallback) {
  if (!fees?.maxPriorityFeePerGas || !fees?.nextBaseFee) return levelDisplay(fallback)
  const total = BigNumber(fees.maxPriorityFeePerGas)
    .plus(BigNumber(fees.nextBaseFee))
    .shiftedBy(-9)
    .toNumber()
  return roundGwei(total) || '‹0.001'
}

function usdDisplay(value) {
  if (!Number.isFinite(value) || value <= 0) return unavailable
  if (value < 0.01) return '<$0.01'
  return `$${BigNumber(value).toFixed(value >= 10 ? 0 : 2)}`
}

const GasSummary = ({ actualFee, color, hidden = false }) => (
  <span
    aria-hidden={hidden || undefined}
    aria-label={
      hidden
        ? undefined
        : `Current gas price ${actualFee === unavailable ? 'unavailable' : `${actualFee} gwei`}`
    }
    className='sliceTileGasPrice'
  >
    <span className='sliceTileGasPriceIcon' style={{ color }}>
      <Icon name='gas' size={14} />
    </span>
    <span className='sliceTileGasPriceNumber'>{actualFee}</span>
    {actualFee !== unavailable ? <span className='sliceTileGasPriceUnit'>gwei</span> : null}
  </span>
)

const GasStat = ({ caption, color, value }) => (
  <span className='gasDetailStat'>
    <span className='gasDetailValue'>
      {value}
      {value !== unavailable ? <small>gwei</small> : null}
    </span>
    <span className='gasDetailCaption' style={{ color }}>
      {caption}
    </span>
  </span>
)

const GasDetails = ({ color, fees, levels, samples }) => {
  const feeMarket = Boolean(fees?.nextBaseFee && fees?.maxPriorityFeePerGas)
  return (
    <div className='gasDetails'>
      <div className={`gasDetailTiers ${feeMarket ? '' : 'gasDetailTiersLegacy'}`}>
        {feeMarket ? (
          <>
            <GasStat caption='Next base fee' color={color} value={levelDisplay(fees.nextBaseFee)} />
            <GasStat
              caption='Recommended total fee'
              color={color}
              value={totalFeeDisplay(fees, levels.fast)}
            />
            <GasStat caption='Priority fee' color={color} value={levelDisplay(fees.maxPriorityFeePerGas)} />
          </>
        ) : (
          <GasStat caption='Recommended gas price' color={color} value={levelDisplay(levels.fast)} />
        )}
      </div>
      {samples.length ? (
        <div className='gasActionEstimates' aria-label='Estimated fees'>
          {samples.map(({ label, estimates }, index) => {
            const cost = estimates?.high?.cost?.usd ?? estimates?.low?.cost?.usd
            return (
              <span className='gasActionEstimate' key={`${label}:${index}`}>
                <span className='gasActionEstimateValue'>{usdDisplay(cost)}</span>
                <span className='gasActionEstimateLabel'>{label}</span>
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export class ChainSummaryComponent extends Component {
  constructor(...args) {
    super(...args)
    this.state = { expanded: false }
  }

  render() {
    const { ariaHidden = false, chainId, color, details = false, inline = false } = this.props
    const type = 'ethereum'
    const fees = this.store('main.networksMeta', type, chainId, 'gas.price.fees')
    const levels = this.store('main.networksMeta', type, chainId, 'gas.price.levels') || {}
    const samples = (this.store('main.networksMeta', type, chainId, 'gas.samples') || []).slice(0, 3)
    const detailView = <GasDetails color={color} fees={fees} levels={levels} samples={samples} />
    if (details) return detailView

    const networkName = this.store('main.networks', type, chainId, 'name') || 'Network'
    const actualFee = totalFeeDisplay(fees, levels.fast)
    const summary = <GasSummary actualFee={actualFee} color={color} hidden={ariaHidden || !inline} />

    if (inline) return summary

    const ariaValue = actualFee === unavailable ? 'Gas price unavailable' : `${actualFee} gwei`
    const action = this.state.expanded ? 'Hide' : 'Show'
    return (
      <div className='gasMonitorStandalone'>
        <button
          aria-expanded={this.state.expanded}
          aria-label={`${networkName}: ${ariaValue}. ${action} gas details.`}
          className='gasMonitorStandaloneToggle'
          onClick={() => this.setState(({ expanded }) => ({ expanded: !expanded }))}
          type='button'
        >
          {summary}
          <Icon name={this.state.expanded ? 'chevron-up' : 'chevron-down'} size={17} />
        </button>
        {this.state.expanded ? detailView : null}
      </div>
    )
  }
}

export default Restore.connect(ChainSummaryComponent)
