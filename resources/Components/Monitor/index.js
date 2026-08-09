import { Component } from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import { ClusterRow, ClusterValue } from '../Cluster'
import Icon from '../Icon'

import { weiToGwei, hexToInt, roundGwei } from '../../utils'

function levelDisplay(level) {
  if (!level) return 0
  const gwei = weiToGwei(hexToInt(level))
  return roundGwei(gwei) || 0
}

export class ChainSummaryComponent extends Component {
  render() {
    const { chainId, inline = false } = this.props
    const type = 'ethereum'
    const fees = this.store('main.networksMeta', type, chainId, 'gas.price.fees')
    const levels = this.store('main.networksMeta', type, chainId, 'gas.price.levels')
    const gasPrice = levelDisplay(levels?.fast)

    const displayFeeMarket = !!fees?.maxPriorityFeePerGas && !!fees?.nextBaseFee
    const actualFee = displayFeeMarket
      ? roundGwei(
          BigNumber(fees.maxPriorityFeePerGas).plus(BigNumber(fees.nextBaseFee)).shiftedBy(-9).toNumber()
        )
      : gasPrice
    const summary = (
      <div className='sliceTileGasPrice' aria-label={`Current gas price ${actualFee || 'under 0.001'} gwei`}>
        <div className='sliceTileGasPriceIcon' style={{ color: this.props.color }}>
          <Icon name='gas' size={14} />
        </div>
        <div className='sliceTileGasPriceNumber'>{actualFee || '‹0.001'}</div>
        <div className='sliceTileGasPriceUnit'>gwei</div>
      </div>
    )

    if (inline) return summary

    return (
      <ClusterRow className='gasSummaryRow'>
        <ClusterValue>{summary}</ClusterValue>
      </ClusterRow>
    )
  }
}

const Monitor = Restore.connect(ChainSummaryComponent)

export default Restore.connect(Monitor)
