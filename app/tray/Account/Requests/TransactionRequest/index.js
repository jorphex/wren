import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

// New Tx
import TxMain from './TxMainNew'
import TxFee from './TxFee'
import TxAction from './TxAction'
import TxRecipient from './TxRecipient'
import ViewData from './ViewData'
import NonceControl from './NonceControl'
import EditTokenSpend from '../../../../../resources/Components/EditTokenSpend'
import link from '../../../../../resources/link'
import { erc20Interface } from '../../../../../resources/contracts'
import { ReviewDetails } from '../../../../../resources/Components/SigningReview'
import { TransactionDataRow } from './TxMainNew/overview'
import ReviewAcknowledgements from '../ReviewAcknowledgements'

export class TransactionRequest extends React.Component {
  isReadOnly(req) {
    if (req.mode === 'monitor') return false
    const activeRequestId = this.store('main.accounts', req.account, 'activeRequestId')
    return activeRequestId !== req.handlerId
  }

  decodeRequested(req) {
    const calldata = req.payload.params[0].data
    const [spender, amount] = erc20Interface.decodeFunctionData('approve', calldata)
    return { spender, amount: BigNumber(amount.toString()) }
  }

  renderTokenSpend() {
    const crumb = this.store('windows.panel.nav')[0] || {}
    const { actionId } = crumb.data
    const { req } = this.props
    if (!req) return null

    const { handlerId } = req
    const approval = (req.recognizedActions || []).find((action) => action.id === actionId)
    if (!approval) return null

    const { data } = approval

    const { amount: requestedAmount } = this.decodeRequested(req)

    return (
      <EditTokenSpend
        data={data}
        request={{ account: req.account, handlerId }}
        hideBalance={this.store('selected.hideBalances')}
        requestedAmount={requestedAmount}
        updateRequest={(amount, callback = () => {}) =>
          link.rpc('updateRequest', req.account, handlerId, { amount }, actionId, callback)
        }
        canRevoke={true}
      />
    )
  }

  renderViewData() {
    return <ViewData {...this.props} />
  }

  renderTx(feeInitiallyExpanded = false) {
    const { queueContext, req } = this.props
    if (!req) return null
    const readOnly = this.isReadOnly(req)

    let requestClass = 'signerRequest cardShow'
    const success = req.status === 'confirming' || req.status === 'confirmed'
    const error = req.status === 'error'
    const declined = req.status === 'declined'
    if (success) requestClass += ' signerRequestSuccess'
    if (req.status === 'confirmed') requestClass += ' signerRequestConfirmed'
    else if (error) requestClass += ' signerRequestError'
    else if (declined) requestClass += ' signerRequestDeclined'

    const chain = {
      type: 'ethereum',
      id: parseInt(req.data.chainId, 'hex')
    }

    const recognizedActions = req.recognizedActions || []
    const approval = recognizedActions.some((action) => action.id === 'erc20:approve')
    const actions = recognizedActions.map((action, i) => (
      <TxAction
        key={'action' + action.type + i}
        i={2 + i}
        {...this.props}
        req={req}
        readOnly={readOnly}
        chain={chain}
        action={action}
        compact
      />
    ))
    return (
      <div
        key={req.handlerId}
        className={requestClass}
        aria-disabled={declined || undefined}
        inert={declined || undefined}
      >
        {req.type === 'transaction' ? (
          <div className='approveTransaction'>
            {queueContext ? (
              <div className='transactionReviewQueueContext' role='status'>
                <span>{`${queueContext.pendingSignatures} pending ${
                  queueContext.pendingSignatures === 1 ? 'signature' : 'signatures'
                }`}</span>
                <strong>{`${readOnly ? 'Queued' : 'Current'} request ${queueContext.position} of ${
                  queueContext.total
                } · ${
                  readOnly
                    ? 'waiting for earlier requests'
                    : queueContext.position === 1
                      ? 'oldest pending'
                      : queueContext.position === queueContext.total
                        ? 'newest pending'
                        : 'FIFO order'
                }`}</strong>
              </div>
            ) : null}
            {readOnly && !queueContext ? (
              <div className='transactionReviewQueueContext' role='status'>
                <span>Read-only</span>
                <strong>Waiting for earlier requests</strong>
              </div>
            ) : null}
            <div className='approveTransactionPayload'>
              <div className='_txBody'>
                <TxMain i={0} {...this.props} req={req} chain={chain} />
                {approval ? actions : null}
                <TxRecipient i={1} {...this.props} req={req} />
                {!approval ? actions : null}
                <ReviewAcknowledgements req={req} readOnly={readOnly} />
                <ReviewDetails initiallyOpen={feeInitiallyExpanded}>
                  <TxFee
                    i={2 + recognizedActions.length}
                    {...this.props}
                    req={req}
                    readOnly={readOnly}
                    initiallyExpanded={feeInitiallyExpanded}
                  />
                  <div className='_txMain transactionReviewNonce'>
                    <div className='transactionReviewNonceRow'>
                      <span className='transactionReviewMetaLabel'>Nonce</span>
                      <NonceControl req={req} hint='Transaction sequence' readOnly={readOnly} />
                    </div>
                  </div>
                  <TransactionDataRow method={req.decodedData?.method} />
                  {req.decodedData?.source ? (
                    <div className='signingReviewTechnical'>ABI source: {req.decodedData.source}</div>
                  ) : null}
                </ReviewDetails>
              </div>
            </div>
          </div>
        ) : (
          <div className='unknownType'>{'Unknown: ' + req.type}</div>
        )}
      </div>
    )
  }
  render() {
    const { req, step } = this.props
    const readOnly = req ? this.isReadOnly(req) : false
    switch (step) {
      case 'adjustFee':
        return this.renderTx(!readOnly)
      case 'adjustApproval':
        return readOnly ? this.renderTx() : this.renderTokenSpend()
      case 'viewData':
        return this.renderViewData()
      case 'confirm':
        return this.renderTx()
      default:
        return step
    }
  }
}

export default Restore.connect(TransactionRequest)
