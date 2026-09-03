import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../resources/Components/Icon'
import DialogSurface from '../../../resources/Components/DialogSurface'
import QrCode from '../../../resources/Components/QrCode'
import link from '../../../resources/link'
import { isHardwareSigner, isWatchOnlyAccountType } from '../../../resources/domain/signer'
import {
  isSignatureRequest,
  isTransactionFeeDraftSafe,
  subscribeToTransactionFeeDraftSafety
} from '../../../resources/domain/request'

import RequestCommand, { accountCodeEvidenceReady } from './RequestCommand'
import { parseWalletCallsDraft } from '../Account/Requests/WalletCallsRequest/adjustment'
import { revokeLifecyclePresentation } from '../Account/Requests/Eip7702RevokeRequest'

const measure = (ref) => {
  if (!ref || !ref.current) return { height: 0, width: 0 }
  const { clientHeight, clientWidth } = ref.current
  return { height: clientHeight, width: clientWidth }
}

const formatFundingQuantity = (value, decimals = 18, symbol = '') => {
  try {
    const quantity = BigInt(value)
    const places = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18
    const scale = 10n ** BigInt(places)
    const whole = (quantity / scale).toLocaleString('en-US')
    const fraction = (quantity % scale).toString().padStart(places, '0').replace(/0+$/u, '')
    return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`.trim()
  } catch {
    return `? ${symbol}`.trim()
  }
}

const walletCallsSimulationWarning = (simulation) => {
  if (simulation?.status === 'failed') {
    return {
      title: 'Simulation failed',
      detail: 'Wren could not verify what this wallet call may do. Review the call details before deciding.'
    }
  }
  if (simulation?.status === 'reverted') {
    return {
      title: 'Simulation reverted',
      detail: 'The simulated call reverted. The result may differ from an onchain submission.'
    }
  }
  if (simulation?.status === 'unavailable') {
    return {
      title: 'Simulation unavailable',
      detail: 'Wren could not run a simulation for this wallet call.'
    }
  }
}

const canDecideWalletCalls = (req, actionRequestId, accountSignerType) =>
  req?.type === 'walletCalls' &&
  !isWatchOnlyAccountType(accountSignerType) &&
  req.handlerId !== actionRequestId &&
  req.status === undefined &&
  !req.locked &&
  req.simulation !== undefined &&
  req.simulation?.status !== 'pending' &&
  accountCodeEvidenceReady(req.simulation) &&
  req.simulation?.delegation?.status !== 'delegated' &&
  req.preparation?.status === 'succeeded'

export const canApproveWalletCalls = (
  req,
  actionRequestId,
  accountSignerType,
  simulationAcknowledged = false
) =>
  canDecideWalletCalls(req, actionRequestId, accountSignerType) &&
  (req.simulation?.status === 'succeeded' ||
    (Boolean(walletCallsSimulationWarning(req.simulation)) && simulationAcknowledged))

export class Footer extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      allowInput: true,
      walletCallsActionId: undefined,
      walletCallsAdjustmentId: undefined,
      walletCallsAcknowledgement: undefined,
      walletCallsFundingQrId: undefined,
      eip7702ActionId: undefined,
      eip7702ActionError: undefined,
      eip7702MonitoringDialog: undefined,
      eip7702MonitoringPending: undefined,
      eip7702MonitoringError: undefined,
      eip7702MonitoringStopped: undefined
    }
    this.footerRef = React.createRef()
    this.walletCallsAcknowledgementRef = React.createRef()
    this.walletCallsSubmitRef = React.createRef()
    this.walletCallsFundingRecoveryRef = React.createRef()
    this.eip7702StopMonitoringTriggerRef = React.createRef()
    this.eip7702KeepMonitoringRef = React.createRef()
    this.lastHeight = undefined
  }
  componentDidMount() {
    this.mounted = true
    this.unsubscribeEip7702FeeSafety = subscribeToTransactionFeeDraftSafety(() => {
      if (this.mounted) {
        this.setState((state) => ({ eip7702FeeRevision: (state.eip7702FeeRevision || 0) + 1 }))
      }
    })
    this.observer = new ResizeObserver(() => {
      const size = measure(this.footerRef)
      if (size.height !== this.lastHeight) {
        this.lastHeight = size.height
        link.send('tray:action', 'setFooterHeight', 'panel', size.height)
      }
    })
    if (this.observer) this.observer.observe(this.footerRef.current)
  }
  componentWillUnmount() {
    this.mounted = false
    this.eip7702MonitoringRpcId = undefined
    if (this.unsubscribeEip7702FeeSafety) this.unsubscribeEip7702FeeSafety()
    if (this.observer?.disconnect) {
      this.observer.disconnect()
    } else if (this.footerRef.current && this.observer) {
      this.observer.unobserve(this.footerRef.current)
    }
  }
  componentDidUpdate(_previousProps, previousState) {
    const acknowledgement = this.state.walletCallsAcknowledgement
    if (acknowledgement && acknowledgement === previousState.walletCallsAcknowledgement) {
      const crumb = this.store('windows.panel.nav')[0] || {}
      const request = crumb.data?.accountId
        ? this.store('main.accounts', crumb.data.accountId, 'requests', acknowledgement.handlerId)
        : undefined
      if (request?.simulation !== acknowledgement.simulation) {
        this.setState({ walletCallsAcknowledgement: undefined })
      }
    }

    const crumb = this.store('windows.panel.nav')[0] || {}
    const currentRequest = crumb.data?.accountId
      ? this.store('main.accounts', crumb.data.accountId, 'requests', crumb.data.requestId)
      : undefined
    const recoveryCode = currentRequest?.recoverableError?.code
    const fundingRecoveryId =
      recoveryCode?.startsWith('wallet-call-funding-') || recoveryCode === 'managed-sweep-changed'
        ? currentRequest.handlerId
        : undefined
    if (fundingRecoveryId && fundingRecoveryId !== this.focusedWalletCallsFundingRecoveryId) {
      this.focusedWalletCallsFundingRecoveryId = fundingRecoveryId
      this.walletCallsFundingRecoveryRef.current?.focus()
    } else if (!fundingRecoveryId && this.focusedWalletCallsFundingRecoveryId) {
      this.focusedWalletCallsFundingRecoveryId = undefined
      this.walletCallsSubmitRef.current?.focus()
    }
  }
  approve(reqId, req, options) {
    const onResult = (error) => {
      if (error && this.mounted) this.setState({ walletCallsActionId: undefined })
    }
    if (options) link.rpc('approveRequest', req, options, onResult)
    else link.rpc('approveRequest', req, onResult) // Move to link.send
  }
  decline(reqId, req) {
    link.rpc('declineRequest', req, () => {}) // Move to link.send
  }

  rejectRequest(req) {
    if (this.state.allowInput) {
      link.send('tray:rejectRequest', req)
    }
  }
  renderLightweightRequestFooter({
    approveLabel,
    compactActions = false,
    contextDetail,
    contextIcon,
    contextTitle,
    onApprove,
    onDecline
  }) {
    return (
      <div
        className={`requestApprove requestApproveLightweight${compactActions ? ' requestApproveCompact' : ''}`}
      >
        <div className='requestActionContext'>
          <span className='requestActionContextIcon'>
            <Icon name={contextIcon} size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>{contextTitle}</strong>
            <span>{contextDetail}</span>
          </span>
        </div>
        <div className='requestActionButtons'>
          <button
            type='button'
            className='requestDecline'
            disabled={!this.state.allowInput}
            onClick={() => {
              if (this.state.allowInput) onDecline()
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
              if (this.state.allowInput) onApprove()
            }}
          >
            <span className='requestSignButton _txButton'>
              <span>{approveLabel}</span>
            </span>
          </button>
        </div>
      </div>
    )
  }
  renderEip7702RevocationFooter(req, account) {
    if (this.state.eip7702MonitoringStopped?.handlerId === req.handlerId) {
      return this.renderEip7702MonitoringStopped()
    }

    const active = req.mode === 'monitor' || account.activeRequestId === req.handlerId
    const presentation = revokeLifecyclePresentation(req, active)
    const actionPending = this.state.eip7702ActionId === req.handlerId
    const feeDraftSafe = isTransactionFeeDraftSafe(req.handlerId)
    const decisionAvailable = active && !req.status && !req.locked
    const canCancel = decisionAvailable && !actionPending
    const canDecide = decisionAvailable && !actionPending && feeDraftSafe
    const actionError =
      this.state.eip7702ActionError?.handlerId === req.handlerId ? this.state.eip7702ActionError.message : ''
    const showContext = Boolean(presentation.title) || !feeDraftSafe || Boolean(actionError)
    const canStopMonitoring =
      active &&
      req.mode === 'monitor' &&
      Boolean(req.tx?.hash) &&
      ['verifying', 'confirming'].includes(req.status)
    const terminal = ['verified', 'unverified', 'changed', 'skipped', 'unavailable', 'declined'].includes(
      presentation.kind
    )

    if (this.state.eip7702MonitoringDialog?.handlerId === req.handlerId) {
      return this.renderEip7702StopMonitoringDialog(req)
    }

    return (
      <div
        className={`requestApprove requestApproveLightweight eip7702RevokeActions${
          showContext ? '' : ' eip7702RevokeActionsReview'
        }`}
      >
        {showContext ? (
          <div className='requestActionContext' role='status' aria-live='polite'>
            <span className='requestActionContextIcon'>
              <Icon
                name={
                  presentation.kind === 'verified'
                    ? 'check'
                    : presentation.kind === 'waiting'
                      ? 'pending'
                      : presentation.kind === 'review'
                        ? 'verify'
                        : 'permissions'
                }
                size={presentation.kind === 'review' ? 20 : 19}
              />
            </span>
            <span className='requestActionContextCopy'>
              {presentation.title ? <strong>{presentation.title}</strong> : null}
              {presentation.detail ? <span>{presentation.detail}</span> : null}
              {!feeDraftSafe && !req.status ? (
                <span role='alert'>Finish or correct the fee before signing.</span>
              ) : null}
              {actionError ? <span role='alert'>{actionError}</span> : null}
            </span>
          </div>
        ) : null}
        <div className='requestActionButtons'>
          {decisionAvailable ? (
            <>
              <button
                type='button'
                className='requestDecline'
                disabled={!canCancel}
                onClick={() => {
                  if (!canCancel) return
                  this.submitEip7702Decision('declineRequest', req)
                }}
              >
                <span className='requestDeclineButton _txButton'>
                  <span>Cancel</span>
                </span>
              </button>
              <button
                type='button'
                className='requestSign'
                disabled={!canDecide}
                onClick={() => {
                  if (!canDecide) return
                  this.submitEip7702Decision('approveRequest', req)
                }}
              >
                <span className='requestSignButton _txButton'>
                  <span>Revoke delegation</span>
                </span>
              </button>
            </>
          ) : canStopMonitoring ? (
            <button
              ref={this.eip7702StopMonitoringTriggerRef}
              type='button'
              className='requestDecline'
              onClick={() => this.openEip7702StopMonitoringDialog(req)}
            >
              <span className='requestDeclineButton _txButton'>
                <span>Stop monitoring</span>
              </span>
            </button>
          ) : terminal || presentation.kind === 'waiting' ? (
            <button type='button' className='requestSign' onClick={() => link.send('nav:back', 'panel')}>
              <span className='requestSignButton _txButton'>
                <span>Close</span>
              </span>
            </button>
          ) : null}
        </div>
      </div>
    )
  }
  openEip7702StopMonitoringDialog(req) {
    if (this.eip7702MonitoringRpcId || !this.mounted) return
    const ambiguous = req.submission?.status === 'unconfirmed'
    this.setState({
      eip7702MonitoringDialog: { handlerId: req.handlerId, ambiguous },
      eip7702MonitoringError: undefined
    })
  }
  closeEip7702StopMonitoringDialog() {
    if (this.eip7702MonitoringRpcId || !this.mounted) return
    this.setState({ eip7702MonitoringDialog: undefined, eip7702MonitoringError: undefined }, () =>
      this.eip7702StopMonitoringTriggerRef.current?.focus()
    )
  }
  stopEip7702RevocationMonitoring(req) {
    if (this.eip7702MonitoringRpcId || !this.mounted) return
    const rpcId = `${req.account}:${req.handlerId}`
    const reference = { handlerId: req.handlerId, account: req.account, type: req.type }
    this.eip7702MonitoringRpcId = rpcId
    this.setState({ eip7702MonitoringPending: req.handlerId, eip7702MonitoringError: undefined })
    let settled = false
    link.rpc('stopEip7702RevocationMonitoring', reference, (error) => {
      if (settled) return
      settled = true
      if (!this.mounted || this.eip7702MonitoringRpcId !== rpcId) return
      this.eip7702MonitoringRpcId = undefined
      if (error) {
        this.setState({
          eip7702MonitoringPending: undefined,
          eip7702MonitoringError: {
            handlerId: req.handlerId,
            message: 'Monitoring could not be stopped. Try again.'
          }
        })
        return
      }
      this.setState({
        eip7702MonitoringDialog: undefined,
        eip7702MonitoringPending: undefined,
        eip7702MonitoringError: undefined,
        eip7702MonitoringStopped: { account: req.account, handlerId: req.handlerId }
      })
    })
  }
  renderEip7702StopMonitoringDialog(req) {
    const dialog = this.state.eip7702MonitoringDialog
    const pending = this.state.eip7702MonitoringPending === req.handlerId
    const error = this.state.eip7702MonitoringError
    const title = dialog.ambiguous
      ? 'Stop monitoring this revocation?'
      : 'Stop monitoring this submitted revocation?'
    const detail = dialog.ambiguous
      ? 'Wren does not yet know whether this revocation was submitted. Stopping monitoring cannot cancel a transaction that may already be on the network.'
      : 'Wren knows the revocation was submitted but can’t verify whether delegation was cleared. Stopping monitoring cannot cancel the transaction or prove that delegation was cleared. Your account request queue will continue.'

    return (
      <DialogSurface
        className='requestApprove requestApproveLightweight eip7702StopMonitoringDialog'
        role='alertdialog'
        modal
        labelledBy='eip7702-stop-monitoring-title'
        describedBy='eip7702-stop-monitoring-detail'
        busy={pending}
        initialFocusRef={this.eip7702KeepMonitoringRef}
        returnFocusRef={this.eip7702StopMonitoringTriggerRef}
        onCancel={() => this.closeEip7702StopMonitoringDialog()}
      >
        <div className='requestActionContext'>
          <span className='requestActionContextIcon'>
            <Icon name='alert' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong id='eip7702-stop-monitoring-title'>{title}</strong>
            <span id='eip7702-stop-monitoring-detail'>{detail}</span>
            {error?.handlerId === req.handlerId ? <span role='alert'>{error.message}</span> : null}
          </span>
        </div>
        <div className='requestActionButtons'>
          <button
            ref={this.eip7702KeepMonitoringRef}
            type='button'
            className='requestDecline'
            disabled={pending}
            onClick={() => this.closeEip7702StopMonitoringDialog()}
          >
            <span className='requestDeclineButton _txButton'>
              <span>Keep monitoring</span>
            </span>
          </button>
          <button
            type='button'
            aria-label='Stop monitoring'
            className='requestSign'
            disabled={pending}
            onClick={() => this.stopEip7702RevocationMonitoring(req)}
          >
            <span className='requestSignButton _txButton'>
              <span>Stop</span>
            </span>
          </button>
        </div>
      </DialogSurface>
    )
  }
  renderEip7702MonitoringStopped() {
    return (
      <div className='requestApprove requestApproveLightweight eip7702MonitoringStopped'>
        <div className='requestActionContext' role='status' aria-live='polite'>
          <span className='requestActionContextIcon'>
            <Icon name='check' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>Monitoring stopped</strong>
            <span>The revocation remains unverified, and queued account requests will continue.</span>
          </span>
        </div>
        <div className='requestActionButtons'>
          <button type='button' className='requestSign' onClick={() => link.send('nav:back', 'panel')}>
            <span className='requestSignButton _txButton'>
              <span>Close</span>
            </span>
          </button>
        </div>
      </div>
    )
  }
  submitEip7702Decision(method, req) {
    if (this.state.eip7702ActionId === req.handlerId || !this.mounted) return
    const reference = { handlerId: req.handlerId, account: req.account, type: req.type }
    this.setState({ eip7702ActionId: req.handlerId, eip7702ActionError: undefined })
    const onResult = (error) => {
      if (!this.mounted || !error) return
      const current = this.store('main.accounts', req.account, 'requests', req.handlerId)
      if (!current || current.status || current.locked || current.mode === 'monitor') return
      this.setState({
        eip7702ActionId: undefined,
        eip7702ActionError: {
          handlerId: req.handlerId,
          message: 'Request could not be updated. Try again.'
        }
      })
    }
    if (method === 'approveRequest') link.rpc('approveRequest', reference, onResult)
    else link.rpc('declineRequest', reference, onResult)
  }
  renderQueuedTransactionFooter() {
    return (
      <div className='requestApprove requestApproveLightweight'>
        <div className='requestActionContext' role='status' aria-live='polite'>
          <span className='requestActionContextIcon'>
            <Icon name='pending' size={19} />
          </span>
          <span className='requestActionContextCopy'>
            <strong>Waiting in request queue</strong>
            <span>You can inspect this transaction now. Signing remains available only in queue order.</span>
          </span>
        </div>
        <div className='requestActionButtons'>
          <button type='button' className='requestSign' onClick={() => link.send('nav:back', 'panel')}>
            <span className='requestSignButton _txButton'>
              <span>Close</span>
            </span>
          </button>
        </div>
      </div>
    )
  }
  renderFooter() {
    const crumb = this.store('windows.panel.nav')[0] || {}

    if (crumb.view === 'requestView') {
      const { accountId, requestId } = crumb.data
      const account = this.store('main.accounts', accountId)
      const req = this.store('main.accounts', accountId, 'requests', requestId)
      if (
        !req &&
        this.state.eip7702MonitoringStopped?.account === accountId &&
        this.state.eip7702MonitoringStopped?.handlerId === requestId
      ) {
        return this.renderEip7702MonitoringStopped()
      }
      if (req) {
        if (req.type === 'eip7702Revoke' && crumb.data.step === 'confirm') {
          return this.renderEip7702RevocationFooter(req, account)
        } else if (req.type === 'transaction' && crumb.data.step === 'confirm') {
          const active = req.mode === 'monitor' || account.activeRequestId === req.handlerId
          if (!active) return this.renderQueuedTransactionFooter()
          return (
            <RequestCommand
              key={req.handlerId}
              req={req}
              signingDelay={isHardwareSigner(account.lastSignerType) ? 0 : 1500}
            />
          )
        } else if (req.type === 'walletCalls' && crumb.data.step === 'confirm') {
          const actionPending = this.state.walletCallsActionId === req.handlerId
          const watchOnly = isWatchOnlyAccountType(account.lastSignerType)
          const simulationWarning = walletCallsSimulationWarning(req.simulation)
          const acknowledgement = this.state.walletCallsAcknowledgement
          const acknowledgementActive =
            simulationWarning &&
            acknowledgement?.handlerId === req.handlerId &&
            acknowledgement?.simulation === req.simulation
          const simulationAcknowledged = acknowledgementActive && acknowledgement.checked
          const canApprove = canApproveWalletCalls(
            req,
            this.state.walletCallsActionId,
            account.lastSignerType,
            simulationAcknowledged
          )

          if (req.status === 'declined') {
            const routeChanged = req.notice === 'Network changed before signing'
            return (
              <div className='requestApprove requestApproveLightweight walletCallsTerminalActions'>
                <div className='requestActionContext' role='status'>
                  <span className='requestActionContextIcon'>
                    <Icon name='blocked' size={19} />
                  </span>
                  <span className='requestActionContextCopy'>
                    <strong>{routeChanged ? 'Request canceled' : 'Request declined'}</strong>
                    <span>
                      {routeChanged
                        ? 'The network changed before signing. Nothing was submitted.'
                        : 'You declined this wallet call. Nothing was submitted.'}
                    </span>
                  </span>
                </div>
                <div className='requestActionButtons'>
                  <button
                    type='button'
                    className='requestSign'
                    onClick={() => link.send('nav:back', 'panel')}
                  >
                    <span className='requestSignButton _txButton'>
                      <span>Close</span>
                    </span>
                  </button>
                </div>
              </div>
            )
          }

          if (req.status === 'error' && req.recoverableError) {
            if (req.recoverableError.code === 'managed-sweep-changed') {
              return (
                <div className='requestApprove requestApproveLightweight walletCallsSweepChanged'>
                  <div className='requestActionContext'>
                    <span className='requestActionContextIcon'>
                      <Icon name='alert' size={19} />
                    </span>
                    <div className='requestActionContextCopy'>
                      <div ref={this.walletCallsFundingRecoveryRef} role='alert' tabIndex='-1'>
                        <strong>Sweep changed</strong>
                        <span>
                          Balances, fees, or nonce changed. Close this review and create a fresh Sweep.
                          Nothing was signed or submitted; Wren will not retry automatically.
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className='requestActionButtons'>
                    <button
                      type='button'
                      className='requestSign'
                      disabled={actionPending}
                      onClick={() => {
                        if (actionPending) return
                        this.setState({ walletCallsActionId: req.handlerId })
                        link.rpc('closeFailedWalletCallsRequest', req, () => {
                          if (this.mounted) this.setState({ walletCallsActionId: undefined })
                        })
                      }}
                    >
                      <span className='requestSignButton _txButton'>
                        <span>{actionPending ? 'Closing…' : 'Close request'}</span>
                      </span>
                    </button>
                  </div>
                </div>
              )
            }
            const funding = req.recoverableError.code === 'wallet-call-funding-insufficient'
            const evidence = funding ? req.recoverableError.data : undefined
            const nativeCurrency =
              this.store(
                'main.networksMeta',
                'ethereum',
                Number.parseInt(req.chainId, 16),
                'nativeCurrency'
              ) || {}
            const decimals = Number.isInteger(nativeCurrency.decimals) ? nativeCurrency.decimals : 18
            const symbol = nativeCurrency.symbol || 'native currency'
            const chainId = Number.parseInt(req.chainId, 16)
            const chainName = this.store('main.networks', 'ethereum', chainId, 'name') || `Chain ${chainId}`
            const qrOpen = this.state.walletCallsFundingQrId === req.handlerId
            return (
              <div className='requestApprove requestApproveLightweight walletCallsFundingRecovery'>
                <div className='requestActionContext'>
                  <span className='requestActionContextIcon'>
                    <Icon name='alert' size={19} />
                  </span>
                  <div className='requestActionContextCopy'>
                    <div ref={this.walletCallsFundingRecoveryRef} role='alert' tabIndex='-1'>
                      <strong>{funding ? 'More funds needed' : 'Funding check unavailable'}</strong>
                      <span>
                        {funding
                          ? `Fund this account on ${chainName}. It cannot cover the batch value and maximum fees. Nothing was signed or sent.`
                          : `Wren could not verify this batch's funding on ${chainName}. ${req.recoverableError.message} Recheck when network data is available.`}
                      </span>
                    </div>
                    {evidence ? <span>Amounts at last check</span> : null}
                    {evidence ? (
                      <dl className='transactionFundingFacts'>
                        <div>
                          <dt>Available</dt>
                          <dd>{formatFundingQuantity(evidence.available, decimals, symbol)}</dd>
                        </div>
                        <div>
                          <dt>Required</dt>
                          <dd>{formatFundingQuantity(evidence.required, decimals, symbol)}</dd>
                        </div>
                        <div>
                          <dt>Missing</dt>
                          <dd>{formatFundingQuantity(evidence.missing, decimals, symbol)}</dd>
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
                          aria-expanded={qrOpen}
                          aria-controls={`wallet-calls-funding-qr-${req.handlerId}`}
                          onClick={() =>
                            this.setState({ walletCallsFundingQrId: qrOpen ? undefined : req.handlerId })
                          }
                        >
                          {qrOpen ? 'Hide receive QR' : 'Show receive QR'}
                        </button>
                      </span>
                    ) : null}
                    {funding && qrOpen ? (
                      <QrCode
                        id={`wallet-calls-funding-qr-${req.handlerId}`}
                        className='transactionFundingQr'
                        label={`QR code for funding account on ${chainName}`}
                        value={`ethereum:${req.account}@${chainId}`}
                      />
                    ) : null}
                  </div>
                </div>
                <div className='requestActionButtons'>
                  <button
                    type='button'
                    className='requestDecline'
                    disabled={actionPending}
                    onClick={() => {
                      if (actionPending) return
                      this.setState({ walletCallsActionId: req.handlerId })
                      link.rpc('closeFailedWalletCallsRequest', req, () => {
                        if (this.mounted) this.setState({ walletCallsActionId: undefined })
                      })
                    }}
                  >
                    <span className='requestDeclineButton _txButton _txButtonBad'>
                      <span>Reject request</span>
                    </span>
                  </button>
                  <button
                    type='button'
                    className='requestSign'
                    disabled={actionPending}
                    onClick={() => {
                      if (actionPending) return
                      this.setState({ walletCallsActionId: req.handlerId })
                      link.rpc('retryWalletCallsRequest', req, () => {
                        if (this.mounted) this.setState({ walletCallsActionId: undefined })
                      })
                    }}
                  >
                    <span className='requestSignButton _txButton'>
                      <span>{actionPending ? 'Rechecking…' : 'Recheck'}</span>
                    </span>
                  </button>
                </div>
              </div>
            )
          }

          if (acknowledgementActive) {
            return (
              <DialogSurface
                className='requestApprove requestApproveLightweight walletCallsSimulationAcknowledgement'
                role='region'
                labelledBy='walletCallsSimulationAcknowledgementTitle'
                busy={actionPending}
                initialFocusRef={this.walletCallsAcknowledgementRef}
                returnFocusRef={this.walletCallsSubmitRef}
                onCancel={() =>
                  this.setState({
                    walletCallsAcknowledgement: undefined
                  })
                }
              >
                <div className='requestActionContext'>
                  <span className='requestActionContextIcon'>
                    <Icon name='alert' size={19} />
                  </span>
                  <span className='requestActionContextCopy'>
                    <strong id='walletCallsSimulationAcknowledgementTitle'>{simulationWarning.title}</strong>
                    <span>{simulationWarning.detail}</span>
                    <label className='walletCallsSimulationAcknowledgementCheck'>
                      <input
                        ref={this.walletCallsAcknowledgementRef}
                        type='checkbox'
                        checked={Boolean(acknowledgement.checked)}
                        disabled={actionPending}
                        onChange={(event) =>
                          this.setState({
                            walletCallsAcknowledgement: {
                              ...acknowledgement,
                              checked: event.target.checked
                            }
                          })
                        }
                      />
                      <span>I understand this batch is not simulation-confirmed and want to continue.</span>
                    </label>
                  </span>
                </div>
                <div className='requestActionButtons'>
                  <button
                    type='button'
                    className='requestDecline'
                    disabled={actionPending}
                    onClick={() =>
                      this.setState({
                        walletCallsAcknowledgement: undefined
                      })
                    }
                  >
                    <span className='requestDeclineButton _txButton'>
                      <span>Back</span>
                    </span>
                  </button>
                  <button
                    type='button'
                    className='requestSign'
                    disabled={!canApprove}
                    onClick={() => {
                      if (!canApprove) return
                      this.setState({ walletCallsActionId: req.handlerId })
                      this.approve(req.handlerId, req, {
                        walletCallsSimulationAcknowledged: true
                      })
                    }}
                  >
                    <span className='requestSignButton _txButton'>
                      <span>Continue without simulation</span>
                    </span>
                  </button>
                </div>
              </DialogSurface>
            )
          }

          const canStartDecision = canDecideWalletCalls(
            req,
            this.state.walletCallsActionId,
            account.lastSignerType
          )
          return (
            <div className='requestApprove requestApproveLightweight walletCallsReviewActions'>
              <div className='requestActionContext' role='status'>
                <span className='requestActionContextIcon'>
                  <Icon name='sign' size={19} />
                </span>
                <span className='requestActionContextCopy'>
                  <strong>Ready to submit</strong>
                  <span>Review the ordered calls before submitting.</span>
                </span>
              </div>
              <div className='requestActionButtons'>
                <button
                  type='button'
                  className='requestDecline'
                  disabled={actionPending}
                  onClick={() => {
                    if (!actionPending) {
                      this.setState({ walletCallsActionId: req.handlerId })
                      this.decline(req.handlerId, req)
                    }
                  }}
                >
                  <span className='requestDeclineButton _txButton _txButtonBad'>
                    <span>Decline</span>
                  </span>
                </button>
                <button
                  ref={this.walletCallsSubmitRef}
                  type='button'
                  className='requestSign'
                  disabled={simulationWarning ? !canStartDecision : !canApprove}
                  onClick={() => {
                    if (simulationWarning && canStartDecision) {
                      this.setState({
                        walletCallsAcknowledgement: {
                          checked: false,
                          handlerId: req.handlerId,
                          simulation: req.simulation
                        }
                      })
                    } else if (canApprove) {
                      this.setState({ walletCallsActionId: req.handlerId })
                      this.approve(req.handlerId, req)
                    }
                  }}
                >
                  <span className='requestSignButton _txButton'>
                    <span>{watchOnly ? 'Watch-only' : 'Submit batch'}</span>
                  </span>
                </button>
              </div>
            </div>
          )
        } else if (req.type === 'walletCalls' && crumb.data.step === 'adjustWalletCalls') {
          const parsed = parseWalletCallsDraft(req, crumb.data.walletCallsDraft)
          const pending = this.state.walletCallsAdjustmentId === req.handlerId
          return (
            <div className='requestApprove requestApproveLightweight walletCallsAdjustActions'>
              <div className='requestActionContext'>
                <span className='requestActionContextIcon'>
                  <Icon name='gas' size={19} />
                </span>
                <span className='requestActionContextCopy'>
                  <strong>Fresh checks required</strong>
                </span>
              </div>
              <div className='requestActionButtons'>
                <button
                  type='button'
                  className='requestDecline'
                  disabled={pending}
                  onClick={() => {
                    if (!pending) link.send('nav:back', 'panel')
                  }}
                >
                  <span className='requestDeclineButton _txButton walletCallsCancelButton'>
                    <span>Cancel</span>
                  </span>
                </button>
                <button
                  type='button'
                  className='requestSign'
                  disabled={pending || !parsed.valid}
                  onClick={async () => {
                    if (pending || !parsed.valid) return
                    this.setState({ walletCallsAdjustmentId: req.handlerId })
                    try {
                      const result = await link.invoke('tray:adjustWalletCalls', {
                        account: req.account,
                        handlerId: req.handlerId,
                        adjustment: parsed.adjustment
                      })
                      if (result?.success) {
                        link.send('nav:back', 'panel')
                      } else {
                        link.send(
                          'nav:update',
                          'panel',
                          {
                            data: {
                              walletCallsAdjustmentError:
                                result?.error || 'Unable to apply wallet-call settings.'
                            }
                          },
                          false
                        )
                      }
                    } catch {
                      link.send(
                        'nav:update',
                        'panel',
                        {
                          data: {
                            walletCallsAdjustmentError: 'Unable to apply wallet-call settings.'
                          }
                        },
                        false
                      )
                    } finally {
                      this.setState({ walletCallsAdjustmentId: undefined })
                    }
                  }}
                >
                  <span className='requestSignButton _txButton'>
                    <span>{pending ? 'Applying…' : 'Apply changes'}</span>
                  </span>
                </button>
              </div>
            </div>
          )
        } else if (req.type === 'access') {
          return this.renderLightweightRequestFooter({
            approveLabel: 'Allow access',
            compactActions: true,
            contextDetail: 'Only this account',
            contextIcon: 'accounts',
            contextTitle: 'Account access',
            onApprove: () => link.send('tray:giveAccess', req, true),
            onDecline: () => link.send('tray:giveAccess', req, false)
          })
        } else if (isSignatureRequest(req) && crumb.data.step === 'confirm') {
          return (
            <RequestCommand
              key={req.handlerId}
              req={req}
              signingDelay={isHardwareSigner(account.lastSignerType) ? 0 : 1500}
            />
          )
        } else if (req.type === 'addChain') {
          return this.renderLightweightRequestFooter({
            approveLabel: 'Review network',
            contextDetail: 'Review before adding',
            contextIcon: 'network',
            contextTitle: 'Network proposal',
            onDecline: () => this.rejectRequest(req),
            onApprove: () => {
              link.send('tray:action', 'navDash', {
                view: 'chains',
                data: {
                  newChain: req.chain,
                  requestReference: { account: req.account, handlerId: req.handlerId, origin: req.origin }
                }
              })
            }
          })
        } else if (req.type === 'switchChain') {
          const destinationName =
            this.store('main.networks', req.chain.type, req.chain.id, 'name') || `Chain ${req.chain.id}`
          return this.renderLightweightRequestFooter({
            approveLabel: 'Switch network',
            compactActions: true,
            contextDetail: `Chain ${req.chain.id}`,
            contextIcon: 'network',
            contextTitle: destinationName,
            onApprove: () => this.approve(req.handlerId, req),
            onDecline: () => this.decline(req.handlerId, req)
          })
        } else if (req.type === 'addToken') {
          const requestReference = { account: req.account, handlerId: req.handlerId }
          return this.renderLightweightRequestFooter({
            approveLabel: 'Review token',
            contextDetail: 'Review before adding',
            contextIcon: 'tokens',
            contextTitle: 'Token suggestion',
            onDecline: () => link.send('tray:addToken', false, requestReference),
            onApprove: () => {
              const { address, symbol, decimals, logoURI, name, chainId } = req.token
              link.send('tray:action', 'navDash', {
                view: 'tokens',
                data: {
                  notify: 'addToken',
                  notifyData: {
                    tokenData: { symbol, decimals, logoURI, name },
                    chain: { id: chainId },
                    address,
                    requestReference
                  }
                }
              })
            }
          })
        } else {
          return null
        }
      }
    }
  }
  render() {
    const footerHeight = this.store('windows.panel.footer.height')
    return (
      <div className='footerModule' style={{ height: footerHeight + 'px' }}>
        <div ref={this.footerRef} className='footerWrap'>
          {this.renderFooter()}
        </div>
      </div>
    )
  }
}

export default Restore.connect(Footer)
