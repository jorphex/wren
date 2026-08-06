import { useState } from 'react'

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

const Details = ({ address, name }) => {
  const [showCopiedMessage, copyAddress] = useCopiedMessage(address)

  return (
    <ClusterRow>
      <ClusterValue
        pointerEvents={'auto'}
        onClick={() => {
          copyAddress()
        }}
      >
        <div className='clusterAddress'>
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
              <span>{'Address Copied'}</span>
            ) : (
              <span className='clusterFira'>{address}</span>
            )}
          </div>
        </div>
      </ClusterValue>
    </ClusterRow>
  )
}

const Description = ({ isRevoke }) => (
  <ClusterRow>
    <ClusterValue>
      <div className='clusterTag' style={{ color: 'var(--moon)' }}>
        {isRevoke ? <span>{'revoke approval to spend'}</span> : <span>{'grant approval to spend'}</span>}
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

  const updateCustomAmount = (value) => {
    setMode('custom')
    setCustom(value)
  }

  const resetToRequestAmount = () => {
    setCustom(formatTokenBaseUnitAmount(requestedValue.toString(10), decimals) || requestedValue.toString(10))
    setMode('requested')
    updateHandlerRequest(requestedValue.toString(10))
  }

  const setToMax = () => {
    setMode('unlimited')
    updateHandlerRequest(MAX_UINT256.toString(10))
  }

  const setToRevoke = () => {
    setCustom('0')
    setMode('revoke')
    updateHandlerRequest('0')
  }

  const customAmount = parseTokenDecimalAmount(custom, decimals)
  const submitCustomAmount = () => {
    if (custom === '') return resetToRequestAmount()
    if (customAmount !== undefined) updateHandlerRequest(customAmount.toString(10))
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
      <ClusterBox title={'token approval details'} style={{ marginTop: '64px' }}>
        <Cluster>
          <Details
            {...{
              address: spender.address,
              name: spender.ens
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
              name
            }}
          />
          {deadline && (
            <ClusterRow>
              <ClusterValue>
                <Countdown
                  end={deadline}
                  title={'Permission Expires in'}
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
                  <div className='approveTokenSpendAmountSubmit' style={{ color: 'var(--bad)' }}>
                    {'invalid'}
                  </div>
                ) : isCustom && customAmount !== undefined && amountValue !== customAmount ? (
                  <div className='approveTokenSpendAmountSubmit' role='button' onClick={submitCustomAmount}>
                    {'update'}
                  </div>
                ) : (
                  <div
                    key={mode + amount}
                    className='approveTokenSpendAmountSubmit'
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
                    aria-label='Custom Amount'
                    value={custom}
                    onChange={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      updateCustomAmount(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.target.blur()
                        submitCustomAmount()
                      }
                    }}
                  />
                ) : (
                  <div
                    className='approveTokenSpendAmountNoInput'
                    role='textbox'
                    style={inputLock ? { cursor: 'default' } : null}
                    onClick={
                      inputLock
                        ? null
                        : () => {
                            setCustom('')
                            setMode('custom')
                          }
                    }
                  >
                    {displayAmount}
                  </div>
                )}
              </div>
            </ClusterValue>
          </ClusterRow>
          <ClusterRow>
            <ClusterValue transparent={true}>
              <div className='approveTokenSpendAmountSubtitle'>Set Token Approval Spend Limit</div>
            </ClusterValue>
          </ClusterRow>
          {!hasInvalidAmount && (
            <>
              {canRevoke && (
                <ClusterRow>
                  <ClusterValue onClick={setToRevoke}>
                    <div
                      className='clusterTag'
                      style={mode === 'revoke' ? { color: 'var(--good)' } : {}}
                      role='button'
                    >
                      {'Revoke'}
                    </div>
                  </ClusterValue>
                </ClusterRow>
              )}
              <ClusterRow>
                <ClusterValue onClick={() => resetToRequestAmount()}>
                  <div
                    className='clusterTag'
                    style={mode === 'requested' ? { color: 'var(--good)' } : {}}
                    role='button'
                  >
                    {'Requested'}
                  </div>
                </ClusterValue>
              </ClusterRow>
              <ClusterRow>
                <ClusterValue
                  onClick={() => {
                    setToMax()
                  }}
                >
                  <div
                    className='clusterTag'
                    style={mode === 'unlimited' ? { color: 'var(--good)' } : {}}
                    role='button'
                  >
                    {'Unlimited'}
                  </div>
                </ClusterValue>
              </ClusterRow>
              {!inputLock && (
                <ClusterRow>
                  <ClusterValue
                    onClick={() => {
                      setMode('custom')
                      setCustom('')
                    }}
                  >
                    <div
                      className={'clusterTag'}
                      style={isCustom ? { color: 'var(--good)' } : {}}
                      role='button'
                    >
                      Custom
                    </div>
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
