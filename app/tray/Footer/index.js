import React from 'react'
import Restore from 'react-restore'

import link from '../../../resources/link'
import { isHardwareSigner, isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { isSignatureRequest } from '../../../resources/domain/request'

import RequestCommand from './RequestCommand'

const measure = (ref) => {
  if (!ref || !ref.current) return { height: 0, width: 0 }
  const { clientHeight, clientWidth } = ref.current
  return { height: clientHeight, width: clientWidth }
}

export const canApproveWalletCalls = (req, actionRequestId, accountSignerType) =>
  req?.type === 'walletCalls' &&
  !isWatchOnlyAccountType(accountSignerType) &&
  req.handlerId !== actionRequestId &&
  req.status === undefined &&
  !req.locked &&
  req.simulation !== undefined &&
  req.simulation?.status !== 'pending' &&
  req.simulation?.delegation?.status !== 'delegated' &&
  req.preparation?.status === 'succeeded'

export class Footer extends React.Component {
  constructor(...args) {
    super(...args)
    this.state = {
      allowInput: true,
      walletCallsActionId: undefined
    }
    this.footerRef = React.createRef()
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
  approve(reqId, req) {
    link.rpc('approveRequest', req, () => {}) // Move to link.send
  }
  decline(reqId, req) {
    link.rpc('declineRequest', req, () => {}) // Move to link.send
  }

  rejectRequest(req) {
    if (this.state.allowInput) {
      link.send('tray:rejectRequest', req)
    }
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
          const canApprove = canApproveWalletCalls(
            req,
            this.state.walletCallsActionId,
            account.lastSignerType
          )
          return (
            <div className='requestApprove'>
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
                type='button'
                className='requestSign'
                disabled={!canApprove}
                onClick={() => {
                  if (canApprove) {
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
          )
        } else if (req.type === 'access') {
          return (
            <div className='requestApprove'>
              <button
                type='button'
                className='requestDecline'
                disabled={!this.state.allowInput}
                onClick={() => {
                  if (this.state.allowInput) link.send('tray:giveAccess', req, false)
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
                  if (this.state.allowInput) link.send('tray:giveAccess', req, true)
                }}
              >
                <span className='requestSignButton _txButton'>
                  <span>Approve</span>
                </span>
              </button>
            </div>
          )
        } else if (isSignatureRequest(req) && crumb.data.step === 'confirm') {
          return (
            <RequestCommand
              key={req.handlerId}
              req={req}
              signingDelay={isHardwareSigner(account.lastSignerType) ? 0 : 1500}
            />
          )
        } else if (req.type === 'addChain') {
          return (
            <div className='requestApprove'>
              <button
                type='button'
                className='requestDecline'
                disabled={!this.state.allowInput}
                onClick={() => {
                  this.rejectRequest(req)
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
                    link.send('tray:action', 'navDash', {
                      view: 'chains',
                      data: {
                        newChain: req.chain,
                        requestReference: { account: req.account, handlerId: req.handlerId }
                      }
                    })
                  }
                }}
              >
                <span className='requestSignButton _txButton'>
                  <span>Review</span>
                </span>
              </button>
            </div>
          )
        } else if (req.type === 'addToken') {
          const requestReference = { account: req.account, handlerId: req.handlerId }
          return (
            <div className='requestApprove'>
              <button
                type='button'
                className='requestDecline'
                disabled={!this.state.allowInput}
                onClick={() => {
                  if (this.state.allowInput) link.send('tray:addToken', false, requestReference)
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
                }}
              >
                <span className='requestSignButton _txButton'>
                  <span>Review</span>
                </span>
              </button>
            </div>
          )
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
