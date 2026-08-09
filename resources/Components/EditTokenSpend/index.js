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
import { ClusterBox, Cluster, ClusterRow, ClusterValue } from '../Cluster'
import Countdown from '../Countdown'

import useCopiedMessage from '../../Hooks/useCopiedMessage'

const isMax = (value) => value === MAX_UINT256

const getMode = (requestedAmount, amount) => {
  if (requestedAmount === amount) return 'requested'
  return isMax(amount) ? 'unlimited' : 'custom'
}

const Details = ({ address, name, copyLabel }) => {
  const [showCopiedMessage, copyAddress] = useCopiedMessage(address)

  return (
    <ClusterRow>
      <ClusterValue pointerEvents={'auto'}>
        <button
          type='button'
          aria-label={copyLabel}
          className='clusterAddress clusterAddressButton'
          onClick={copyAddress}
        >
          <span className='clusterAddressRecipient'>
            {name ? (
              <span className='clusterAddressRecipient' style={{ fontFamily: 'MainFont', fontWeight: '400' }}>
                {name}
              </span>
            ) : (
              <>
                {address.substring(0, 8)}
                <Icon name='ellipsis' size={15} />
                {address.substring(address.length - 6)}
              </>
            )}
          </span>
          <div className='clusterAddressRecipientFull'>
            {showCopiedMessage ? (
              <span>{'Address copied'}</span>
            ) : (
              <span className='clusterFira'>{address}</span>
            )}
          </div>
        </button>
      </ClusterValue>
    </ClusterRow>
  )
}

const Description = ({ isRevoke }) => (
  <ClusterRow>
    <ClusterValue>
      <div className='clusterTag' style={{ color: 'var(--moon)' }}>
        {isRevoke ? <span>{'Revoke approval to spend'}</span> : <span>{'Grant approval to spend'}</span>}
      </div>
    </ClusterValue>
  </ClusterRow>
)

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

  const setToMax = () => {
    submitApprovalAmount(MAX_UINT256.toString(10), 'unlimited')
  }

  const setToRevoke = () => {
    submitApprovalAmount('0', 'revoke', '0')
  }

  const customAmount = parseTokenDecimalAmount(custom, decimals)
  const submitCustomAmount = () => {
    const nextAmount = custom === '' ? requestedValue : customAmount
    if (nextAmount === undefined) {
      releaseApprovalSubmission()
      return
    }
    if (custom === '') return resetToRequestAmount()
    submitApprovalAmount(nextAmount.toString(10), 'custom')
  }

  const isRevoke = canRevoke && parsedAmount === 0n
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

  return (
    <div className='updateTokenApproval'>
      <ClusterBox title={'Token approval details'} style={{ marginTop: '64px' }}>
        <Cluster>
          <Details
            {...{
              address: spender.address,
              name: spender.ens,
              copyLabel: 'Copy spender address'
            }}
          />
          <Description
            {...{
              isRevoke,
              mode,
              custom
            }}
          />
          <Details
            {...{
              address: contract.address,
              name,
              copyLabel: 'Copy token contract address'
            }}
          />
          {deadline && (
            <ClusterRow>
              <ClusterValue>
                <Countdown
                  end={deadline}
                  title={'Permission expires in'}
                  innerClass='clusterFocusHighlight'
                  titleClass='clusterFocus'
                />
              </ClusterValue>
            </ClusterRow>
          )}
        </Cluster>

        <Cluster style={{ marginTop: '16px' }}>
          <ClusterRow>
            <ClusterValue>
              <div className='approveTokenSpendAmountLabel'>{symbol}</div>
            </ClusterValue>
          </ClusterRow>
          <ClusterRow>
            <ClusterValue transparent={true} pointerEvents={'auto'}>
              <div className='approveTokenSpendAmount'>
                {isCustom && custom !== '' && customAmount === undefined ? (
                  <div
                    role='alert'
                    className='approveTokenSpendAmountSubmit approveTokenSpendAmountStatus'
                    style={{ color: 'var(--bad)' }}
                  >
                    {'Invalid amount'}
                  </div>
                ) : isCustom && customAmount !== undefined && amountValue !== customAmount ? (
                  <button
                    type='button'
                    className='approveTokenSpendAmountSubmit'
                    disabled={approvalSubmitting}
                    onClick={(event) => activateOnce(event, submitCustomAmount)}
                  >
                    {'Update'}
                  </button>
                ) : (
                  <div
                    key={mode + amount}
                    className='approveTokenSpendAmountSubmit approveTokenSpendAmountStatus'
                    role='status'
                    aria-label='Approval amount applied'
                    style={{ color: 'var(--good)' }}
                  >
                    <Icon name='check' size={20} />
                  </div>
                )}
                {mode === 'custom' ? (
                  <input
                    autoFocus
                    type='text'
                    maxLength={MAX_TOKEN_AMOUNT_INPUT_LENGTH}
                    aria-label='Custom amount'
                    value={custom}
                    disabled={approvalSubmitting}
                    onChange={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      updateCustomAmount(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.target.blur()
                        submitCustomAmount()
                      }
                    }}
                  />
                ) : inputLock ? (
                  <div className='approveTokenSpendAmountNoInput' style={{ cursor: 'default' }}>
                    {displayAmount}
                  </div>
                ) : (
                  <button
                    type='button'
                    aria-label={`Edit approval amount, current ${displayAmount}`}
                    className='approveTokenSpendAmountNoInput'
                    disabled={approvalSubmitting}
                    onClick={() => {
                      setCustom('')
                      setMode('custom')
                    }}
                  >
                    {displayAmount}
                  </button>
                )}
              </div>
            </ClusterValue>
          </ClusterRow>
          <ClusterRow>
            <ClusterValue transparent={true}>
              <div className='approveTokenSpendAmountSubtitle'>Token approval spending limit</div>
            </ClusterValue>
          </ClusterRow>
          {!hasInvalidAmount && (
            <>
              {canRevoke && (
                <ClusterRow>
                  <ClusterValue pointerEvents={'auto'}>
                    <button
                      type='button'
                      className='clusterTag clusterTagButton'
                      disabled={approvalSubmitting}
                      style={mode === 'revoke' ? { color: 'var(--good)' } : {}}
                      aria-pressed={mode === 'revoke'}
                      onClick={(event) => activateOnce(event, setToRevoke)}
                    >
                      {'Revoke'}
                    </button>
                  </ClusterValue>
                </ClusterRow>
              )}
              <ClusterRow>
                <ClusterValue pointerEvents={'auto'}>
                  <button
                    type='button'
                    className='clusterTag clusterTagButton'
                    disabled={approvalSubmitting}
                    style={mode === 'requested' ? { color: 'var(--good)' } : {}}
                    aria-pressed={mode === 'requested'}
                    onClick={(event) => activateOnce(event, resetToRequestAmount)}
                  >
                    {'Requested'}
                  </button>
                </ClusterValue>
              </ClusterRow>
              <ClusterRow>
                <ClusterValue pointerEvents={'auto'}>
                  <button
                    type='button'
                    className='clusterTag clusterTagButton'
                    disabled={approvalSubmitting}
                    style={mode === 'unlimited' ? { color: 'var(--good)' } : {}}
                    aria-pressed={mode === 'unlimited'}
                    onClick={(event) => activateOnce(event, setToMax)}
                  >
                    {'Unlimited'}
                  </button>
                </ClusterValue>
              </ClusterRow>
              {!inputLock && (
                <ClusterRow>
                  <ClusterValue pointerEvents={'auto'}>
                    <button
                      type='button'
                      className='clusterTag clusterTagButton'
                      disabled={approvalSubmitting}
                      style={isCustom ? { color: 'var(--good)' } : {}}
                      aria-pressed={isCustom}
                      onClick={() => {
                        releaseApprovalSubmission()
                        setMode('custom')
                        setCustom('')
                      }}
                    >
                      Custom
                    </button>
                  </ClusterValue>
                </ClusterRow>
              )}
            </>
          )}
        </Cluster>
      </ClusterBox>
    </div>
  )
}

export default EditTokenSpend
