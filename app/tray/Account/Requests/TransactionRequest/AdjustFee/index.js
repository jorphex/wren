import React, { Component, useEffect, useRef, useState } from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import link from '../../../../../../resources/link'
import {
  clearTransactionFeeDraftSafety,
  isRequestInteractionLocked,
  setTransactionFeeDraftSafety
} from '../../../../../../resources/domain/request'
import { usesBaseFee } from '../../../../../../resources/domain/transaction'

const numberFormat = { groupSeparator: '', decimalSeparator: '.' }

function toDisplayFromWei(bn) {
  return bn.shiftedBy(-9).decimalPlaces(9).toFormat(numberFormat)
}

function toDisplayFromGwei(bn) {
  return bn.decimalPlaces(9).toFormat(numberFormat)
}

function trimGwei(bn) {
  return BigNumber(bn.toFixed(9))
}

function gweiToWei(bn) {
  return bn.times(1e9)
}

function bnToHex(bn) {
  return `0x${bn.toString(16)}`
}

function limitRange(bn, min = 0, max = 9999e9) {
  if (bn.gt(max)) return BigNumber(max)
  if (bn.lt(min)) return BigNumber(min)
  return bn
}

function formatForInput(num, decimals, useWei = false) {
  if (!decimals) {
    return num.toString()
  }
  return useWei ? toDisplayFromWei(BigNumber(num)) : toDisplayFromGwei(BigNumber(num))
}

function getMaxTotalFee(tx = { chainId: '' }) {
  const chainId = parseInt(tx.chainId)

  // for ETH-based chains, the max fee should be 2 ETH
  if ([1, 3, 4, 5, 6, 10, 42, 61, 62, 63, 69, 8453, 42161, 421611, 7777777].includes(chainId)) {
    return 2 * 1e18
  }

  // for Fantom, the max fee should be 250 FTM
  if ([250, 4002].includes(chainId)) {
    return 250 * 1e18
  }

  // for all other chains, default to 50 of the chain's currency
  return 50 * 1e18
}

const totalFee = ({ gasPrice, baseFee, priorityFee, gasLimit }) =>
  gasPrice ? gasPrice.times(gasLimit) : baseFee.plus(priorityFee).times(gasLimit)

const limitGasUnits = (bn) => limitRange(bn, 0, 12.5e6)

const feeStateFromData = ({ gasLimit, maxPriorityFeePerGas, maxFeePerGas, gasPrice }) => {
  const maxFee = BigNumber(maxFeePerGas, 16)
  const priorityFee = BigNumber(maxPriorityFeePerGas, 16)

  return {
    gasLimit: BigNumber(gasLimit, 16),
    gasPrice: BigNumber(gasPrice, 16),
    baseFee: maxFee.minus(priorityFee),
    priorityFee
  }
}

const FeeOverlayInput = ({
  decimals,
  draftKey,
  initialValue,
  labelText,
  unitText,
  visualLabel,
  limiter,
  onDraftSafetyChange,
  onReceiveValue,
  tabIndex
}) => {
  const [value, setValue] = useState(initialValue)
  const authoritativeValue = useRef(initialValue)
  const dirty = useRef(false)
  const submitTimer = useRef()
  const valueRef = useRef(initialValue)
  const latest = useRef({ decimals, limiter, onDraftSafetyChange, onReceiveValue })
  const labelId = `txFeeOverlayLabel_${tabIndex}`

  const cancelSubmit = () => {
    clearTimeout(submitTimer.current)
    submitTimer.current = undefined
  }

  const setDraftValue = (newValue, safe) => {
    valueRef.current = newValue
    setValue(newValue)
    latest.current.onDraftSafetyChange(draftKey, safe)
  }

  const parseDraft = (draft) => {
    if (draft === '' || draft === '.') return null
    const parsed = BigNumber(draft)
    return parsed.isNaN() ? null : parsed
  }

  const commitDraft = (draft = valueRef.current, parsed = parseDraft(draft)) => {
    cancelSubmit()
    if (!parsed) return false

    const current = latest.current
    const limitedValue = current.limiter(current.decimals ? gweiToWei(trimGwei(parsed)) : parsed)
    const formattedValue = formatForInput(limitedValue, current.decimals, true)

    dirty.current = false
    current.onReceiveValue(limitedValue)
    setDraftValue(formattedValue, true)
    return true
  }

  const scheduleSubmit = (newValue) => {
    cancelSubmit()
    dirty.current = true
    setDraftValue(newValue, false)
    submitTimer.current = setTimeout(() => commitDraft(), 500)
  }

  useEffect(() => {
    latest.current = { decimals, limiter, onDraftSafetyChange, onReceiveValue }
  }, [decimals, limiter, onDraftSafetyChange, onReceiveValue])

  useEffect(() => {
    authoritativeValue.current = initialValue
    if (!dirty.current) {
      valueRef.current = initialValue
      setValue(initialValue)
      onDraftSafetyChange(draftKey, true)
    }
  }, [draftKey, initialValue, onDraftSafetyChange])

  useEffect(
    () => () => {
      clearTimeout(submitTimer.current)
    },
    []
  )

  const revertInvalidDraft = () => {
    cancelSubmit()
    dirty.current = false
    setDraftValue(authoritativeValue.current, true)
  }

  return (
    <>
      <div className='txFeeOverlayField'>
        <input
          tabIndex={tabIndex}
          value={value}
          className='txFeeOverlayInput wrenInput'
          aria-label={labelText}
          onChange={(e) => {
            const parsedInput = (decimals ? /[0-9.]*/ : /[0-9]*/).exec(e.target.value)
            const enteredValue = parsedInput[0] || ''

            if (enteredValue === '.' || enteredValue === '') {
              cancelSubmit()
              dirty.current = true
              return setDraftValue(enteredValue, false)
            }

            const numericValue = BigNumber(e.target.value)
            if (numericValue.isNaN()) return

            // prevent decimal point being overwritten as user is typing a float
            if (enteredValue.endsWith('.')) {
              const formattedNum = formatForInput(enteredValue.slice(0, -1), decimals)

              cancelSubmit()
              dirty.current = true
              return setDraftValue(`${formattedNum}.`, false)
            }

            scheduleSubmit(enteredValue)
          }}
          onBlur={() => {
            if (!dirty.current) return
            if (!commitDraft()) revertInvalidDraft()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.target.blur()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const parsedValue = BigNumber(value)
              if (parsedValue.isNaN()) {
                return
              }

              let newValue
              if (e.key === 'ArrowUp') {
                newValue = decimals
                  ? parsedValue.decimalPlaces(9, BigNumber.ROUND_FLOOR).plus(1)
                  : parsedValue.plus(1000)
              } else {
                newValue = decimals
                  ? parsedValue.decimalPlaces(9, BigNumber.ROUND_FLOOR).minus(1)
                  : parsedValue.minus(1000)
              }
              scheduleSubmit(newValue.toString())
            }
          }}
        />
        {unitText ? <span className='txFeeOverlayUnit'>{unitText}</span> : null}
      </div>
      <div id={labelId} className='txFeeOverlayLabel' aria-hidden='true'>
        <span>{visualLabel || labelText}</span>
      </div>
    </>
  )
}

const GasLimitInput = ({ initialValue, onDraftSafetyChange, onReceiveValue, tabIndex, limiter }) => (
  <div className='txFeeOverlayLimit'>
    <FeeOverlayInput
      draftKey='gasLimit'
      initialValue={initialValue}
      onDraftSafetyChange={onDraftSafetyChange}
      onReceiveValue={onReceiveValue}
      labelText='Gas Limit (UNITS)'
      visualLabel='Gas limit'
      tabIndex={tabIndex}
      decimals={false}
      limiter={limiter}
    />
  </div>
)

const GasPriceInput = ({ initialValue, onDraftSafetyChange, onReceiveValue, tabIndex, limiter }) => (
  <div className='txFeeOverlayGasPrice'>
    <FeeOverlayInput
      draftKey='gasPrice'
      initialValue={initialValue}
      onDraftSafetyChange={onDraftSafetyChange}
      onReceiveValue={onReceiveValue}
      labelText='Gas Price (GWEI)'
      visualLabel='Gas price'
      unitText='Gwei'
      tabIndex={tabIndex}
      decimals={true}
      limiter={limiter}
    />
  </div>
)

const BaseFeeInput = ({ initialValue, onDraftSafetyChange, onReceiveValue, tabIndex, limiter }) => (
  <div className='txFeeOverlayBaseFee'>
    <FeeOverlayInput
      draftKey='baseFee'
      initialValue={initialValue}
      onDraftSafetyChange={onDraftSafetyChange}
      onReceiveValue={onReceiveValue}
      labelText='Base Fee (GWEI)'
      visualLabel='Base fee'
      unitText='Gwei'
      tabIndex={tabIndex}
      decimals={true}
      limiter={limiter}
    />
  </div>
)

const PriorityFeeInput = ({ initialValue, onDraftSafetyChange, onReceiveValue, tabIndex, limiter }) => (
  <div className='txFeeOverlayPriorityFee'>
    <FeeOverlayInput
      draftKey='priorityFee'
      initialValue={initialValue}
      onDraftSafetyChange={onDraftSafetyChange}
      onReceiveValue={onReceiveValue}
      labelText='Max Priority Fee (GWEI)'
      visualLabel='Priority fee'
      unitText='Gwei'
      tabIndex={tabIndex}
      decimals={true}
      limiter={limiter}
    />
  </div>
)

class TxFeeOverlay extends Component {
  constructor(props, context) {
    super(props, context)
    const {
      req: {
        data: { gasLimit, maxPriorityFeePerGas, maxFeePerGas, gasPrice }
      }
    } = props
    this.moduleRef = React.createRef()
    this.draftSafety = {}
    this.state = feeStateFromData({ gasLimit, maxPriorityFeePerGas, maxFeePerGas, gasPrice })
  }

  componentDidUpdate(previousProps) {
    const feeKeys = ['gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']
    if (feeKeys.some((key) => previousProps.req.data[key] !== this.props.req.data[key])) {
      this.setState(feeStateFromData(this.props.req.data))
    }
  }

  componentWillUnmount() {
    clearTransactionFeeDraftSafety(this.props.req?.handlerId)
  }

  updateDraftSafety = (draftKey, safe) => {
    this.draftSafety[draftKey] = safe
    setTransactionFeeDraftSafety(this.props.req?.handlerId, Object.values(this.draftSafety).every(Boolean))
  }

  render() {
    const {
      req: { account, data, handlerId }
    } = this.props
    const { baseFee, gasLimit, priorityFee, gasPrice } = this.state
    const maxTotalFee = BigNumber(getMaxTotalFee(data))

    const displayBaseFee = toDisplayFromWei(baseFee)
    const baseFeeLimiter = (rawBaseFee) => {
      const { priorityFee, gasLimit } = this.state
      // if total fee > maximum allowed fee we recalculate the base fee based on the maximum allowed
      if (totalFee({ baseFee: rawBaseFee, priorityFee, gasLimit }).gt(maxTotalFee)) {
        rawBaseFee = maxTotalFee.div(gasLimit).decimalPlaces(0, BigNumber.ROUND_FLOOR).minus(priorityFee)
      }

      return limitRange(rawBaseFee)
    }

    const displayPriorityFee = toDisplayFromWei(priorityFee)
    const priorityFeeLimiter = (rawPriorityFee) => {
      const { baseFee, gasLimit } = this.state
      // if total fee > maximum allowed fee we recalculate the priority fee based on the maximum allowed
      if (totalFee({ baseFee, priorityFee: rawPriorityFee, gasLimit }).gt(maxTotalFee)) {
        rawPriorityFee = maxTotalFee.div(gasLimit).decimalPlaces(0, BigNumber.ROUND_FLOOR).minus(baseFee)
      }

      return limitRange(rawPriorityFee)
    }

    const displayGasPrice = toDisplayFromWei(gasPrice)
    const gasPriceLimiter = (rawGasPrice) => {
      const { gasLimit } = this.state
      // if total fee > maximum allowed fee we recalculate the gas price based on the maximum allowed
      if (totalFee({ gasPrice: rawGasPrice, gasLimit }).gt(maxTotalFee)) {
        rawGasPrice = maxTotalFee.div(gasLimit).decimalPlaces(0, BigNumber.ROUND_FLOOR)
      }

      return limitRange(rawGasPrice)
    }

    const displayGasLimit = gasLimit.toString()
    const gasLimitLimiter = (rawGasLimit) => {
      const { baseFee, priorityFee, gasPrice } = this.state
      // if total fee > maximum allowed fee we recalculate the gas limit based on the maximum allowed
      if (gasPrice && totalFee({ gasPrice, gasLimit: rawGasLimit }).gt(maxTotalFee)) {
        rawGasLimit = maxTotalFee.div(gasPrice).decimalPlaces(0, BigNumber.ROUND_FLOOR)
      } else if (totalFee({ baseFee, priorityFee, gasLimit: rawGasLimit }).gt(maxTotalFee)) {
        rawGasLimit = maxTotalFee.div(baseFee.plus(priorityFee)).decimalPlaces(0, BigNumber.ROUND_FLOOR)
      }

      return limitGasUnits(rawGasLimit)
    }

    const receiveValueHandler = (value, name) => {
      if (isRequestInteractionLocked(this.props.req)) return

      this.setState({
        [name]: value
      })

      link.rpc(
        `set${name.charAt(0).toUpperCase() + name.slice(1)}`,
        account,
        bnToHex(value),
        handlerId,
        (e) => {
          if (e) console.error(e)
        }
      )
    }

    return (
      <div
        className={`txAdjustFee${this.props.inline ? ' txAdjustFeeInline' : ' cardShow'}`}
        ref={this.moduleRef}
      >
        {this.props.inline ? (
          <div className='txAdjustFeeIntro'>
            <strong>Advanced fee limits</strong>
          </div>
        ) : null}
        {usesBaseFee(data) ? (
          <>
            <BaseFeeInput
              initialValue={displayBaseFee}
              onDraftSafetyChange={this.updateDraftSafety}
              onReceiveValue={(value) => receiveValueHandler(value, 'baseFee')}
              limiter={baseFeeLimiter}
              tabIndex={0}
            />
            <PriorityFeeInput
              initialValue={displayPriorityFee}
              onDraftSafetyChange={this.updateDraftSafety}
              onReceiveValue={(value) => receiveValueHandler(value, 'priorityFee')}
              limiter={priorityFeeLimiter}
              tabIndex={1}
            />
          </>
        ) : (
          <GasPriceInput
            initialValue={displayGasPrice}
            onDraftSafetyChange={this.updateDraftSafety}
            onReceiveValue={(value) => receiveValueHandler(value, 'gasPrice')}
            limiter={gasPriceLimiter}
            tabIndex={0}
          />
        )}
        <GasLimitInput
          initialValue={displayGasLimit}
          onDraftSafetyChange={this.updateDraftSafety}
          onReceiveValue={(value) => receiveValueHandler(value, 'gasLimit')}
          limiter={gasLimitLimiter}
          tabIndex={2}
        />
      </div>
    )
  }
}

export default Restore.connect(TxFeeOverlay)
