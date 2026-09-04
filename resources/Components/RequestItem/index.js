import React from 'react'

import RingIcon from '../../../resources/Components/RingIcon'
import Icon from '../../../resources/Components/Icon'

import { ClusterRow, ClusterValue } from '../../../resources/Components/Cluster'

import link from '../../../resources/link'

const requestIcons = {
  accounts: 'accounts',
  chain: 'network',
  sign: 'sign',
  tokens: 'tokens'
}

let pendingRequestFocus = null

export const consumePendingRequestFocus = (account) => {
  if (!pendingRequestFocus || pendingRequestFocus.account !== account) return null
  const focusTarget = pendingRequestFocus
  pendingRequestFocus = null
  return focusTarget
}

class _RequestItem extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      ago: this.getElapsedTime(),
      opening: false
    }
    this.navigationPending = false
  }
  getElapsedTime() {
    const elapsed = Date.now() - ((this.props.req && this.props.req.created) || 0)
    const secs = Math.floor(elapsed / 1000)
    const mins = Math.floor(secs / 60)
    const hrs = Math.floor(mins / 60)
    const days = Math.floor(hrs / 24)
    if (days >= 1) return days + 'd ago'
    if (hrs >= 1) return hrs + 'h ago'
    if (mins >= 1) return mins + 'm ago'
    if (secs >= 30) return secs + 's ago'
    return 'NEW'
  }
  componentDidMount() {
    this.timer = setInterval(() => {
      this.setState({ ago: this.getElapsedTime() })
    }, 1000)
  }
  componentWillUnmount() {
    clearInterval(this.timer)
  }
  openRequest(account, req) {
    if (this.navigationPending) return
    this.navigationPending = true
    pendingRequestFocus = {
      account,
      handlerId: req.handlerId,
      index: this.props.i || 0
    }
    this.setState({ opening: true })
    const crumb = {
      view: 'requestView',
      data: {
        step: 'confirm',
        accountId: account,
        requestId: req.handlerId
      }
    }
    link.send('nav:forward', 'panel', crumb)
  }
  render() {
    const {
      account,
      title,
      svgName,
      img,
      color,
      headerMode,
      req,
      children,
      actionRef,
      active,
      queued,
      inspectableQueued,
      queuePosition,
      queueSize
    } = this.props

    let requestItemDetailsClass = 'requestItemDetails'
    let requestItemNoticeClass = 'requestItemNotice'

    if (['sent', 'sending', 'verifying', 'confirming', 'confirmed'].includes(req.status)) {
      requestItemDetailsClass += ' requestItemDetailsGood'
      requestItemNoticeClass += ' requestItemNoticeGood'
    } else if (req.status === 'error') {
      requestItemDetailsClass += ' requestItemDetailsBad'
      requestItemNoticeClass += ' requestItemNoticeBad'
    } else if (req.status === 'declined') {
      requestItemDetailsClass += ' requestItemDetailsNeutral'
      requestItemNoticeClass += ' requestItemNoticeNeutral'
    }

    const status = (req.status || 'pending').toLowerCase()
    const notice = (req.notice || '').toLowerCase()
    const displayedNotice =
      notice === 'network changed before signing'
        ? `${req.type === 'transaction' ? 'Transaction' : 'Request'} canceled. The network changed before signing. Nothing was signed or sent.`
        : notice

    const inactive = ['error', 'declined', 'confirmed'].includes(req.status)
    const waiting = Boolean(queued) && !inactive
    const displayedStatus = waiting ? 'waiting' : status
    const statusToneClass =
      req.status === 'confirmed'
        ? ' requestItemDetailsSlideGood'
        : req.status === 'error'
          ? ' requestItemDetailsSlideBad'
          : req.status === 'declined'
            ? ' requestItemDetailsSlideNeutral'
            : ''
    const queuePositionLabel = queuePosition && queueSize ? `${queuePosition} of ${queueSize}` : undefined
    const queueStateLabel = active
      ? `Current${queuePositionLabel ? ` · ${queuePositionLabel}` : ''}`
      : waiting && queuePositionLabel
        ? `Queued · ${queuePositionLabel}`
        : undefined
    const requestIcon = requestIcons[svgName]
    const recoveryShelfOwnsNotice =
      headerMode && req.type === 'transaction' && req.status === 'error' && req.retainedPreBroadcastError
    const statusIcon =
      req.status === 'error'
        ? 'failed'
        : req.status === 'declined'
          ? 'close'
          : ['sent', 'sending', 'verifying', 'confirming', 'confirmed'].includes(req.status)
            ? 'check'
            : 'pending'

    return (
      <ClusterRow>
        <ClusterValue
          ariaLabel={
            !headerMode
              ? queued
                ? `${title}. ${waiting ? queueStateLabel || 'Waiting' : status}`
                : `Review ${title}${active ? `. ${queueStateLabel || 'Current'}` : ''}`
              : undefined
          }
          actionRef={actionRef}
          disabled={!headerMode && (this.state.opening || (Boolean(queued) && !inspectableQueued))}
          onClick={!headerMode ? () => this.openRequest(account, req) : null}
        >
          <div
            key={req.handlerId}
            className={`${headerMode ? 'requestItem requestItemHeader' : 'requestItem'}${
              active ? ' requestItemQueueActive' : ''
            }${queued ? ' requestItemQueueWaiting' : ''}`}
          >
            <div
              className='requestItemBackground'
              style={{
                background: `linear-gradient(180deg, ${color} 0%, transparent 80%)`
              }}
            />
            <div className='requestItemTitle'>
              <div className='requestItemTitleLeft'>
                <div
                  className={requestIcon && !img ? 'requestItemIcon' : 'requestItemIcon requestItemIconRing'}
                >
                  {requestIcon && !img ? (
                    <Icon name={requestIcon} size={18} />
                  ) : (
                    <RingIcon color={color} svgName={svgName} img={img} small={true} />
                  )}
                </div>
                <div className='requestItemMain'>
                  <div className='requestItemTitleMain'>
                    <span>{title}</span>
                    {queueStateLabel && !headerMode ? (
                      <span className='requestItemQueueState'>{queueStateLabel}</span>
                    ) : null}
                  </div>
                  <div className={`requestItemDetailsSlide${statusToneClass}`}>
                    <div
                      className={
                        inactive
                          ? 'requestItemDetailsIndicator requestItemDetailsIndicatorStill'
                          : 'requestItemDetailsIndicator'
                      }
                    >
                      <div className='requestItemDetailsIndicatorMarker' />
                    </div>
                    <span role='status'>{displayedStatus}</span>
                  </div>
                </div>
              </div>
              <div className='requestItemTitleTime'>
                {this.state.ago === 'NEW' ? (
                  <div className='requestItemTitleTimeItem' style={{ color: 'var(--good)' }}>
                    {this.state.ago}
                  </div>
                ) : (
                  <div className='requestItemTitleTimeItem'>{this.state.ago}</div>
                )}
              </div>
              <div className={requestItemDetailsClass}>
                <Icon name={statusIcon} size={16} />
              </div>
            </div>
            <div style={headerMode ? { pointerEvents: 'auto' } : { pointerEvents: 'none' }}>{children}</div>
            {notice &&
              notice !== status &&
              !recoveryShelfOwnsNotice &&
              !(headerMode && req.type === 'transaction' && req.status === 'pending') && (
                <div
                  role='alert'
                  className={requestItemNoticeClass}
                  style={notice === 'see signer' ? { color: 'var(--good)' } : {}}
                >
                  {displayedNotice}
                </div>
              )}
          </div>
        </ClusterValue>
      </ClusterRow>
    )
  }
}

export default _RequestItem
