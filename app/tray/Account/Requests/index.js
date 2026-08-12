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

let restorePreviewFocus = false

const queueNumber = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null)

export const byRequestQueue = (a, b) => {
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
      clearOrigin: null,
      clearGroupKey: null,
      clearingOrigin: null
    }
    this.moduleRef = React.createRef()
    this.previewRef = React.createRef()
    this.inboxHeadingRef = React.createRef()
    this.clearCancelRef = React.createRef()
    this.clearReturnFocusRef = React.createRef()
    this.requestRefs = new Map()
    this.clearButtonRefs = new Map()
    this.clearPendingOrigins = new Set()
    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.moduleRef && this.moduleRef.current) {
          link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
            height: this.moduleRef.current.clientHeight
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
    const clearingOriginStillPresent = this.renderedRequests?.some(
      (request) => request.origin === this.state.clearingOrigin
    )
    if (this.state.clearingOrigin && !clearingOriginStillPresent) {
      this.clearPendingOrigins.delete(this.state.clearingOrigin)
      this.setState({ clearingOrigin: null }, () => {
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

  setClearButtonRef(groupKey, element) {
    if (element) this.clearButtonRefs.set(groupKey, element)
    else this.clearButtonRefs.delete(groupKey)
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

  openClearConfirmation(origin, groupKey) {
    if (this.clearPendingOrigins.has(origin)) return
    this.clearReturnFocusRef.current = this.clearButtonRefs.get(groupKey)
    this.setState({ clearOrigin: origin, clearGroupKey: groupKey })
  }

  cancelClearConfirmation() {
    this.setState({ clearOrigin: null, clearGroupKey: null })
  }

  confirmClearRequests(origin) {
    if (this.clearPendingOrigins.has(origin)) return
    this.clearPendingOrigins.add(origin)
    this.setState({ clearOrigin: null, clearGroupKey: null, clearingOrigin: origin })
    link.send('tray:clearRequestsByOrigin', this.props.account, origin)
  }

  renderPreview() {
    const reqCount = Object.keys(this.store('main.accounts', this.props.account, 'requests') || {}).length
    return (
      <div ref={this.moduleRef} className='balancesBlock'>
        <button
          ref={this.previewRef}
          type='button'
          className='requestsPreview'
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
          <div className={'requestPreviewContent'}>
            <div className={'requestPreviewContentTitle'}>
              <span style={reqCount ? { color: 'var(--good)' } : {}}>
                <Icon name='requests' size={13} />
              </span>
              <span>{reqCount ? (reqCount === 1 ? '1 request' : reqCount + ' requests') : 'Requests'}</span>
            </div>
            <div className={'requestPreviewContentArrow'} style={reqCount ? { color: 'var(--good)' } : {}}>
              <Icon name='next' size={14} />
            </div>
          </div>
        </button>
      </div>
    )
  }

  renderClearConfirmation(origin, count, groupKey) {
    if (this.state.clearOrigin !== origin || this.state.clearGroupKey !== groupKey) return null

    const requestLabel = count === 1 ? 'request' : 'requests'

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
          {`Clear ${count} staged ${requestLabel}?`}
        </div>
        <div id='request-clear-body' className='requestGroupClearBody'>
          {`This removes the staged ${requestLabel} from this list. It does not cancel transactions already submitted.`}
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
            onClick={() => this.confirmClearRequests(origin)}
          >
            Clear all
          </button>
        </div>
      </DialogSurface>
    )
  }

  requestQueueProps(req) {
    if (req.mode === 'monitor') return { active: false, queued: false }
    const active = req.handlerId === this.activeRequestId
    return { active, queued: !active }
  }

  renderRequestGroup(origin, requests, groupKey, originCount) {
    const groupName = getOriginDisplayName(this.store('main.origins', origin, 'name'))
    const clearing = this.clearPendingOrigins.has(origin)

    return (
      <section className='requestGroupBlock' key={groupKey}>
        <div className='requestGroup'>
          <div className='requestGroupMain'>
            <div style={{ marginRight: '8px' }}>
              <Icon name='apps' size={12} />
            </div>
            <div className='requestGroupName'>{groupName}</div>
          </div>
          <button
            ref={(element) => this.setClearButtonRef(groupKey, element)}
            type='button'
            aria-label={`Clear requests from ${groupName}`}
            className='requestGroupButton wrenControl wrenControlGhost wrenControlCompact'
            disabled={clearing}
            onClick={() => this.openClearConfirmation(origin, groupKey)}
          >
            <Icon name='close' size={14} />
            <span className='requestGroupButtonLabel'>{'Clear all'}</span>
          </button>
        </div>
        {this.renderClearConfirmation(origin, originCount, groupKey)}
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
              const { primaryColor, icon } = this.store('main.networksMeta.ethereum', chainId)

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
                nativeCurrency: { symbol: currentSymbol = '?' }
              } = this.store('main.networksMeta.ethereum', chainId)
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
                  title={`${chainName} transaction`}
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
    const requests = Object.values(activeAccount.requests || {}).sort(byRequestQueue)
    this.renderedRequests = requests
    const reviewQueue = requests.filter((request) => request.mode !== 'monitor')
    this.activeRequestId = activeAccount.activeRequestId
    this.requestIndexes = new Map(requests.map((request, index) => [request.handlerId, index]))

    const originCounts = {}
    requests.forEach((req) => {
      originCounts[req.origin] = (originCounts[req.origin] || 0) + 1
    })

    const groups = requests.reduce((result, req) => {
      const previous = result[result.length - 1]
      if (previous?.origin === req.origin) previous.requests.push(req)
      else result.push({ key: `${req.origin}:${req.handlerId}`, origin: req.origin, requests: [req] })
      return result
    }, [])

    const waitingCount = reviewQueue.filter((request) => request.handlerId !== this.activeRequestId).length
    const waitingCopy =
      waitingCount === 0
        ? 'No requests waiting'
        : waitingCount === 1
          ? '1 request waiting'
          : `${waitingCount} requests waiting`

    return (
      <div
        className={`accountViewScroll requestViewScroll${groups.length === 0 ? ' requestViewScrollEmpty' : ''}`}
      >
        <h2 ref={this.inboxHeadingRef} className='requestInboxHeading' tabIndex={-1}>
          Requests
        </h2>
        {requests.length ? (
          <div className='requestQueueStatus' role='status' aria-live='polite'>
            <span className='requestQueueStatusTitle'>{`Requests (${requests.length})`}</span>
            <span className='requestQueueStatusWaiting'>{waitingCopy}</span>
          </div>
        ) : null}
        {groups.length === 0 ? (
          <WrenEmptyState
            image={emptyRequests}
            title='No pending requests'
            copy='Requests from connected apps will appear here.'
            expanded
            transparentImage
          />
        ) : (
          groups.map((group) => {
            return this.renderRequestGroup(
              group.origin,
              group.requests,
              group.key,
              originCounts[group.origin]
            )
          })
        )}
      </div>
    )
  }
  render() {
    return this.props.expanded ? this.renderExpanded() : this.renderPreview()
  }
}

export default Restore.connect(Requests)
