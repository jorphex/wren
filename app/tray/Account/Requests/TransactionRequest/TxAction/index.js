import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import link from '../../../../../../resources/link'
import {
  ClusterBox,
  Cluster,
  ClusterRow,
  ClusterStatus,
  ClusterValue
} from '../../../../../../resources/Components/Cluster'
import AddressIdentity from '../../../../../../resources/Components/AddressIdentity'
import AddressSafetyStatus, {
  addressSafetyTarget
} from '../../../../../../resources/Components/AddressSafetyStatus'
import { resolveLocalAddressIdentity } from '../../../../../../resources/domain/addressBook/identity'
import { formatDisplayDecimal, isUnlimited } from '../../../../../../resources/utils/numbers'
import { DisplayValue, DisplayCoinBalance } from '../../../../../../resources/Components/DisplayValue'
import { getAddress } from '../../../../../../resources/utils'

const MAX_UINT256_DECIMAL = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

const formatYearnAmount = (amountRaw, decimals) => new BigNumber(amountRaw).shiftedBy(-decimals).toFixed()

export const getYearnIntentLines = (actionType, data = {}) => {
  const { amountRaw, amountType, decimals, outputSymbol, symbol, vaultName } = data
  const amount =
    amountRaw !== undefined && decimals !== undefined
      ? `${formatYearnAmount(amountRaw, decimals)} ${symbol || ''}`.trim()
      : ''
  const vaultShares = outputSymbol || (vaultName ? `${vaultName} shares` : 'vault shares')

  if (actionType === 'deposit') {
    return [
      amount ? `Send ${amount}` : 'Send the selected assets',
      `Receive ${vaultShares} at execution rate`
    ]
  }
  if (actionType === 'withdraw') {
    return amountType === 'shares'
      ? [amount ? `Redeem ${amount}` : 'Redeem vault shares', 'Receive underlying assets at execution rate']
      : [amount ? `Receive ${amount}` : 'Receive underlying assets', 'Burn the shares required at execution']
  }
  if (actionType === 'stake') {
    return [
      amount ? `Stake ${amount}` : 'Stake the selected vault shares',
      `Receive ${outputSymbol || 'staked vault shares'}`
    ]
  }
  if (actionType === 'start-cooldown') {
    return [
      amount ? `Move ${amount} into cooldown` : 'Move locked shares into cooldown',
      'No assets are withdrawn yet'
    ]
  }
  if (actionType === 'cancel-cooldown') return ['Return cooling shares to the locked position']
  if (actionType === 'approve') {
    if (amountRaw === '0') return [`Revoke ${symbol || 'token'} allowance`]
    if (amountRaw === MAX_UINT256_DECIMAL) return [`Grant unlimited ${symbol || 'token'} allowance`]
    return [amount ? `Set allowance to ${amount}` : 'Set the requested token allowance']
  }
  return []
}

export class TxSending extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      copied: false
    }
  }
  copyAddress(data) {
    link.send('tray:clipboardData', data)
    this.setState({ copied: true })
    clearTimeout(this.copyTimer)
    this.copyTimer = setTimeout(() => this.setState({ copied: false }), 1000)
  }
  componentWillUnmount() {
    clearTimeout(this.copyTimer)
  }
  render() {
    const req = this.props.req
    const contract = req.data.to.toLowerCase()
    const chainId = parseInt(req.data.chainId, 16)
    const chainName = this.store('main.networks.ethereum', chainId, 'name')

    const { action } = this.props
    const [actionClass, actionType] = action.id.split(':')

    if (actionClass === 'yearn') {
      const {
        amountRaw,
        amountType,
        decimals,
        owner,
        receiver,
        symbol,
        spender,
        token,
        vaultName,
        maxLossBps
      } = action.data || {}
      const unlimitedApproval = actionType === 'approve' && amountRaw === MAX_UINT256_DECIMAL
      const labels = {
        approve:
          amountRaw === '0'
            ? 'Revoke Yearn Approval'
            : unlimitedApproval
              ? 'Unlimited Yearn Approval'
              : 'Exact Yearn Approval',
        deposit: 'Yearn Vault Deposit',
        withdraw: 'Yearn Vault Withdrawal',
        stake: 'Stake Yearn Position',
        'start-cooldown': 'Start Yearn Cooldown',
        'cancel-cooldown': 'Cancel Yearn Cooldown'
      }
      const displayAmount =
        amountRaw !== undefined && decimals !== undefined
          ? unlimitedApproval
            ? `Unlimited ${symbol || ''}`.trim()
            : `${formatYearnAmount(amountRaw, decimals)} ${symbol || ''}`.trim()
          : amountRaw
      const amountLabel =
        actionType === 'approve'
          ? 'Allowance'
          : amountType === 'shares'
            ? 'Vault shares'
            : actionType === 'withdraw'
              ? 'Vault assets'
              : 'Input assets'
      const intentLines = getYearnIntentLines(actionType, action.data)

      return (
        <ClusterBox
          title={labels[actionType] || 'Yearn Vault Action'}
          subtitle={vaultName}
          animationSlot={this.props.i}
        >
          <Cluster>
            {displayAmount ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterFocus'>
                    <div>{amountLabel}</div>
                    <div className='clusterFocusHighlight'>{displayAmount}</div>
                  </div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
            <ClusterRow>
              <ClusterValue>
                <div className='clusterTag'>
                  {actionType === 'approve'
                    ? 'Token approval for allowlisted Yearn spender'
                    : 'Allowlisted Yearn contract'}{' '}
                  on {chainName || 'unknown network'} (chain {chainId})
                </div>
              </ClusterValue>
            </ClusterRow>
            {spender ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag' style={unlimitedApproval ? { color: 'var(--bad)' } : {}}>
                    {unlimitedApproval
                      ? 'Unlimited approval'
                      : amountRaw === '0'
                        ? 'Revoke spender'
                        : 'Exact approval'}
                    : {spender}
                  </div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
            {token ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag'>Token contract: {token}</div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
            {receiver ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag'>Receiver: {receiver}</div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
            {owner ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag'>Share owner: {owner}</div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
            {intentLines.length ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterFocus'>
                    <div>Expected from verified calldata</div>
                    {intentLines.map((line) => (
                      <div className='clusterFocusHighlight' key={line}>
                        {line}
                      </div>
                    ))}
                    <div className='clusterTag'>
                      Intent only; RPC-reported effects appear separately when supported.
                    </div>
                  </div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
            {maxLossBps === 0 ? (
              <ClusterRow>
                <ClusterValue>
                  <div className='clusterTag'>Vault loss tolerance: 0%</div>
                </ClusterValue>
              </ClusterRow>
            ) : null}
          </Cluster>
        </ClusterBox>
      )
    }

    if (actionClass === 'erc20') {
      if (actionType === 'transfer') {
        const {
          amount,
          decimals,
          name,
          recipient: { address: recipientAddress, type: recipientType, ens: recipientEns },
          symbol
        } = action.data || {}
        const address = getAddress(recipientAddress)
        const distinctSafetyTarget =
          typeof address === 'string' && address.toLowerCase() !== req.data.to?.toLowerCase()
        const localIdentity = resolveLocalAddressIdentity(
          this.store('main.addressBook'),
          this.store('main.accounts'),
          address
        )

        const isTestnet = this.store('main.networks', this.props.chain.type, this.props.chain.id, 'isTestnet')
        const rate = this.store('main.rates', contract)

        return (
          <ClusterBox title={`Sending ${symbol}`} subtitle={name} animationSlot={this.props.i}>
            <Cluster>
              <ClusterRow>
                <ClusterValue grow={2}>
                  <div className='txSendingValue'>
                    <DisplayCoinBalance amount={amount} decimals={decimals} symbol={symbol} />
                  </div>
                </ClusterValue>
                <ClusterValue>
                  <span className='_txMainTransferringEq'>{isTestnet ? '=' : '≈'}</span>
                  <DisplayValue
                    type='fiat'
                    value={amount}
                    valueDataParams={{ currencyRate: rate && rate.usd, isTestnet, decimals }}
                    currencySymbol='$'
                  />
                </ClusterValue>
              </ClusterRow>
              {address && recipientType === 'contract' ? (
                <ClusterRow>
                  <ClusterValue>
                    <div className='clusterTag'>{`to contract on ${chainName}`}</div>
                  </ClusterValue>
                </ClusterRow>
              ) : address ? (
                <ClusterRow>
                  <ClusterValue>
                    <div className='clusterTag'>{`to account on ${chainName}`}</div>
                  </ClusterValue>
                </ClusterRow>
              ) : null}

              {address && (
                <ClusterRow>
                  <ClusterValue
                    ariaLabel='Copy token transfer recipient address'
                    pointerEvents={true}
                    onClick={() => {
                      this.copyAddress(address)
                    }}
                  >
                    <div className='clusterAddress'>
                      <AddressIdentity
                        address={address}
                        complete={true}
                        copied={this.state.copied}
                        emphasizeEnds={addressSafetyTarget(req.addressSafety, address)?.state === 'lookalike'}
                        label={localIdentity?.label || recipientEns}
                        revealOnHover={false}
                        source={localIdentity?.source || (recipientEns ? 'ENS' : '')}
                      />
                      {distinctSafetyTarget ? (
                        <AddressSafetyStatus address={address} assessment={req.addressSafety} />
                      ) : null}
                    </div>
                  </ClusterValue>
                  <ClusterStatus>
                    {this.state.copied ? 'Transfer recipient address copied' : ''}
                  </ClusterStatus>
                </ClusterRow>
              )}
            </Cluster>
          </ClusterBox>
        )
      } else if (actionType === 'approve') {
        const {
          amount,
          decimals,
          spender: { address: recipientAddress, ens: spenderEns },
          symbol
        } = action.data || {}
        const address = recipientAddress
        const distinctSafetyTarget =
          typeof address === 'string' && address.toLowerCase() !== req.data.to?.toLowerCase()
        const localIdentity = resolveLocalAddressIdentity(
          this.store('main.addressBook'),
          this.store('main.accounts'),
          address
        )
        const value = new BigNumber(amount)
        const revoke = value.eq(0)
        const displayAmount = isUnlimited(this.state.amount)
          ? 'unlimited'
          : formatDisplayDecimal(amount, decimals)
        const isSubmitted = req.status !== undefined

        return (
          <ClusterBox title={'Token Approval'} animationSlot={this.props.i}>
            <Cluster>
              {revoke ? (
                <ClusterRow>
                  <ClusterValue
                    ariaLabel={!isSubmitted ? `Edit ${symbol} approval` : undefined}
                    onClick={
                      !isSubmitted
                        ? () => {
                            link.send('nav:update', 'panel', {
                              data: {
                                step: 'adjustApproval',
                                actionId: action.id,
                                requestedAmountHex: amount
                              }
                            })
                          }
                        : undefined
                    }
                    style={isSubmitted ? { cursor: 'auto' } : {}}
                  >
                    <div className='clusterFocus'>
                      <div>{`Revoking Approval To Spend `}</div>
                      <div className='clusterFocusHighlight'>{`${symbol}`}</div>
                    </div>
                  </ClusterValue>
                </ClusterRow>
              ) : (
                <ClusterRow>
                  <ClusterValue
                    ariaLabel={!isSubmitted ? `Edit ${symbol} approval` : undefined}
                    onClick={
                      !isSubmitted
                        ? () => {
                            link.send('nav:update', 'panel', {
                              data: {
                                step: 'adjustApproval',
                                actionId: action.id,
                                requestedAmountHex: amount
                              }
                            })
                          }
                        : undefined
                    }
                    style={isSubmitted ? { cursor: 'auto' } : {}}
                  >
                    <div className='clusterFocus'>
                      <div>{`Granting Approval To Spend`}</div>
                      <div className='clusterFocusHighlight'>{`${displayAmount} ${symbol}`}</div>
                    </div>
                  </ClusterValue>
                </ClusterRow>
              )}
              {address && (
                <ClusterRow>
                  <ClusterValue
                    ariaLabel='Copy token approval spender address'
                    pointerEvents={true}
                    onClick={() => {
                      this.copyAddress(address)
                    }}
                  >
                    <div className='clusterAddress'>
                      <AddressIdentity
                        address={address}
                        complete={true}
                        copied={this.state.copied}
                        emphasizeEnds={addressSafetyTarget(req.addressSafety, address)?.state === 'lookalike'}
                        label={localIdentity?.label || spenderEns}
                        revealOnHover={false}
                        source={localIdentity?.source || (spenderEns ? 'ENS' : '')}
                      />
                      {distinctSafetyTarget ? (
                        <AddressSafetyStatus address={address} assessment={req.addressSafety} />
                      ) : null}
                    </div>
                  </ClusterValue>
                  <ClusterStatus>{this.state.copied ? 'Approval spender address copied' : ''}</ClusterStatus>
                </ClusterRow>
              )}
            </Cluster>
          </ClusterBox>
        )
      }
    }
  }
}

export default Restore.connect(TxSending)
