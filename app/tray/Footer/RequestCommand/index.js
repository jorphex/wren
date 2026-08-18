import React from 'react'
import Restore from 'react-restore'
import BigNumber from 'bignumber.js'

import TxBar from './TxBar'
import TxApproval from './TxApproval'
import Time from '../Time'

import Icon from '../../../../resources/Components/Icon'
import QrCode from '../../../../resources/Components/QrCode'
import link from '../../../../resources/link'

import { usesBaseFee } from '../../../../resources/domain/transaction'
import {
  isCancelableRequest,
  isSignatureRequest,
  isTransactionFeeDraftSafe,
  subscribeToTransactionFeeDraftSafety
} from '../../../../resources/domain/request'
import { WATCH_ONLY_SIGNING_ERROR } from '../../../../resources/domain/signer'
import { requestReference } from '../../../../resources/store/notifications'

const FEE_WARNING_THRESHOLD_USD = 50

const formatFundingQuantity = (value, decimals = 18, symbol = '') => {
  try {
    const quantity = BigInt(value)
    const scale = 10n ** BigInt(decimals)
    const whole = quantity / scale
    const fraction = (quantity % scale).toString().padStart(decimals, '0').replace(/0+$/u, '')
    return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`.trim()
  } catch {
    return `? ${symbol}`.trim()
  }
}

export function accountCodeEvidenceReady(simulation) {
  const evidence = simulation?.accountCodeEvidence
  if (!evidence) return false
  return [evidence.sender, ...(evidence.targets || [])].every(
    (account) =>
      account?.status !== 'unavailable' &&
      !(account?.status === 'delegated' && account.delegateCodeStatus === 'unavailable')
  )
}

export function canApproveTransaction(allowInput, simulation, feeDraftSafe = true) {
  return (
    allowInput &&
    simulation?.status !== 'pending' &&
    simulation?.advancedChecks?.status !== 'pending' &&
    accountCodeEvidenceReady(simulation) &&
    feeDraftSafe
  )
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
      signerLocked: false,
      requestActionPending: false,
      requestActionError: '',
      fundingQrOpen: false
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
    this.mounted = true
    this.unsubscribeFeeDraftSafety = subscribeToTransactionFeeDraftSafety((handlerId) => {
      if (handlerId !== this.props.req?.handlerId) return
      this.setState({ feeDraftSafe: isTransactionFeeDraftSafe(handlerId) })
    })
    this.syncSigningClock()
  }

  componentDidUpdate() {
    this.syncSigningClock()
  }

  componentWillUnmount() {
    this.mounted = false
    ;['allowInputTimer', 'txHashCopiedTimer', 'signerLockedTimer', 'signingClockTimer'].forEach((name) => {
      clearTimeout(this[name])
      this[name] = undefined
    })
    if (this.unsubscribeFeeDraftSafety) this.unsubscribeFeeDraftSafety()
  }

  syncSigningClock() {
    const progress = this.props.req?.signingProgress
    const needsClock = this.props.req?.status === 'pending' && progress?.phase === 'waiting-for-signer'
    if (!needsClock) {
      clearTimeout(this.signingClockTimer)
      this.signingClockTimer = undefined
      return
    }
    if (this.signingClockTimer) return
    this.scheduleTimer(
      'signingClockTimer',
      () => {
        if (this.mounted) this.setState({ signingClock: Date.now() })
      },
      1000
    )
  }

  approve(_reqId, req) {
    this.runRequestAction('approveRequest', req)
  }

  decline(req) {
    link.rpc('declineRequest', requestReference(req), () => {}) // Move to link.send
  }

  runRequestAction(method, req) {
    if (this.state.requestActionPending) return

    this.setState({ requestActionPending: true, requestActionError: '' })
    const onResult = (error) => {
      if (!this.mounted) return
      if (error) {
        this.setState({
          requestActionPending: false,
          requestActionError: 'Wren could not update this request. It is still pending.'
        })
      } else {
        this.setState({ requestActionPending: false, requestActionError: '' })
      }
    }
    const reference = requestReference(req)
    if (method === 'approveRequest') link.rpc('approveRequest', reference, onResult)
    else if (method === 'retryTransactionRequest') link.rpc('retryTransactionRequest', reference, onResult)
    else if (method === 'closeFailedTransactionRequest') {
      link.rpc('closeFailedTransactionRequest', reference, onResult)
    } else {
      onResult(new Error('Unsupported request action'))
    }
  }

  runReplacementAction(kind, req) {
    if (this.state.requestActionPending) return
    this.setState({ requestActionPending: true, requestActionError: '' })
    link.rpc('replaceTransactionRequest', requestReference(req), kind, (error) => {
      if (!this.mounted) return
      if (error) {
        this.setState({
          requestActionPending: false,
          requestActionError:
            'The original transaction could not be replaced. Its current status was preserved.'
        })
      } else {
        this.setState({ requestActionPending: false, requestActionError: '' })
        link.send('nav:back', 'panel')
      }
    })
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
    const message = 'Nothing was signed or sent.'

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
              disabled={this.state.requestActionPending}
              onClick={() => {
                this.runReplacementAction('cancel', req)
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
              disabled={this.state.requestActionPending}
              onClick={() => {
                this.runReplacementAction('speed', req)
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
        {this.state.requestActionError ? (
          <div className='requestActionError' role='alert'>
            {this.state.requestActionError}
          </div>
        ) : null}
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
    const allowApproval =
      !this.state.requestActionPending &&
      canApproveTransaction(this.state.allowInput, req.simulation, this.state.feeDraftSafe)
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

    const advancedPending = req.simulation?.advancedChecks?.status === 'pending'
    const reviewPending = req.simulation?.status === 'pending'
    return (
      <div className='requestApprove requestApproveTransaction'>
        <div className='requestActionContext'>
          <span className='requestActionContextIcon'>
            <Icon name='verify' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>
              {reviewPending ? 'Checking transaction' : advancedPending ? 'Final checks' : 'Ready for review'}
            </strong>
            <span>
              {advancedPending
                ? 'Wren is checking transaction details.'
                : 'Verify on your signer before approving.'}
            </span>
            {this.state.requestActionError ? (
              <span className='requestActionError' role='alert'>
                {this.state.requestActionError}
              </span>
            ) : null}
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
                <span>
                  {reviewPending ? 'Checking' : advancedPending ? 'Finishing checks' : 'Sign transaction'}
                </span>
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
    if (req.status === 'error' && req.retainedPreBroadcastError) {
      return this.retainedPreBroadcastFailureStatus(req)
    }

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
    } else if (req.type === 'transaction' && req.status === 'pending') {
      return this.signingStatus(req)
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

  signingStatus(req) {
    const progress = req.signingProgress || { phase: 'rechecking-safety', startedAt: Date.now() }
    const elapsed = Math.max(0, Date.now() - progress.startedAt)
    const signerName = progress.signerName || (progress.signerType === 'trezor' ? 'Trezor' : 'signer')
    const trezor = progress.signerType === 'trezor'
    const phaseCopy = {
      'preparing-nonce': {
        title: 'Preparing transaction',
        detail: 'Wren is preparing the transaction nonce.',
        button: 'Preparing'
      },
      'rechecking-safety': {
        title: 'Rechecking transaction',
        detail: 'Wren is repeating the safety checks before signing.',
        button: 'Rechecking'
      },
      'sending-to-signer': {
        title: 'Sending to signer',
        detail: `Wren is sending the transaction to your ${signerName}.`,
        button: 'Sending'
      },
      signed: {
        title: 'Transaction signed',
        detail: 'Wren is preparing to send the signed transaction.',
        button: 'Signed'
      }
    }
    let presentation = phaseCopy[progress.phase]
    if (progress.phase === 'waiting-for-signer') {
      if (trezor && elapsed >= 10_000) {
        presentation = {
          title: 'Still waiting for Trezor',
          detail: 'Check that your Trezor is connected and showing this transaction.',
          button: 'Waiting'
        }
      } else if (trezor && elapsed >= 5_000) {
        presentation = {
          title: 'Still waiting for Trezor',
          detail: 'Check your Trezor and approve the transaction.',
          button: 'Waiting'
        }
      } else if (trezor) {
        presentation = {
          title: 'Waiting for Trezor',
          detail: 'Review and approve the transaction on your Trezor.',
          button: 'Waiting'
        }
      } else {
        presentation = {
          title: 'Waiting for signer',
          detail: 'Review and approve the transaction on your signer.',
          button: 'Waiting'
        }
      }
    }
    presentation ||= {
      title: 'Preparing transaction',
      detail: 'Wren is preparing the transaction for signing.',
      button: 'Preparing'
    }

    return (
      <div className='requestApprove requestApproveTransaction requestApproveSigning' aria-busy='true'>
        <div className='requestActionContext' role='status' aria-live='polite'>
          <span className='requestActionContextIcon requestActionContextIconSign'>
            <Icon name='sign' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>{presentation.title}</strong>
            <span>{presentation.detail}</span>
          </span>
        </div>
        <div className='requestActionButtons'>
          <button type='button' className='requestDecline' onClick={() => this.decline(req)}>
            <span className='requestDeclineButton _txButton _txButtonBad'>
              <span>Cancel</span>
            </span>
          </button>
          <button type='button' className='requestSign' disabled>
            <span className='requestSignButton _txButton'>
              <span>{presentation.button}</span>
            </span>
          </button>
        </div>
      </div>
    )
  }

  retainedPreBroadcastFailureStatus(req) {
    const recoverable = Boolean(req.recoverableError)
    const changed = req.recoverableError?.code === 'account-code-evidence-changed'
    const funding = req.recoverableError?.code === 'transaction-funding-insufficient'
    const fundingUnavailable = req.recoverableError?.code === 'transaction-funding-unavailable'
    const fundingEvidence = funding ? req.recoverableError?.data : undefined
    const chainId = Number.parseInt(req.data?.chainId, 16)
    const nativeCurrency =
      (funding ? this.store('main.networksMeta', 'ethereum', chainId)?.nativeCurrency : undefined) || {}
    const decimals = Number.isInteger(nativeCurrency.decimals) ? nativeCurrency.decimals : 18
    const symbol = nativeCurrency.symbol || 'native currency'
    const pending = this.state.requestActionPending
    const title = recoverable
      ? funding
        ? 'More funds needed'
        : fundingUnavailable
          ? 'Balance check unavailable'
          : changed
            ? 'Transaction state changed'
            : 'Safety check unavailable'
      : 'Signing did not complete'
    const failureNotice = (req.notice || 'Signing did not complete').replace(/[.]+$/u, '')
    const detail = recoverable
      ? funding
        ? 'The account cannot cover the value and maximum network fee. Nothing was signed or sent.'
        : fundingUnavailable
          ? 'The balance or fee requirement could not be verified. Nothing was signed or sent.'
          : changed
            ? 'Account code changed during the final safety check. Nothing was signed or sent.'
            : 'The safety check could not be repeated. Nothing was signed or sent.'
      : `${failureNotice}. No transaction was sent.`

    return (
      <div className='requestApprove requestApproveTransaction requestApproveRecoverable'>
        <div className='requestActionContext' role='alert'>
          <span className='requestActionContextIcon requestActionContextIconAlert'>
            <Icon name='alert' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>{title}</strong>
            <span>{detail}</span>
            {fundingEvidence ? (
              <dl className='transactionFundingFacts'>
                <div>
                  <dt>Available</dt>
                  <dd>{formatFundingQuantity(fundingEvidence.available, decimals, symbol)}</dd>
                </div>
                <div>
                  <dt>Required</dt>
                  <dd>{formatFundingQuantity(fundingEvidence.required, decimals, symbol)}</dd>
                </div>
                <div>
                  <dt>Missing</dt>
                  <dd>{formatFundingQuantity(fundingEvidence.missing, decimals, symbol)}</dd>
                </div>
              </dl>
            ) : null}
            {funding ? (
              <span className='transactionFundingActions'>
                <button type='button' onClick={() => link.send('tray:clipboardData', req.account)}>
                  Copy address
                </button>
                <button
                  type='button'
                  aria-expanded={this.state.fundingQrOpen}
                  onClick={() => this.setState(({ fundingQrOpen }) => ({ fundingQrOpen: !fundingQrOpen }))}
                >
                  {this.state.fundingQrOpen ? 'Hide receive QR' : 'Show receive QR'}
                </button>
              </span>
            ) : null}
            {funding && this.state.fundingQrOpen ? (
              <QrCode
                className='transactionFundingQr'
                label='QR code for funding account address'
                value={req.account}
              />
            ) : null}
            {this.state.requestActionError ? (
              <span className='requestActionError' role='alert'>
                {this.state.requestActionError}
              </span>
            ) : null}
          </span>
        </div>
        <div className='requestActionButtons'>
          <button
            type='button'
            className='requestDecline'
            disabled={pending}
            onClick={() => this.runRequestAction('closeFailedTransactionRequest', req)}
          >
            <span className='requestDeclineButton _txButton'>
              <span>Close request</span>
            </span>
          </button>
          {recoverable ? (
            <button
              type='button'
              className='requestSign'
              disabled={pending}
              onClick={() => this.runRequestAction('retryTransactionRequest', req)}
            >
              <span className='requestSignButton _txButton'>
                <span>{pending ? 'Rechecking…' : 'Recheck'}</span>
              </span>
            </button>
          ) : null}
        </div>
      </div>
    )
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
              <span className='requestActionContextIcon requestActionContextIconSign'>
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
