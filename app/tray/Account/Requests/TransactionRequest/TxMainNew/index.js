import React from 'react'
import Restore from 'react-restore'

import RequestItem from '../../../../../../resources/Components/RequestItem'
import AddressIdentity from '../../../../../../resources/Components/AddressIdentity'
import { ClusterStatus } from '../../../../../../resources/Components/Cluster'
import { getReplacementStatus } from '../../../../../../resources/domain/transaction/replacement'
import { getOriginDisplayName } from '../../../../../../resources/domain/origin'
import { resolveLocalAddressIdentity } from '../../../../../../resources/domain/addressBook/identity'
import { getAddress } from '../../../../../../resources/utils'
import link from '../../../../../../resources/link'
import TxOverview from './overview'

const replacementNotices = {
  'nonce-used': 'nonce used',
  'gas-price-too-low': 'gas price too low',
  'gas-fees-too-low': 'gas fees too low'
}

export class TxMain extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      copied: false
    }
  }

  getReplacementStatus(req, r) {
    const status = getReplacementStatus(req, Object.values(r || {}))
    return { ...status, notice: replacementNotices[status.reason] || '' }
  }

  copyFromAddress(address) {
    link.send('tray:clipboardData', address)
    this.setState({ copied: true })
    clearTimeout(this.copyTimer)
    this.copyTimer = setTimeout(() => this.setState({ copied: false }), 1000)
  }

  componentWillUnmount() {
    clearTimeout(this.copyTimer)
  }

  render() {
    const req = this.props.req
    const chainId = parseInt(req.data.chainId, 16)
    const chainName = this.store('main.networks.ethereum', chainId, 'name')
    const chainMeta = this.store('main.networksMeta.ethereum', chainId) || {}
    const { nativeCurrency = {}, primaryColor, icon } = chainMeta
    const currentSymbol = nativeCurrency.symbol || '?'
    const isTestnet = this.store('main.networks.ethereum', chainId, 'isTestnet')
    const requestAccount = this.props.accountId || req.account
    const reqs = this.store('main.accounts', requestAccount, 'requests')
    const replacementStatus = this.getReplacementStatus(req, reqs)

    const originName = getOriginDisplayName(this.store('main.origins', req.origin, 'name'))
    const fromSource = req.data.from || requestAccount
    const fromAddress = fromSource ? getAddress(fromSource) : ''
    const fromIdentity = fromAddress
      ? resolveLocalAddressIdentity(this.store('main.addressBook'), this.store('main.accounts'), fromAddress)
      : undefined
    return (
      <div className='_txMain transactionReviewMain' style={{ animationDelay: 0.1 * this.props.i + 's' }}>
        <div className='_txMainInner'>
          <div
            className='_txMainBackground'
            style={{ background: `linear-gradient(135deg, var(--${primaryColor}) 0%, transparent 100%)` }}
          />
          <RequestItem
            req={req}
            account={requestAccount}
            handlerId={req.handlerId}
            title={`${chainName} Transaction`}
            color={primaryColor ? `var(--${primaryColor})` : ``}
            img={icon}
            headerMode={true}
          >
            <TxOverview
              req={req}
              chainName={chainName}
              chainColor={primaryColor}
              symbol={currentSymbol}
              replacementStatus={replacementStatus}
              originName={originName}
              currencyRate={nativeCurrency.usd}
              isTestnet={isTestnet}
            />
          </RequestItem>
          <div className='transactionReviewMeta'>
            <div className='transactionReviewSectionTitle'>Transaction details</div>
            {fromAddress ? (
              <button
                type='button'
                aria-label='Copy transaction sender address'
                className='transactionReviewAddress'
                onClick={() => this.copyFromAddress(fromAddress)}
              >
                <span className='transactionReviewMetaLabel'>From</span>
                <span className='transactionReviewAddressValue clusterAddress'>
                  <AddressIdentity
                    address={fromAddress}
                    copied={this.state.copied}
                    label={fromIdentity?.label}
                    source={fromIdentity?.source}
                  />
                </span>
              </button>
            ) : null}
            <ClusterStatus>{this.state.copied ? 'Transaction sender address copied' : ''}</ClusterStatus>
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(TxMain)
