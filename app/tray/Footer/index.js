import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../resources/Components/Icon'
import link from '../../../resources/link'
import { isHardwareSigner, isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { isSignatureRequest } from '../../../resources/domain/request'

import RequestCommand from './RequestCommand'
import { parseWalletCallsDraft } from '../Account/Requests/WalletCallsRequest/adjustment'

const measure = (ref) => {
  if (!ref || !ref.current) return { height: 0, width: 0 }
  const { clientHeight, clientWidth } = ref.current
  return { height: clientHeight, width: clientWidth }
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
      walletCallsAcknowledgement: undefined
    }
    this.footerRef = React.createRef()
    this.walletCallsAcknowledgementRef = React.createRef()
    this.walletCallsSubmitRef = React.createRef()
    this.lastHeight = undefined
  }
  componentDidMount() {
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
    if (this.observer?.disconnect) {
      this.observer.disconnect()
    } else if (this.footerRef.current && this.observer) {
      this.observer.unobserve(this.footerRef.current)
    }
  }
  componentDidUpdate(_previousProps, previousState) {
    if (!previousState.walletCallsAcknowledgement && this.state.walletCallsAcknowledgement) {
      this.walletCallsAcknowledgementRef.current?.focus()
    } else if (previousState.walletCallsAcknowledgement && !this.state.walletCallsAcknowledgement) {
      this.walletCallsSubmitRef.current?.focus()
    }

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
  }
  approve(reqId, req, options) {
    if (options) link.rpc('approveRequest', req, options, () => {})
    else link.rpc('approveRequest', req, () => {}) // Move to link.send
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
    contextDetail,
    contextIcon,
    contextTitle,
    onApprove,
    onDecline
  }) {
    return (
      <div className='requestApprove requestApproveLightweight'>
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
  renderFooter() {
    const crumb = this.store('windows.panel.nav')[0] || {}

    if (crumb.view === 'requestView') {
      const { accountId, requestId } = crumb.data
      const account = this.store('main.accounts', accountId)
      const req = this.store('main.accounts', accountId, 'requests', requestId)
      if (req) {
        if (req.type === 'transaction' && crumb.data.step === 'confirm') {
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
          const callCount = Array.isArray(req.calls) ? req.calls.length : 0
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
            return (
              <div className='requestApprove requestApproveLightweight walletCallsTerminalActions'>
                <div className='requestActionContext' role='status'>
                  <span className='requestActionContextIcon'>
                    <Icon name='blocked' size={19} />
                  </span>
                  <span className='requestActionContextCopy'>
                    <strong>Request declined</strong>
                    <span>You declined this wallet call. Nothing was submitted.</span>
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

          if (acknowledgementActive) {
            return (
              <div
                className='requestApprove requestApproveLightweight walletCallsSimulationAcknowledgement'
                role='region'
                aria-labelledby='walletCallsSimulationAcknowledgementTitle'
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
              </div>
            )
          }

          const canStartDecision = canDecideWalletCalls(
            req,
            this.state.walletCallsActionId,
            account.lastSignerType
          )
          return (
            <div className='requestApprove requestApproveLightweight walletCallsReviewActions'>
              <div className='requestActionContext'>
                <span className='requestActionContextIcon'>
                  <Icon name='details' size={19} />
                </span>
                <span className='requestActionContextCopy'>
                  <strong>
                    {callCount} separate {callCount === 1 ? 'transaction' : 'transactions'}
                  </strong>
                  <span>Submitted in order, one by one</span>
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
                    <span>{watchOnly ? 'Watch-only' : 'Submit Batch'}</span>
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
                  <span>Changes rerun preparation and simulation</span>
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
          const accountName = account.ensName || account.name || 'Account'
          return this.renderLightweightRequestFooter({
            approveLabel: 'Allow access',
            contextDetail: 'Only this account',
            contextIcon: 'accounts',
            contextTitle: accountName,
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
