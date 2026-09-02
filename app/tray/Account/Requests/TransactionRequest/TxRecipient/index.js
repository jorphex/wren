import React from 'react'
import Restore from 'react-restore'

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
import { getAddress } from '../../../../../../resources/utils'

const YEARN_ACTION_LABELS = {
  approve: 'Yearn token approval',
  deposit: 'Yearn vault deposit',
  withdraw: 'Yearn vault withdrawal',
  stake: 'Yearn vault stake',
  'start-cooldown': 'Start Yearn cooldown',
  'cancel-cooldown': 'Cancel Yearn cooldown'
}

class TxRecipient extends React.Component {
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
    const address = req.data.to ? getAddress(req.data.to) : ''
    if (!address) return null

    const ensName = req.recipient && req.recipient.length < 25 ? req.recipient : ''
    const localIdentity = address
      ? resolveLocalAddressIdentity(this.store('main.addressBook'), this.store('main.accounts'), address)
      : undefined
    const yearnAction = (req.recognizedActions || []).find(({ id }) => id?.startsWith('yearn:'))
    const yearnData = yearnAction?.data || {}
    const addressSafety = addressSafetyTarget(req.addressSafety, address)
    const title = yearnAction
      ? 'Calling Yearn Contract'
      : req.recipientType === 'contract'
        ? 'Calling Contract'
        : 'Recipient Account'
    return (
      <ClusterBox className='transactionReviewRecipient' title={title} animationSlot={this.props.i}>
        <Cluster>
          <ClusterRow>
            <ClusterValue
              ariaLabel='Copy transaction recipient address'
              pointerEvents={true}
              onClick={() => {
                this.copyAddress(address)
              }}
            >
              <span className='transactionReviewMetaLabel transactionReviewRecipientLabel'>To</span>
              <div className='clusterAddress'>
                <AddressIdentity
                  address={address}
                  complete={true}
                  emphasizeEnds={addressSafety?.state === 'lookalike'}
                  label={localIdentity?.label || ensName}
                  revealOnHover={false}
                  source={localIdentity?.source || (ensName ? 'ENS' : '')}
                />
                <AddressSafetyStatus address={address} assessment={req.addressSafety} />
              </div>
              <span
                aria-hidden='true'
                className={`transactionReviewCopyFeedback${this.state.copied ? ' transactionReviewCopyFeedbackVisible' : ''}`}
              >
                Address copied
              </span>
            </ClusterValue>
            <ClusterStatus>{this.state.copied ? 'Transaction recipient address copied' : ''}</ClusterStatus>
          </ClusterRow>

          {req.decodedData && req.decodedData.method ? (
            <ClusterRow>
              <ClusterValue>
                <span className={'clusterTag'} style={{ color: 'var(--good)', fontSize: '16px' }}>
                  {(() => {
                    if (req.decodedData.method.length > 17) return `${req.decodedData.method.substr(0, 15)}..`
                    return req.decodedData.method
                  })()}
                </span>
              </ClusterValue>
            </ClusterRow>
          ) : yearnAction ? (
            <ClusterRow>
              <ClusterValue>
                <div className='clusterTag' style={{ color: 'var(--good)' }}>
                  {YEARN_ACTION_LABELS[yearnData.action] || 'Allowlisted Yearn action'}
                </div>
              </ClusterValue>
            </ClusterRow>
          ) : req.recipientType === 'contract' ? (
            <ClusterRow>
              <ClusterValue>
                <div className='clusterTag'>
                  {req.calldataDecodeStatus === 'pending'
                    ? 'Identifying contract method…'
                    : 'Contract method not decoded'}
                </div>
              </ClusterValue>
            </ClusterRow>
          ) : null}
          {yearnAction ? (
            <ClusterRow>
              <ClusterValue>
                <div className='clusterTag'>Allowlisted vault: {yearnData.vaultName}</div>
              </ClusterValue>
            </ClusterRow>
          ) : null}
          {req.decodedData && req.decodedData.source && (
            <ClusterRow>
              <ClusterValue>
                <div className='clusterTag'>{'abi source: ' + req.decodedData.source}</div>
              </ClusterValue>
            </ClusterRow>
          )}
        </Cluster>
      </ClusterBox>
    )
  }
}

export default Restore.connect(TxRecipient)
