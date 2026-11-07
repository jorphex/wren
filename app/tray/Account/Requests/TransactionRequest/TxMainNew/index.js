import React from 'react'
import Restore from 'react-restore'

import RequestItem from '../../../../../../resources/Components/RequestItem'
import { getReplacementStatus } from '../../../../../../resources/domain/transaction/replacement'
import { getOriginDisplayName } from '../../../../../../resources/domain/origin'
import useCopiedMessage from '../../../../../../resources/Hooks/useCopiedMessage'
import TxOverview from './overview'

const replacementNotices = {
  'nonce-used': 'nonce used',
  'gas-price-too-low': 'gas price too low',
  'gas-fees-too-low': 'gas fees too low'
}

const CopyableDeploymentIdentity = ({ kind, note, value }) => {
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
        <span className='transactionReviewDeploymentCopyValue'>{value}</span>
        {note ? <span className='transactionReviewDeploymentNote'>{note}</span> : null}
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
        Deployment details
      </div>
      <div className='transactionReviewDeploymentRow'>
        <span className='transactionReviewMetaLabel'>Contract code</span>
        <span className='transactionReviewDeploymentValue'>
          <span>{`${deployment.initcodeBytes} bytes`}</span>
          <CopyableDeploymentIdentity kind='hash' value={deployment.initcodeHash} />
        </span>
      </div>
      {deployment.provisionalAddress ? (
        <div className='transactionReviewDeploymentRow'>
          <span className='transactionReviewMetaLabel'>Address</span>
          <span className='transactionReviewDeploymentValue'>
            <CopyableDeploymentIdentity
              kind='address'
              note={
                nonce
                  ? `Provisional address · Based on pending nonce ${nonce}; it may change before signing.`
                  : 'Provisional address · It may change before signing.'
              }
              value={deployment.provisionalAddress}
            />
          </span>
        </div>
      ) : null}
    </div>
  )
}

export class TxMain extends React.Component {
  getReplacementStatus(req, r) {
    const status = getReplacementStatus(req, Object.values(r || {}))
    return { ...status, notice: replacementNotices[status.reason] || '' }
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
    const balances = this.store('main.balances', requestAccount) || []
    const tokenFor = (address) =>
      balances.find(
        (balance) =>
          balance.chainId === chainId &&
          typeof balance.address === 'string' &&
          balance.address.toLowerCase() === address.toLowerCase()
      )
    const reqs = this.store('main.accounts', requestAccount, 'requests')
    const replacementStatus = this.getReplacementStatus(req, reqs)
    const approvalReview = (req.recognizedActions || []).some((action) => action.id === 'erc20:approve')

    const originName = getOriginDisplayName(this.store('main.origins', req.origin, 'name'))
    return (
      <div
        className={`_txMain transactionReviewMain${approvalReview ? ' transactionReviewMainApproval' : ''}`}
        style={{ animationDelay: 0.1 * this.props.i + 's' }}
      >
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
              tokenFor={tokenFor}
            />
          </RequestItem>
          <DeploymentReviewEvidence deployment={req.deployment} />
        </div>
      </div>
    )
  }
}

export default Restore.connect(TxMain)
