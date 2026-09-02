import { useRef, useState } from 'react'

import { MAX_UINT256 } from '../../domain/transaction/quantity'
import {
  formatTokenBaseUnitAmount,
  MAX_TOKEN_AMOUNT_INPUT_LENGTH,
  MAX_TOKEN_DECIMALS,
  parseTokenBaseUnitAmount,
  parseTokenDecimalAmount
} from '../../domain/token/amount'
import Icon from '../Icon'

import useCopiedMessage from '../../Hooks/useCopiedMessage'

const isMax = (value) => value === MAX_UINT256

const getMode = (requestedAmount, amount) => {
  if (requestedAmount === amount) return 'requested'
  return isMax(amount) ? 'unlimited' : 'custom'
}

const shortAddress = (address) => `${address.slice(0, 8)}…${address.slice(-6)}`

export const formatApprovalExpiry = (deadline) => {
  const timestamp = Number(deadline)
  const date = new Date(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric'
  }).format(date)
}

const ApprovalAddress = ({ address, name, copyLabel }) => {
  const [showCopiedMessage, copyAddress] = useCopiedMessage(address)

  return (
    <button type='button' aria-label={copyLabel} className='wrenTokenApprovalAddress' onClick={copyAddress}>
      <strong>{name || shortAddress(address)}</strong>
      <span>{showCopiedMessage ? 'Copied' : name ? shortAddress(address) : 'Copy address'}</span>
    </button>
  )
}

const EditTokenSpend = ({
  data,
  updateRequest: updateHandlerRequest,
  requestedAmount,
  deadline,
  canRevoke = false
}) => {
  const { decimals, symbol = '???', name = 'Unknown Token', spender, contract, amount } = data
  const parsedAmount = parseTokenBaseUnitAmount(amount)
  const parsedRequestedAmount = parseTokenBaseUnitAmount(requestedAmount?.toString(10))
  const amountValue = parsedAmount ?? 0n
  const requestedValue = parsedRequestedAmount ?? 0n
  const hasInvalidAmount = parsedAmount === undefined || parsedRequestedAmount === undefined
  const decimalAmount =
    parsedAmount === undefined ? undefined : formatTokenBaseUnitAmount(amountValue.toString(10), decimals)
  const [mode, setMode] = useState(hasInvalidAmount ? 'invalid' : getMode(requestedValue, amountValue))
  const [custom, setCustom] = useState(decimalAmount || amountValue.toString(10))
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const approvalSubmittingRef = useRef(false)

  const releaseApprovalSubmission = () => {
    approvalSubmittingRef.current = false
    setApprovalSubmitting(false)
  }

  const updateCustomAmount = (value) => {
    setMode('custom')
    setCustom(value)
  }

  const submitApprovalAmount = (nextAmount, nextMode, nextCustom = custom) => {
    if (approvalSubmittingRef.current) return

    const previousMode = mode
    const previousCustom = custom
    approvalSubmittingRef.current = true
    setApprovalSubmitting(true)
    setMode(nextMode)
    setCustom(nextCustom)
    updateHandlerRequest(nextAmount, (error) => {
      releaseApprovalSubmission()
      if (error) {
        setMode(previousMode)
        setCustom(previousCustom)
      }
    })
  }

  const activateOnce = (event, action) => {
    if (event.detail < 2) action()
  }

  const resetToRequestAmount = () => {
    const requested = requestedValue.toString(10)
    submitApprovalAmount(requested, 'requested', formatTokenBaseUnitAmount(requested, decimals) || requested)
  }

  const setToMax = () => submitApprovalAmount(MAX_UINT256.toString(10), 'unlimited')
  const setToRevoke = () => submitApprovalAmount('0', 'revoke', '0')

  const customAmount = parseTokenDecimalAmount(custom, decimals)
  const invalidCustomAmount = custom !== '' && customAmount === undefined
  const submitCustomAmount = () => {
    const nextAmount = custom === '' ? requestedValue : customAmount
    if (nextAmount === undefined) {
      releaseApprovalSubmission()
      return
    }
    if (custom === '') return resetToRequestAmount()
    submitApprovalAmount(nextAmount.toString(10), 'custom')
  }

  const isCustom = mode === 'custom'
  const displayAmount =
    parsedAmount === undefined
      ? 'unknown'
      : isMax(amountValue)
        ? 'unlimited'
        : decimalAmount || amountValue.toString(10)
  const inputLock =
    hasInvalidAmount ||
    !data.symbol ||
    !data.name ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_TOKEN_DECIMALS
  const unlimitedWarning =
    mode === 'unlimited' ? `This contract can keep using ${symbol} until you revoke access.` : ''

  return (
    <div className='updateTokenApproval wrenTokenApprovalEditor'>
      <section className='wrenTokenApprovalContext' aria-label='Approval details'>
        <div>
          <span className='wrenTokenApprovalContextLabel'>Token</span>
          <div className='wrenTokenApprovalIdentity'>
            <span>
              <strong>{name}</strong>
              <small>{symbol}</small>
            </span>
          </div>
        </div>
        <div>
          <span className='wrenTokenApprovalContextLabel'>Token contract</span>
          <ApprovalAddress
            address={contract.address}
            name={contract.ens}
            copyLabel='Copy token contract address'
          />
        </div>
        <div>
          <span className='wrenTokenApprovalContextLabel'>Can be used by</span>
          <ApprovalAddress
            address={spender.address}
            name={spender.ens || 'Contract'}
            copyLabel='Copy spender address'
          />
        </div>
        {deadline ? (
          <div className='wrenTokenApprovalExpiry'>
            <span className='wrenTokenApprovalContextLabel'>Expires</span>
            <strong>{formatApprovalExpiry(deadline)}</strong>
          </div>
        ) : null}
      </section>

      <section className='wrenTokenApprovalDecision' aria-labelledby='token-approval-limit-title'>
        <div className='wrenTokenApprovalDecisionHeading'>
          <div>
            <span id='token-approval-limit-title'>Spending limit</span>
          </div>
          {!isCustom ? (
            <span className='wrenTokenApprovalCurrentValue'>
              <strong>{displayAmount}</strong>
              {displayAmount === 'unlimited' ? null : <span>{symbol}</span>}
            </span>
          ) : null}
        </div>

        {!hasInvalidAmount ? (
          <div className='wrenTokenApprovalModes' aria-label='Spending limit options'>
            <button
              type='button'
              aria-label='Requested'
              className='wrenTokenApprovalMode'
              disabled={approvalSubmitting}
              aria-pressed={mode === 'requested'}
              onClick={(event) => activateOnce(event, resetToRequestAmount)}
            >
              <span>Requested</span>
            </button>
            <button
              type='button'
              aria-label='Unlimited'
              className='wrenTokenApprovalMode'
              disabled={approvalSubmitting}
              aria-pressed={mode === 'unlimited'}
              onClick={(event) => activateOnce(event, setToMax)}
            >
              <span>Unlimited</span>
            </button>
            {!inputLock ? (
              <button
                type='button'
                aria-label='Custom'
                className='wrenTokenApprovalMode'
                disabled={approvalSubmitting}
                aria-pressed={isCustom}
                onClick={() => {
                  releaseApprovalSubmission()
                  setMode('custom')
                  setCustom('')
                }}
              >
                <span>Custom</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {canRevoke && !hasInvalidAmount ? (
          <button
            type='button'
            aria-label='Revoke'
            className='wrenTokenApprovalRevoke'
            disabled={approvalSubmitting}
            aria-pressed={mode === 'revoke'}
            onClick={(event) => activateOnce(event, setToRevoke)}
          >
            Revoke allowance
          </button>
        ) : null}

        {isCustom ? (
          <div className='wrenTokenApprovalAmountEditor'>
            <label htmlFor='wren-token-approval-custom'>Custom limit</label>
            <div
              className={`approveTokenSpendAmount wrenInputGroup ${
                invalidCustomAmount ? 'wrenInputGroupError' : ''
              }`}
            >
              <input
                id='wren-token-approval-custom'
                autoFocus
                className='wrenInput'
                type='text'
                maxLength={MAX_TOKEN_AMOUNT_INPUT_LENGTH}
                aria-label='Custom amount'
                aria-invalid={invalidCustomAmount}
                placeholder='Enter amount'
                value={custom}
                disabled={approvalSubmitting}
                onChange={(event) => updateCustomAmount(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.target.blur()
                    submitCustomAmount()
                  }
                }}
              />
              {!invalidCustomAmount ? <span className='wrenTokenApprovalAmountSymbol'>{symbol}</span> : null}
              {invalidCustomAmount ? (
                <span role='alert' className='wrenTokenApprovalAmountStatus wrenTokenApprovalStatusDanger'>
                  Invalid amount
                </span>
              ) : customAmount !== undefined && amountValue !== customAmount ? (
                <button
                  type='button'
                  className='wrenTokenApprovalAmountAction'
                  disabled={approvalSubmitting}
                  onClick={(event) => activateOnce(event, submitCustomAmount)}
                >
                  Update
                </button>
              ) : (
                <span
                  key={mode + amount}
                  className='wrenTokenApprovalAmountStatus wrenTokenApprovalStatusSuccess'
                  role='status'
                  aria-label='Approval amount applied'
                >
                  <Icon name='check' size={18} />
                </span>
              )}
            </div>
          </div>
        ) : null}

        {unlimitedWarning ? (
          <p className='wrenTokenApprovalDecisionCopy wrenTokenApprovalDecisionCopyWarning'>
            {unlimitedWarning}
          </p>
        ) : !inputLock ? (
          <p className='wrenTokenApprovalDecisionCopy'>Changes apply to this transaction immediately.</p>
        ) : null}

        {inputLock ? (
          <p className='wrenTokenApprovalUnavailable'>
            Wren can show this request, but the token details are incomplete so the limit cannot be edited
            safely.
          </p>
        ) : null}
      </section>
    </div>
  )
}

export default EditTokenSpend
