import React from 'react'
import Restore from 'react-restore'

import emptyRequests from 'url:../../../../asset/ui/wren-empty-requests-v2.png'
// import { CSSTransitionGroup } from 'react-transition-group'

// import ProviderRequest from './ProviderRequest'
// import TransactionRequest from './TransactionRequest'
// import SignatureRequest from './SignatureRequest'
// import ChainRequest from './ChainRequest'
// import AddTokenRequest from './AddTokenRequest'
// import SignTypedDataRequest from './SignTypedDataRequest'

import TxOverview from './TransactionRequest/TxMainNew/overview'

import RequestItem, { consumePendingRequestFocus } from '../../../../resources/Components/RequestItem'
import DialogSurface from '../../../../resources/Components/DialogSurface'
import Icon from '../../../../resources/Components/Icon'
import WrenEmptyState from '../../../../resources/Components/WrenEmptyState'

import { Cluster } from '../../../../resources/Components/Cluster'

import link from '../../../../resources/link'
import { getOriginDisplayName } from '../../../../resources/domain/origin'
import { safeNetworkMetadata } from '../../../../resources/domain/networkMetadata'
import { isPendingSigningRequest } from '../../../../resources/domain/request'

let restorePreviewFocus = false

const queueNumber = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null)
const terminalRequestStatuses = new Set(['confirmed', 'declined', 'error', 'success'])
const inFlightRequestStatuses = new Set(['sending', 'verifying', 'sent', 'confirming'])
export const requestPreviewSummary = (requests = []) => {
  const unfinished = requests.filter((request) => !terminalRequestStatuses.has(request?.status))
  const confirming = unfinished.filter(
    (request) => request?.mode === 'monitor' || inFlightRequestStatuses.has(request?.status)
  ).length
  return { total: unfinished.length, pending: unfinished.length - confirming, confirming }
}

const requestPreviewTitle = (request) => {
  const titles = {
    access: 'Account access',
    addChain: 'Add network',
    addToken: 'Add token',
    eip7702Revoke: 'Revoke delegation',
    sign: 'Message signature',
    signErc20Permit: 'Approve token permit',
    signTypedData: 'Typed-data signature',
    switchChain: 'Switch network',
    transaction: 'Review transaction',
    walletCalls: 'Wallet calls batch'
  }
  return titles[request?.type] || 'Review request'
}

export const isReviewQueueRequest = (request) =>
  request?.mode !== 'monitor' && !terminalRequestStatuses.has(request?.status)

export const byRequestQueueOrder = (a, b) => {
  const aQueueIndex = queueNumber(a.queueIndex)
  const bQueueIndex = queueNumber(b.queueIndex)

  if (aQueueIndex !== null || bQueueIndex !== null) {
    if (aQueueIndex === null) return 1
    if (bQueueIndex === null) return -1
    if (aQueueIndex !== bQueueIndex) return aQueueIndex - bQueueIndex
  }

  const aCreated = Number.isFinite(a.created) ? a.created : Number.MAX_SAFE_INTEGER
  const bCreated = Number.isFinite(b.created) ? b.created : Number.MAX_SAFE_INTEGER
  if (aCreated !== bCreated) return aCreated - bCreated

  return String(a.handlerId || '').localeCompare(String(b.handlerId || ''))
}

export class Requests extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      minimized: false,
      clearConfirm: false,
      clearing: false
    }
    this.moduleRef = React.createRef()
    this.previewRef = React.createRef()
    this.inboxHeadingRef = React.createRef()
    this.clearCancelRef = React.createRef()
    this.clearReturnFocusRef = React.createRef()
    this.requestRefs = new Map()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.scrollHeight
          })
        }
      })
    }
  }

  minimize() {
    this.setState({ minimized: true })
  }

  componentDidMount() {
    if (this.resizeObserver) this.resizeObserver.observe(this.moduleRef.current)
    if (!this.props.expanded && restorePreviewFocus) {
      restorePreviewFocus = false
      window.setTimeout(() => this.previewRef.current?.focus(), 0)
    } else if (this.props.expanded) {
      const focusTarget = consumePendingRequestFocus(this.props.account)
      if (focusTarget) {
        window.setTimeout(() => this.restoreRequestFocus(focusTarget), 0)
      }
    }
  }

  componentDidUpdate() {
    if (this.state.clearing && this.renderedRequests?.length === 0) {
      this.setState({ clearing: false }, () => {
        window.setTimeout(() => this.focusFirstRequestOrHeading(), 0)
      })
    }
  }

  componentWillUnmount() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
  }

  setRequestRef(handlerId, element) {
    if (element) this.requestRefs.set(handlerId, element)
    else this.requestRefs.delete(handlerId)
  }

  focusFirstRequestOrHeading() {
    const firstRequest = this.renderedRequests?.find((request) => this.requestRefs.has(request.handlerId))
    const target = firstRequest ? this.requestRefs.get(firstRequest.handlerId) : this.inboxHeadingRef.current
    target?.focus()
  }

  restoreRequestFocus({ handlerId, index }) {
    let target = this.requestRefs.get(handlerId)
    if (target?.disabled) target = null

    if (!target && this.renderedRequests?.length) {
      const fallbackIndex = Math.min(index, this.renderedRequests.length - 1)
      target = this.requestRefs.get(this.renderedRequests[fallbackIndex].handlerId)
      if (target?.disabled) {
        target = this.renderedRequests
          .map((request) => this.requestRefs.get(request.handlerId))
          .find((requestTarget) => requestTarget && !requestTarget.disabled)
      }
    }

    ;(target || this.inboxHeadingRef.current)?.focus()
  }

  openClearConfirmation() {
    if (this.state.clearing) return
    this.setState({ clearConfirm: true })
  }

  cancelClearConfirmation() {
    this.setState({ clearConfirm: false })
  }

  confirmClearRequests() {
    if (this.state.clearing) return
    this.setState({ clearConfirm: false, clearing: true })
    link.send('tray:clearRequests', this.props.account)
  }

  renderPreview() {
    const requests = Object.values(this.store('main.accounts', this.props.account, 'requests') || {})
    const summary = requestPreviewSummary(requests)
    const summaryLabel =
      summary.pending && summary.confirming
        ? `${summary.pending} pending · ${summary.confirming} confirming`
        : summary.confirming
          ? `${summary.confirming} confirming`
          : summary.pending
            ? `${summary.pending} pending`
            : 'None pending'
    const current = requests.filter(isReviewQueueRequest).sort(byRequestQueueOrder)[0]
    const origin = current
      ? getOriginDisplayName(this.store('main.origins', current.origin, 'name') || current.origin)
      : ''
    return (
      <div ref={this.moduleRef} className='balancesBlock'>
        <button
          ref={this.previewRef}
          type='button'
          className='requestsPreview'
          aria-label={
            summary.total
              ? `Requests. ${summary.total} active. ${summary.pending} pending. ${summary.confirming} confirming.`
              : 'Requests'
          }
          onClick={() => {
            restorePreviewFocus = true
            const crumb = {
              view: 'expandedModule',
              data: {
                id: this.props.moduleId,
                account: this.props.account
              }
            }
            link.send('nav:forward', 'panel', crumb)
          }}
        >
          <div className='requestPreviewContent'>
            <div className='requestPreviewHeading'>
              <span>Requests</span>
              <span>{summaryLabel}</span>
            </div>
            {current ? (
              <div className='requestPreviewItem'>
                <span className='requestPreviewIdentity'>
                  <strong>{requestPreviewTitle(current)}</strong>
                  <span>{origin}</span>
                </span>
                <span className='requestPreviewReview'>Review →</span>
              </div>
            ) : (
              <div className='requestPreviewEmpty'>Requests from connected apps appear here.</div>
            )}
            <div className='requestPreviewContentEnd' aria-hidden='true'>
              <Icon name='next' size={14} />
            </div>
          </div>
        </button>
      </div>
    )
  }

  renderClearConfirmation(count) {
    if (!this.state.clearConfirm) return null

    const requestLabel = count === 1 ? 'request' : 'requests'
    const clearBody =
      count === 1
        ? 'This removes this request from the list. It does not cancel a transaction already submitted.'
        : 'This removes all requests from the list. It does not cancel transactions already submitted.'

    return (
      <DialogSurface
        className='requestGroupClearConfirmation'
        role='alertdialog'
        labelledBy='request-clear-title'
        describedBy='request-clear-body'
        initialFocusRef={this.clearCancelRef}
        returnFocusRef={this.clearReturnFocusRef}
        onCancel={() => this.cancelClearConfirmation()}
      >
        <div id='request-clear-title' className='requestGroupClearTitle'>
          {`Clear ${count} ${requestLabel}?`}
        </div>
        <div id='request-clear-body' className='requestGroupClearBody'>
          {clearBody}
        </div>
        <div className='requestGroupClearActions'>
          <button
            ref={this.clearCancelRef}
            type='button'
            className='wrenControl wrenControlSecondary wrenControlCompact'
            onClick={() => this.cancelClearConfirmation()}
          >
            Cancel
          </button>
          <button
            type='button'
            className='wrenControl wrenControlDanger wrenControlCompact'
            onClick={() => this.confirmClearRequests()}
          >
            {count === 1 ? 'Clear' : 'Clear all'}
          </button>
        </div>
      </DialogSurface>
    )
  }

  requestQueueProps(req) {
    if (req.mode === 'monitor') return { active: false, queued: false }
    const active = req.handlerId === this.activeRequestId
    const position = this.reviewQueueIndexes.get(req.handlerId)
    const showPosition = Boolean(position && this.reviewQueue.length > 1)
    return {
      active,
      queued: !active,
      queuePosition: showPosition ? position : undefined,
      queueSize: showPosition ? this.reviewQueue.length : undefined
    }
  }

  renderRequestGroup(origin, requests, groupKey) {
    const groupName = getOriginDisplayName(this.store('main.origins', origin, 'name'))

    return (
      <section className='requestGroupBlock' key={groupKey}>
        <div className='requestGroup'>
          <div className='requestGroupMain'>
            <div style={{ marginRight: '8px' }}>
              <Icon name='apps' size={12} />
            </div>
            <div className='requestGroupName'>{groupName}</div>
          </div>
        </div>
        <Cluster className='requestLedger'>
          {!requests.length ? (
            <div key='noReq' className='noRequests'>
              No pending requests
            </div>
          ) : null}
          {requests.map((req) => {
            if (req.type === 'access') {
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={'Account access'}
                  color={'var(--outerspace)'}
                  svgName={'accounts'}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'sign') {
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={'Sign message'}
                  color={'var(--outerspace)'}
                  svgName={'sign'}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'signTypedData') {
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={'Sign typed data'}
                  color={'var(--outerspace)'}
                  svgName={'sign'}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'signErc20Permit') {
              const chainId = req.typedMessage.data.domain.chainId
              const chainName = this.store('main.networks.ethereum', chainId, 'name')
              const { primaryColor, icon } = safeNetworkMetadata(
                this.store('main.networksMeta.ethereum', chainId),
                this.store('main.networks.ethereum', chainId)
              )

              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={`${chainName} token permit`}
                  color={primaryColor ? `var(--${primaryColor})` : ''}
                  img={icon}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'addChain') {
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={'Add network'}
                  color={'var(--outerspace)'}
                  svgName={'chain'}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'switchChain') {
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={'Change network'}
                  color={'var(--outerspace)'}
                  svgName={'chain'}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'addToken') {
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={'Add token'}
                  color={'var(--outerspace)'}
                  svgName={'tokens'}
                >
                  <div style={{ height: '10px' }} />
                </RequestItem>
              )
            } else if (req.type === 'eip7702Revoke') {
              const chainId = Number(req.chainId)
              const chainName = this.store('main.networks.ethereum', chainId, 'name') || `Chain ${chainId}`
              const metadata = this.store('main.networksMeta.ethereum', chainId) || {}
              const delegate = req.evidence?.delegate || ''
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={`${chainName} delegation revocation`}
                  color={metadata.primaryColor ? `var(--${metadata.primaryColor})` : 'var(--outerspace)'}
                  img={metadata.icon}
                  svgName='accounts'
                >
                  <div className='eip7702RevokeRequestSummary'>
                    {delegate ? (
                      <>
                        Current delegate{' '}
                        <span>
                          {delegate.slice(0, 8)}…{delegate.slice(-6)}
                        </span>
                      </>
                    ) : (
                      'Review current delegation'
                    )}
                  </div>
                </RequestItem>
              )
            } else if (req.type === 'transaction') {
              const chainId = parseInt(req.data.chainId, 16)
              const chainName = this.store('main.networks.ethereum', chainId, 'name')
              const {
                primaryColor,
                icon,
                nativeCurrency: { symbol: currentSymbol }
              } = safeNetworkMetadata(
                this.store('main.networksMeta.ethereum', chainId),
                this.store('main.networks.ethereum', chainId)
              )
              const originName = getOriginDisplayName(this.store('main.origins', req.origin, 'name'))
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  inspectableQueued
                  title={`${
                    req.recognizedActions?.length === 1 && req.recognizedActions[0].id === 'erc20:transfer'
                      ? 'Send token'
                      : req.recognizedActions?.length === 1 && req.recognizedActions[0].id === 'erc20:approve'
                        ? 'Approve token spending'
                        : !req.data.to
                          ? 'Deploy contract'
                          : req.classification === 'NATIVE_TRANSFER'
                            ? currentSymbol === '?'
                              ? 'Send native asset'
                              : `Send ${currentSymbol}`
                            : 'Contract transaction'
                  } · ${chainName || `Chain ${chainId}`}`}
                  color={primaryColor ? `var(--${primaryColor})` : ''}
                  img={icon}
                >
                  <TxOverview
                    req={req}
                    chainName={chainName}
                    chainColor={primaryColor}
                    symbol={currentSymbol}
                    originName={originName}
                    simple={true}
                  />
                </RequestItem>
              )
            } else if (req.type === 'walletCalls') {
              const chainId = parseInt(req.chainId, 16)
              const chainName = this.store('main.networks.ethereum', chainId, 'name') || `Chain ${chainId}`
              const metadata = this.store('main.networksMeta.ethereum', chainId) || {}
              return (
                <RequestItem
                  key={req.handlerId}
                  req={req}
                  {...this.requestQueueProps(req)}
                  account={this.props.account}
                  handlerId={req.handlerId}
                  i={this.requestIndexes.get(req.handlerId)}
                  actionRef={(element) => this.setRequestRef(req.handlerId, element)}
                  title={`${chainName} call batch`}
                  color={metadata.primaryColor ? `var(--${metadata.primaryColor})` : 'var(--outerspace)'}
                  img={metadata.icon}
                >
                  <div className='walletCallsRequestSummary'>
                    {req.calls.length} ordered {req.calls.length === 1 ? 'call' : 'calls'} - non-atomic
                  </div>
                </RequestItem>
              )
            }
          })}
        </Cluster>
      </section>
    )
  }

  renderExpanded() {
    const activeAccount = this.store('main.accounts', this.props.account)
    const requests = Object.values(activeAccount.requests || {}).sort(byRequestQueueOrder)
    this.renderedRequests = requests
    this.activeRequestId = activeAccount.activeRequestId
    this.requestIndexes = new Map(requests.map((request, index) => [request.handlerId, index]))
    this.reviewQueue = requests.filter(isReviewQueueRequest)
    this.reviewQueueIndexes = new Map(
      this.reviewQueue.map((request, index) => [request.handlerId, index + 1])
    )
    const pendingSignatures = this.reviewQueue.filter(isPendingSigningRequest).length

    const groups = requests.reduce((result, req) => {
      const previous = result[result.length - 1]
      if (previous?.origin === req.origin) previous.requests.push(req)
      else result.push({ key: `${req.origin}:${req.handlerId}`, origin: req.origin, requests: [req] })
      return result
    }, [])

    return (
      <div
        className={`accountViewScroll requestViewScroll${groups.length === 0 ? ' requestViewScrollEmpty' : ''}`}
      >
        <h2 ref={this.inboxHeadingRef} className='requestInboxHeading' tabIndex={-1}>
          Requests
        </h2>
        {requests.length ? (
          <div className='requestQueueStatus'>
            <div className='requestQueueStatusSummary' role='status' aria-live='polite'>
              <span className='requestQueueStatusTitle'>{`${requests.length} ${
                requests.length === 1 ? 'request' : 'requests'
              }`}</span>
              {this.reviewQueue.length ? (
                <span className='requestQueueStatusDetail'>
                  {pendingSignatures
                    ? `${pendingSignatures} pending ${
                        pendingSignatures === 1 ? 'signature' : 'signatures'
                      } · oldest first`
                    : `${this.reviewQueue.length} awaiting review · oldest first`}
                </span>
              ) : null}
            </div>
            <button
              ref={this.clearReturnFocusRef}
              type='button'
              aria-label='Clear all requests'
              className='requestClearAll wrenControl wrenControlGhost wrenControlCompact'
              disabled={this.state.clearing}
              onClick={() => this.openClearConfirmation()}
            >
              Clear all
            </button>
          </div>
        ) : null}
        {this.renderClearConfirmation(requests.length)}
        {groups.length === 0 ? (
          <WrenEmptyState
            image={emptyRequests}
            title='No pending requests'
            copy='Requests from connected apps will appear here.'
            expanded
            transparentImage
          />
        ) : (
          groups.map((group) => this.renderRequestGroup(group.origin, group.requests, group.key))
        )}
      </div>
    )
  }
  render() {
    return this.props.expanded ? this.renderExpanded() : this.renderPreview()
  }
}

export default Restore.connect(Requests)
