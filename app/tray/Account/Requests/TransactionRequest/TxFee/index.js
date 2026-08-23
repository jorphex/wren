import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import { DisplayCoinBalance, DisplayValue } from '../../../../../../resources/Components/DisplayValue'
import { isRequestInteractionLocked } from '../../../../../../resources/domain/request'
import { usesBaseFee } from '../../../../../../resources/domain/transaction'
import { displayValueData } from '../../../../../../resources/utils/displayValue'
import { chainUsesOptimismFees } from '../../../../../../resources/utils/chains'
import { safeNetworkMetadata } from '../../../../../../resources/domain/networkMetadata'
import { ClusterBox } from '../../../../../../resources/Components/Cluster'
import AdjustFee from '../AdjustFee'

const FEE_WARNING_THRESHOLD_USD = 50

const GasDisplay = ({ maxFeePerGas }) => {
  const { displayValue: gweiDisplayValue } = maxFeePerGas.gwei()
  const shouldDisplayWei = gweiDisplayValue === '0'
  const displayValue = shouldDisplayWei ? maxFeePerGas.wei().displayValue : gweiDisplayValue
  const displayLabel = shouldDisplayWei ? 'Wei' : 'Gwei'

  return (
    <div data-testid='gas-display' className='_txFeeGwei'>
      <span className='_txFeeGweiValue'>{displayValue}</span>
      <span className='_txFeeGweiLabel'>{displayLabel}</span>
    </div>
  )
}

const FeeDisplay = ({ fee }) => <DisplayValue type='fiat' value={fee} currencySymbol='$' />
const FeeRange = ({ max, min }) => (
  <>
    <FeeDisplay fee={min} />
    <span>{'-'}</span>
    <FeeDisplay fee={max} />
  </>
)

const USDEstimateDisplay = ({ minFee, maxFee, nativeCurrency }) => {
  const { value: maxFeeValue, displayValue, approximationSymbol: maxFeeApproximation } = maxFee.fiat()
  const displayMaxFeeWarning = maxFeeValue > FEE_WARNING_THRESHOLD_USD
  const maxFeeIsUnknownValue = displayValue === '?'

  return (
    <div data-testid='usd-estimate-display' className='clusterTag'>
      <div className={`_txFeeValueDefault${displayMaxFeeWarning ? ' _txFeeValueDefaultWarn' : ''}`}>
        <span>{maxFeeIsUnknownValue ? '=' : '≈'}</span>
        {maxFeeApproximation === '<' || maxFeeIsUnknownValue ? (
          <FeeDisplay fee={maxFee} />
        ) : (
          <FeeRange max={maxFee} min={minFee} />
        )}
        <span className='_txFeeValueCurrency'>{`in ${nativeCurrency.symbol}`}</span>
      </div>
    </div>
  )
}

export class TxFee extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      expanded: Boolean(props.initiallyExpanded) && !props.readOnly && !isRequestInteractionLocked(props.req)
    }
  }

  componentDidUpdate(previousProps) {
    if (
      !this.props.readOnly &&
      !isRequestInteractionLocked(this.props.req) &&
      !previousProps.initiallyExpanded &&
      this.props.initiallyExpanded &&
      !this.state.expanded
    ) {
      this.setState({ expanded: true })
    }
  }

  getOptimismFee = (l2Price, l2Limit, chainData) => {
    const l1DataFee = BigNumber(chainData?.l1Fees).toNumber()

    // Compute the L2 execution fee
    const l2ExecutionFee = l2Price * l2Limit

    // Return the sum of both fees
    return l2ExecutionFee + l1DataFee
  }

  render() {
    const req = this.props.req
    const adjustmentLocked = this.props.readOnly || isRequestInteractionLocked(req)
    const chain = {
      type: 'ethereum',
      id: parseInt(req.data.chainId, 16)
    }
    const { isTestnet } = this.store('main.networks', chain.type, chain.id)
    const { nativeCurrency } = safeNetworkMetadata(
      this.store('main.networksMeta', chain.type, chain.id),
      this.store('main.networks', chain.type, chain.id)
    )

    const maxGas = BigNumber(req.data.gasLimit, 16)
    const maxFeePerGas = BigNumber(req.data[usesBaseFee(req.data) ? 'maxFeePerGas' : 'gasPrice'], 16)
    const maxFeeSourceValue = chainUsesOptimismFees(chain.id)
      ? this.getOptimismFee(maxFeePerGas, maxGas, req.chainData?.optimism)
      : maxFeePerGas.multipliedBy(maxGas)

    const maxFee = displayValueData(maxFeeSourceValue, {
      currencyRate: nativeCurrency.usd,
      isTestnet
    })

    // accounts for two potential 12.5% block fee increases
    const reduceFactor = BigNumber(9).dividedBy(8)
    const minFeePerGas = maxFeePerGas.dividedBy(reduceFactor).dividedBy(reduceFactor)

    // accounts for the 50% padding in the gas estimate in the provider
    const minGas = maxGas.dividedBy(BigNumber(1.5))
    const minFeeSourceValue = chainUsesOptimismFees(chain.id)
      ? this.getOptimismFee(minFeePerGas, minGas, req.chainData?.optimism)
      : minFeePerGas.multipliedBy(minGas)
    const minFee = displayValueData(minFeeSourceValue, {
      currencyRate: nativeCurrency.usd,
      isTestnet
    })

    return (
      <ClusterBox className='transactionReviewFee' title='fee' animationSlot={this.props.i}>
        <div className='transactionReviewFeeRow'>
          <span className='transactionReviewMetaLabel'>Network fee</span>
          <span className='transactionReviewFeeValue'>
            <span className='transactionReviewFeeTotal'>
              {!maxFee.bn || maxFee.bn.isNaN() ? (
                `? ${nativeCurrency.symbol}`
              ) : (
                <DisplayCoinBalance amount={maxFee} symbol={nativeCurrency.symbol} />
              )}
            </span>
            <span className='transactionReviewFeeSubline'>
              <USDEstimateDisplay minFee={minFee} maxFee={maxFee} nativeCurrency={nativeCurrency} />
              <span aria-hidden='true'>·</span>
              <GasDisplay maxFeePerGas={displayValueData(maxFeePerGas)} />
            </span>
          </span>
          <button
            type='button'
            aria-expanded={this.state.expanded}
            disabled={adjustmentLocked}
            className='wrenControl wrenControlSecondary wrenControlCompact transactionReviewFeeAdjust'
            onClick={() => {
              if (!adjustmentLocked) this.setState((state) => ({ expanded: !state.expanded }))
            }}
          >
            Adjust
          </button>
        </div>
        {req.feesUpdatedByUser ? (
          <div className='transactionReviewFeeNotice' style={{ color: 'var(--good)' }}>
            {'Gas values set by user'}
          </div>
        ) : null}
        {this.state.expanded && !adjustmentLocked ? <AdjustFee inline={true} req={req} /> : null}
      </ClusterBox>
    )
  }
}

export default Restore.connect(TxFee)
