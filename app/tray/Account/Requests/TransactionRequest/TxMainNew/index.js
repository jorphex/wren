import React from 'react'
import Restore from 'react-restore'

import RequestItem from '../../../../../../resources/Components/RequestItem'
import AddressIdentity from '../../../../../../resources/Components/AddressIdentity'
import { ClusterStatus } from '../../../../../../resources/Components/Cluster'
import { getReplacementStatus } from '../../../../../../resources/domain/transaction/replacement'
import { getOriginDisplayName } from '../../../../../../resources/domain/origin'
import { resolveLocalAddressIdentity } from '../../../../../../resources/domain/addressBook/identity'
import { getAddress } from '../../../../../../resources/utils'
import useCopiedMessage from '../../../../../../resources/Hooks/useCopiedMessage'
import link from '../../../../../../resources/link'
import TxOverview from './overview'

const replacementNotices = {
  'nonce-used': 'nonce used',
  'gas-price-too-low': 'gas price too low',
  'gas-fees-too-low': 'gas fees too low'
}

const CopyableDeploymentIdentity = ({ kind, value }) => {
  const [copied, copyValue] = useCopiedMessage(value, 1800)
  const label = kind === 'hash' ? 'deployment initcode hash' : 'provisional deployment address'
  const statusId = `transaction-review-deployment-${kind}-copy-status`
  return (
    <span className='transactionReviewDeploymentIdentity'>
      <button
        type='button'
        className='transactionReviewDeploymentHash transactionReviewDeploymentCopy'
        aria-label={`Copy ${label}`}
        aria-describedby={statusId}
        onClick={() => copyValue()}
      >
        {value}
      </button>
      <span id={statusId} className='transactionReviewDeploymentCopyStatus' role='status' aria-live='polite'>
        {copied ? `${kind === 'hash' ? 'Hash' : 'Address'} copied` : ''}
      </span>
    </span>
  )
}

export const DeploymentReviewEvidence = ({ deployment }) => {
  if (!deployment) return null
  let nonce
  try {
    nonce = deployment.pendingNonce ? BigInt(deployment.pendingNonce).toString(10) : undefined
  } catch {
    nonce = undefined
  }
  return (
    <div
      className='transactionReviewDeployment'
      role='group'
      aria-labelledby='transaction-review-deployment-title'
    >
      <div id='transaction-review-deployment-title' className='transactionReviewDeploymentTitle'>
        Prepared deployment evidence
      </div>
      <div className='transactionReviewDeploymentRow'>
        <span className='transactionReviewMetaLabel'>Deployment data</span>
        <span className='transactionReviewDeploymentValue'>
          <span>{`${deployment.initcodeBytes} bytes`}</span>
          <CopyableDeploymentIdentity kind='hash' value={deployment.initcodeHash} />
        </span>
      </div>
      {deployment.provisionalAddress ? (
        <div className='transactionReviewDeploymentRow'>
          <span className='transactionReviewMetaLabel'>Provisional address</span>
          <span className='transactionReviewDeploymentValue'>
            <CopyableDeploymentIdentity kind='address' value={deployment.provisionalAddress} />
            <span className='transactionReviewDeploymentNote'>
              {nonce
                ? `Based on pending nonce ${nonce}. This address may change before signing.`
                : 'This address may change before signing.'}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  )
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
                    label={fromIdentity?.label}
                    revealOnHover={false}
                    source={fromIdentity?.source}
                  />
                </span>
                <span
                  aria-hidden='true'
                  className={`transactionReviewCopyFeedback${this.state.copied ? ' transactionReviewCopyFeedbackVisible' : ''}`}
                >
                  Address copied
                </span>
              </button>
            ) : null}
            <DeploymentReviewEvidence deployment={req.deployment} />
            <ClusterStatus>{this.state.copied ? 'Transaction sender address copied' : ''}</ClusterStatus>
          </div>
        </div>
      </div>
    )
  }
}

export default Restore.connect(TxMain)
