import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

// New Tx
import TxMain from './TxMainNew'
import TxValue from './TxValue'
import TxFee from './TxFee'
import TxAction from './TxAction'
import TxRecipient from './TxRecipient'
import AdjustFee from './AdjustFee'
import ViewData from './ViewData'
import NonceControl from './NonceControl'
import EditTokenSpend from '../../../../../resources/Components/EditTokenSpend'
import link from '../../../../../resources/link'
import { erc20Interface } from '../../../../../resources/contracts'

export class TransactionRequest extends React.Component {
  renderAdjustFee() {
    const { req } = this.props
    return <AdjustFee req={req} />
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

  renderTx() {
    const { req } = this.props
    if (!req) return null

    let requestClass = 'signerRequest cardShow'
    const success = req.status === 'confirming' || req.status === 'confirmed'
    const error = req.status === 'error' || req.status === 'declined'
    if (success) requestClass += ' signerRequestSuccess'
    if (req.status === 'confirmed') requestClass += ' signerRequestConfirmed'
    else if (error) requestClass += ' signerRequestError'

    const chain = {
      type: 'ethereum',
      id: parseInt(req.data.chainId, 'hex')
    }

    const recognizedActions = req.recognizedActions || []
    const isNativeTransfer = req.classification === 'NATIVE_TRANSFER'

    return (
      <div key={req.handlerId} className={requestClass}>
        {req.type === 'transaction' ? (
          <div className='approveTransaction'>
            <div className='approveTransactionPayload'>
              <div className='_txBody'>
                <TxMain i={0} {...this.props} req={req} chain={chain} />
                {!isNativeTransfer && <TxValue i={1} {...this.props} req={req} chain={chain} />}
                {recognizedActions.map((action, i) => {
                  return (
                    <TxAction
                      key={'action' + action.type + i}
                      i={2 + i}
                      {...this.props}
                      req={req}
                      chain={chain}
                      action={action}
                    />
                  )
                })}
                <TxRecipient i={3 + recognizedActions.length} {...this.props} req={req} />
                <TxFee i={4 + recognizedActions.length} {...this.props} req={req} />
                <div className='_txMain transactionReviewNonce'>
                  <div className='transactionReviewNonceRow'>
                    <span className='transactionReviewMetaLabel'>Nonce</span>
                    <NonceControl req={req} hint='Transaction sequence' />
                  </div>
                </div>
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
    const { step } = this.props
    switch (step) {
      case 'adjustFee':
        return this.renderAdjustFee()
      case 'adjustApproval':
        return this.renderTokenSpend()
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
