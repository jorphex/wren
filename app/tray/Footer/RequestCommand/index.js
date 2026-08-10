import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import TxBar from './TxBar'
import TxApproval from './TxApproval'
import Time from '../Time'

import Icon from '../../../../resources/Components/Icon'
import link from '../../../../resources/link'

import { usesBaseFee } from '../../../../resources/domain/transaction'
import {
  isCancelableRequest,
  isSignatureRequest,
  isTransactionFeeDraftSafe,
  subscribeToTransactionFeeDraftSafety
} from '../../../../resources/domain/request'
import { WATCH_ONLY_SIGNING_ERROR } from '../../../../resources/domain/signer'

const FEE_WARNING_THRESHOLD_USD = 50

export function canApproveTransaction(allowInput, simulation, feeDraftSafe = true) {
  return allowInput && simulation?.status !== 'pending' && feeDraftSafe
}

export function getReceiptFeeUsd(receipt, transactionData, nativeUSD) {
  if (!receipt || !nativeUSD) return null

  const paidGas =
    receipt.effectiveGasPrice || (parseInt(transactionData.type) < 2 ? transactionData.gasPrice : null)
  if (!paidGas) return null

  return BigNumber(receipt.gasUsed, 16)
    .multipliedBy(BigNumber(paidGas, 16))
    .shiftedBy(-18)
    .multipliedBy(nativeUSD)
    .toFixed(2, BigNumber.ROUND_HALF_UP)
}

export function getRequiredRequestApproval(req) {
  return !req?.status && (req?.approvals || []).find((approval) => !approval.approved)
}

export function isNoSignerError(error) {
  return error === 'No signer' || error === WATCH_ONLY_SIGNING_ERROR
}

export class RequestCommand extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      allowInput: false,
      dataView: false,
      feeDraftSafe: isTransactionFeeDraftSafe(props.req?.handlerId),
      signerLocked: false
    }

    this.scheduleTimer(
      'allowInputTimer',
      () => {
        this.setState({ allowInput: true })
      },
      props.signingDelay || 0
    )
  }

  scheduleTimer(name, callback, delay) {
    clearTimeout(this[name])
    this[name] = setTimeout(() => {
      this[name] = undefined
      callback()
    }, delay)
  }

  componentDidMount() {
    this.unsubscribeFeeDraftSafety = subscribeToTransactionFeeDraftSafety((handlerId) => {
      if (handlerId !== this.props.req?.handlerId) return
      this.setState({ feeDraftSafe: isTransactionFeeDraftSafe(handlerId) })
    })
  }

  componentWillUnmount() {
    ;['allowInputTimer', 'txHashCopiedTimer', 'signerLockedTimer'].forEach((name) => {
      clearTimeout(this[name])
      this[name] = undefined
    })
    if (this.unsubscribeFeeDraftSafety) this.unsubscribeFeeDraftSafety()
  }

  approve(reqId, req) {
    link.rpc('approveRequest', req, () => {}) // Move to link.send
  }

  decline(req) {
    link.rpc('declineRequest', req, () => {}) // Move to link.send
  }

  handleSignerCompatibilityFailure(error, compatibility, req) {
    if (!error && compatibility) return false

    if (isNoSignerError(error)) {
      this.store.notify('noSignerWarning', { req })
    } else if (error === 'Signer unavailable') {
      this.setState({ signerLocked: true })
      this.scheduleTimer(
        'signerLockedTimer',
        () => {
          this.setState({ signerLocked: false })
        },
        3000
      )
    } else {
      this.store.notify('signerUnavailableWarning', { req })
    }

    return true
  }

  toDisplayUSD(bn) {
    return bn.toFixed(2, BigNumber.ROUND_UP).toString()
  }

  declinedStatus(isTransaction) {
    const title = isTransaction ? 'Transaction declined' : 'Request declined'
    const message = isTransaction
      ? 'You declined this transaction. Nothing was signed or sent.'
      : 'Nothing was signed or sent.'

    return (
      <div className='requestNotice requestNoticeDeclined'>
        <div className='requestNoticeInner requestNoticeDeclinedInner' role='status'>
          <strong>{title}</strong>
          <span>{message}</span>
        </div>
      </div>
    )
  }

  sentStatus() {
    const { req } = this.props
    const { status } = req
    const chain = {
      type: 'ethereum',
      id: parseInt(req.data.chainId, 'hex')
    }

    const { isTestnet, explorer } = this.store('main.networks', chain.type, chain.id) || {}
    const nativeCurrency = this.store('main.networksMeta', chain.type, chain.id, 'nativeCurrency')
    const nativeUSD = nativeCurrency && nativeCurrency.usd && !isTestnet ? nativeCurrency.usd.price : 0

    let feeAtTime = '?.??'

    const receiptFeeUsd = getReceiptFeeUsd(req?.tx?.receipt, req.data, nativeUSD)
    if (receiptFeeUsd) feeAtTime = receiptFeeUsd

    const hash = req.tx?.hash
    const receipt = req.tx?.receipt
    const replaceable = Boolean(hash && !receipt && ['verifying', 'sent'].includes(status))
    const terminal = ['confirmed', 'error'].includes(status)

    return (
      <div className='txLifecycleEvidence'>
        {(hash || receipt) && (
          <dl className='txLifecycleFacts'>
            {hash && (
              <div>
                <dt>Transaction hash</dt>
                <dd title={hash}>{`${hash.slice(0, 10)}…${hash.slice(-8)}`}</dd>
              </div>
            )}
            {typeof req.tx?.confirmations === 'number' && (
              <div>
                <dt>Confirmations</dt>
                <dd>{req.tx.confirmations}</dd>
              </div>
            )}
            {receipt && (
              <>
                <div>
                  <dt>Block</dt>
                  <dd>{parseInt(receipt.blockNumber, 'hex')}</dd>
                </div>
                <div>
                  <dt>Network fee</dt>
                  <dd>{feeAtTime ? `$${feeAtTime}` : 'Unavailable'}</dd>
                </div>
              </>
            )}
          </dl>
        )}
        {receipt && req.completed && <Time time={req.completed} />}
        <div className='txLifecycleActions'>
          {replaceable && (
            <button
              type='button'
              className='txLifecycleAction txLifecycleActionBad'
              onClick={() => {
                link.send('tray:replaceTx', { account: req.account, handlerId: req.handlerId }, 'cancel')
              }}
            >
              Cancel
            </button>
          )}
          {hash && (
            <button
              type='button'
              className='txLifecycleAction'
              aria-expanded={Boolean(this.state.showHashDetails)}
              onClick={() => this.setState({ showHashDetails: !this.state.showHashDetails })}
            >
              View details
            </button>
          )}
          {replaceable && (
            <button
              type='button'
              className='txLifecycleAction txLifecycleActionGood'
              onClick={() => {
                link.send('tray:replaceTx', { account: req.account, handlerId: req.handlerId }, 'speed')
              }}
            >
              Speed Up
            </button>
          )}
          {terminal && (
            <button
              type='button'
              className='txLifecycleAction'
              onClick={() => link.send('nav:back', 'panel')}
            >
              Close
            </button>
          )}
        </div>
        {this.state.showHashDetails && hash && (
          <div className='txLifecycleDetails'>
            <span>{hash}</span>
            <div>
              {explorer && (
                <button
                  type='button'
                  onClick={() => {
                    if (this.store('main.mute.explorerWarning')) {
                      link.send('tray:openExplorer', chain, hash)
                    } else {
                      this.store.notify('openExplorer', { hash, chain })
                    }
                  }}
                >
                  Open Explorer
                </button>
              )}
              <button
                type='button'
                onClick={() => {
                  link.send('tray:copyTxHash', hash)
                  this.setState({ txHashCopied: true })
                  this.scheduleTimer('txHashCopiedTimer', () => this.setState({ txHashCopied: false }), 3000)
                }}
              >
                Copy Hash
              </button>
              <span className='txLifecycleCopyStatus' role='status' aria-live='polite'>
                {this.state.txHashCopied ? 'Transaction hash copied' : ''}
              </span>
            </div>
          </div>
        )}
        {isCancelableRequest(status) && (
          <button type='button' className='txLifecycleCancelRequest' onClick={() => this.decline(req)}>
            Cancel
          </button>
        )}
      </div>
    )
  }

  signOrDecline() {
    const { req } = this.props
    const allowApproval = canApproveTransaction(
      this.state.allowInput,
      req.simulation,
      this.state.feeDraftSafe
    )
    const chain = {
      type: 'ethereum',
      id: parseInt(req.data.chainId, 'hex')
    }
    const isTestnet = this.store('main.networks', chain.type, chain.id, 'isTestnet')
    const {
      nativeCurrency,
      nativeCurrency: { symbol: currentSymbol = '?' }
    } = this.store('main.networksMeta', chain.type, chain.id)
    const nativeUSD = nativeCurrency && nativeCurrency.usd && !isTestnet ? nativeCurrency.usd.price : 0

    const gasLimit = BigNumber(req.data.gasLimit, 16)
    const maxFeePerGas = BigNumber(usesBaseFee(req.data) ? req.data.maxFeePerGas : req.data.gasPrice, 16)
    const maxFee = maxFeePerGas.multipliedBy(gasLimit)
    const maxFeeUSD = maxFee.shiftedBy(-18).multipliedBy(nativeUSD)

    let displayStatus = req.status
    if (displayStatus === 'verifying') displayStatus = 'waiting for block'

    return (
      <div className='requestApprove requestApproveTransaction'>
        <div className='requestActionContext'>
          <span className='requestActionContextIcon'>
            <Icon name='verify' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>
              {req.simulation?.status === 'pending' ? 'Checking transaction' : 'Ready for review'}
            </strong>
            <span>Verify these details on your signer before approving.</span>
          </span>
        </div>
        <div className='requestActionButtons'>
          <button
            type='button'
            className='requestDecline'
            disabled={!this.state.allowInput}
            onClick={() => {
              if (this.state.allowInput) this.decline(req)
            }}
          >
            <span className='requestDeclineButton _txButton _txButtonBad'>
              <span>Decline</span>
            </span>
          </button>
          <button
            type='button'
            className={this.state.signerLocked ? 'requestSign headShake' : 'requestSign'}
            disabled={!allowApproval}
            onClick={() => {
              if (allowApproval) {
                link.rpc('signerCompatibility', req.account, req.handlerId, (e, compatibility) => {
                  if (this.handleSignerCompatibilityFailure(e, compatibility, req)) return

                  if (!compatibility.compatible && !this.store('main.mute.signerCompatibilityWarning')) {
                    this.store.notify('signerCompatibilityWarning', { req, compatibility, chain: chain })
                  } else if (
                    (maxFeeUSD.toNumber() > FEE_WARNING_THRESHOLD_USD ||
                      this.toDisplayUSD(maxFeeUSD) === '0.00') &&
                    !this.store('main.mute.gasFeeWarning')
                  ) {
                    this.store.notify('gasFeeWarning', {
                      req,
                      feeUSD: this.toDisplayUSD(maxFeeUSD),
                      currentSymbol
                    })
                  } else {
                    this.approve(req.handlerId, req)
                  }
                })
              }
            }}
          >
            <span className='requestSignButton _txButton'>
              {this.state.signerLocked ? (
                <span style={{ display: 'flex' }}>
                  <span>
                    <Icon name='sign' size={19} />
                  </span>
                  <span>
                    <Icon name='lock' size={13} />
                  </span>
                </span>
              ) : (
                <span>{req.simulation?.status === 'pending' ? 'Checking' : 'Sign transaction'}</span>
              )}
            </span>
          </button>
        </div>
      </div>
    )
  }

  renderTxCommand() {
    const { req } = this.props
    const { notice, mode } = req

    if (req.status === 'declined') return this.declinedStatus(true)

    const showWarning = mode !== 'monitor'
    const requiredApproval = showWarning && getRequiredRequestApproval(req)

    if (requiredApproval) {
      return (
        <div className='requestNotice requestNoticeApproval'>
          <div className='requestNoticeInner requestNoticeInnerApproval'>
            <TxApproval req={this.props.req} approval={requiredApproval} />
          </div>
        </div>
      )
    } else {
      const monitoring = notice || req.status !== undefined
      const commandClass = monitoring
        ? 'requestNotice requestNoticeTransaction requestNoticeTransactionStatus'
        : 'requestNotice requestNoticeTransaction requestNoticeTransactionReview'
      return (
        <div className={commandClass}>
          <div className='requestNoticeInner'>
            {monitoring ? (
              <>
                <TxBar
                  req={req}
                  networkName={
                    this.store('main.networks', 'ethereum', parseInt(req.data.chainId, 'hex'), 'name') ||
                    'the network'
                  }
                />
                {this.sentStatus()}
              </>
            ) : (
              this.signOrDecline()
            )}
          </div>
        </div>
      )
    }
  }

  renderSignDataCommand() {
    const { req } = this.props
    const { status, notice } = req

    if (status === 'declined') return this.declinedStatus(false)

    const requiredApproval = getRequiredRequestApproval(req)

    if (requiredApproval) {
      return (
        <div className='requestNotice requestNoticeApproval'>
          <div className='requestNoticeInner requestNoticeInnerApproval'>
            <TxApproval req={req} approval={requiredApproval} />
          </div>
        </div>
      )
    }

    return (
      <div>
        {notice ? (
          <div key={notice + status} className='requestNotice'>
            {(() => {
              if (status === 'pending') {
                return (
                  <div key={status} className='requestNoticeInner'>
                    <div style={{ paddingBottom: 20 }}>
                      <div className='loader' />
                    </div>
                    <div className='requestNoticeInnerText'>See Signer</div>
                    <button type='button' className='cancelRequest' onClick={() => this.decline(req)}>
                      Cancel
                    </button>
                  </div>
                )
              } else if (status === 'success') {
                return (
                  <div key={status} className='requestNoticeInner requestNoticeSuccess'>
                    <div className='requestNoticeInnerSymbol'>
                      <Icon name='check' size={40} />
                    </div>
                    <div className='requestNoticeInnerText'>{notice}</div>
                  </div>
                )
              } else if (status === 'error') {
                return (
                  <div key={status} className='requestNoticeInner requestNoticeError'>
                    <div className='requestNoticeInnerSymbol'>
                      <Icon name='blocked' size={40} />
                    </div>
                    <div className='requestNoticeInnerText'>{notice}</div>
                  </div>
                )
              } else {
                return (
                  <div key={notice} className='requestNoticeInner'>
                    <div className='requestNoticeInnerText'>{notice}</div>
                  </div>
                )
              }
            })()}
          </div>
        ) : (
          <div className='requestApprove requestApproveSignature'>
            <div className='requestActionContext'>
              <span className='requestActionContextIcon'>
                <Icon name='sign' size={19} />
              </span>
              <span className='requestActionContextCopy'>
                <strong>Ready to sign</strong>
                <span>Verify this message on your signer before approving.</span>
              </span>
            </div>
            <div className='requestActionButtons'>
              <button
                type='button'
                className='requestDecline'
                disabled={!this.state.allowInput}
                onClick={() => {
                  if (this.state.allowInput) this.decline(req)
                }}
              >
                <span className='requestDeclineButton _txButton _txButtonBad'>
                  <span>Decline</span>
                </span>
              </button>
              <button
                type='button'
                className='requestSign'
                disabled={!this.state.allowInput}
                onClick={() => {
                  if (this.state.allowInput) {
                    link.rpc('signerCompatibility', req.account, req.handlerId, (e, compatibility) => {
                      if (this.handleSignerCompatibilityFailure(e, compatibility, req)) return
                      this.approve(req.handlerId, req)
                    })
                  }
                }}
              >
                <span className='requestSignButton _txButton'>
                  <span>Sign message</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  render() {
    const { req } = this.props
    if (!req) return null
    const crumb = this.store('windows.panel.nav')[0] || {}

    if (req.type === 'transaction' && crumb.data.step === 'confirm') {
      return this.renderTxCommand()
    } else if (isSignatureRequest(req)) {
      return this.renderSignDataCommand()
    } else {
      return null
    }
  }
}

export default Restore.connect(RequestCommand)
