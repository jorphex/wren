import React from 'react'
import Restore from 'react-restore'

import Icon from '../../../../resources/Components/Icon'
import DialogSurface from '../../../../resources/Components/DialogSurface'
import link from '../../../../resources/link'
import {
  FRAME_SEND_ORIGIN,
  WREN_INTERNAL_ORIGIN,
  getOriginDisplayName
} from '../../../../resources/domain/origin'

export const ACTIVITY_PREVIEW_LIMIT = 4

const FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'signatures', label: 'Signatures' },
  { id: 'connections', label: 'Connections' }
])

const TYPE_META = Object.freeze({
  transaction: { category: 'transactions', icon: 'send', label: 'Transaction' },
  walletCalls: { category: 'transactions', icon: 'details', label: 'Wallet Calls batch' },
  eip7702Revoke: { category: 'transactions', icon: 'remove', label: 'Delegation revocation' },
  sign: { category: 'signatures', icon: 'sign', label: 'Message signature' },
  signTypedData: { category: 'signatures', icon: 'sign', label: 'Typed-data signature' },
  signErc20Permit: { category: 'signatures', icon: 'sign', label: 'Token permission signature' },
  access: { category: 'connections', icon: 'apps', label: 'Account access' },
  addChain: { category: 'connections', icon: 'network', label: 'Network addition' },
  addToken: { category: 'connections', icon: 'tokens', label: 'Token addition' }
})

const OUTCOME_LABELS = Object.freeze({
  completed: 'Completed',
  declined: 'Declined',
  submitted: 'Submitted',
  confirming: 'Confirming',
  confirmed: 'Confirmed',
  failed: 'Failed',
  replaced: 'Replaced',
  reorged: 'Reorg detected',
  stopped: 'Monitoring stopped',
  'clearance-unverified': 'Clearance not verified',
  'verified-clearance': 'Delegation removed'
})

const OUTCOME_DETAILS = Object.freeze({
  submitted: 'Sent to network',
  confirming: 'Included; waiting for final confirmation',
  replaced: 'A submitted wallet activity was replaced',
  reorged: 'A prior confirmation changed; Wren is checking again',
  stopped: 'Wren stopped checking. The network may still process it.',
  'clearance-unverified': 'Transaction confirmed. Wren could not verify that the delegation is cleared.',
  'verified-clearance': 'Wren verified this account no longer delegates execution.'
})

export const activityTypeMeta = (type) => TYPE_META[type] || TYPE_META.transaction

export const activityOriginLabel = (origin, knownName) => {
  if (knownName) return getOriginDisplayName(knownName)
  if (origin === FRAME_SEND_ORIGIN || origin === WREN_INTERNAL_ORIGIN) return getOriginDisplayName(origin)

  try {
    const parsed = new URL(origin)
    return parsed.hostname || 'Unknown app'
  } catch {
    return 'Unknown app'
  }
}

export const filterActivity = (entries, category, filter = '') => {
  const query = filter.trim().toLowerCase()
  return entries.filter((entry) => {
    const meta = activityTypeMeta(entry.type)
    if (category !== 'all' && meta.category !== category) return false
    if (!query) return true
    return [meta.label, OUTCOME_LABELS[entry.outcome], entry.origin]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query))
  })
}

const formatTime = (timestamp) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))

const ActivityRow = ({ entry, networkName, originName, selected }) => {
  const meta = activityTypeMeta(entry.type)
  const origin = activityOriginLabel(entry.origin, originName)
  return (
    <li
      className={`activityRow${selected ? ' activityRowSelected' : ''}`}
      data-activity-id={entry.id}
      tabIndex={selected ? -1 : undefined}
    >
      <span className='activityMark' aria-hidden='true'>
        <Icon name={meta.icon} size={15} />
      </span>
      <span className='activityIdentity'>
        <span className='activityTitle'>{meta.label}</span>
        <span className='activityContext'>
          {origin}
          {networkName ? ` · ${networkName}` : ''}
        </span>
      </span>
      <span className='activityResult' title={OUTCOME_DETAILS[entry.outcome]}>
        <span className={`activityOutcome activityOutcome-${entry.outcome}`}>
          {OUTCOME_LABELS[entry.outcome]}
        </span>
        {OUTCOME_DETAILS[entry.outcome] ? (
          <span className='activityOutcomeDetail'>{OUTCOME_DETAILS[entry.outcome]}</span>
        ) : null}
        <time dateTime={new Date(entry.completedAt).toISOString()}>{formatTime(entry.completedAt)}</time>
      </span>
    </li>
  )
}

export class Activity extends React.Component {
  constructor(...args) {
    super(...args)
    this.moduleRef = React.createRef()
    this.clearButtonRef = React.createRef()
    this.cancelClearRef = React.createRef()
    this.clearStatusRef = React.createRef()
    this.state = {
      category: 'all',
      navigating: false,
      clearConfirm: false,
      clearRequested: false,
      clearing: false,
      clearStatus: false,
      missingSelected: false
    }

    if (!this.props.expanded) {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.moduleRef.current) return
        link.send('tray:action', 'updateAccountModule', this.props.moduleId, {
          height: this.moduleRef.current.clientHeight
        })
      })
    }
  }

  componentDidMount() {
    this.resizeObserver?.observe(this.moduleRef.current)
    this.focusSelectedEntry()
    this.announceMissingSelectedEntry()
  }

  componentDidUpdate() {
    const activity = this.store('main.activity') || []
    if (this.state.clearRequested && activity.length === 0) {
      this.setState({ clearConfirm: false, clearRequested: false, clearing: false, clearStatus: true }, () =>
        this.clearStatusRef.current?.focus()
      )
    }
    this.focusSelectedEntry()
    this.announceMissingSelectedEntry()
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect()
  }

  focusSelectedEntry() {
    const activityId = this.props.expandedData?.activityId
    if (!this.props.expanded || !activityId || this.focusedActivityId === activityId) return
    const row = [...(this.moduleRef.current?.querySelectorAll('[data-activity-id]') || [])].find(
      (candidate) => candidate.dataset.activityId === activityId
    )
    if (!row) return
    this.focusedActivityId = activityId
    row.scrollIntoView?.({ block: 'center' })
    row.focus()
  }

  announceMissingSelectedEntry() {
    const activityId = this.props.expandedData?.activityId
    if (!this.props.expanded || !activityId) return
    const activity = this.store('main.activity') || []
    if (activity.some((entry) => entry.id === activityId)) {
      this.missingActivityId = undefined
      if (this.state.missingSelected) this.setState({ missingSelected: false })
      return
    }
    if (this.missingActivityId === activityId) return
    this.missingActivityId = activityId
    this.focusedActivityId = undefined
    this.setState({ missingSelected: true })
  }

  openExpanded() {
    if (this.state.navigating) return
    this.setState({ navigating: true })
    link.send('nav:forward', 'panel', {
      view: 'expandedModule',
      data: { id: this.props.moduleId, account: this.props.account, title: 'Activity' }
    })
  }

  beginClear() {
    if (this.state.clearConfirm || this.state.clearing) return
    this.setState({ clearConfirm: true, clearStatus: false }, () => this.cancelClearRef.current?.focus())
  }

  cancelClear() {
    if (this.state.clearing) return
    this.setState({ clearConfirm: false }, () => this.clearButtonRef.current?.focus())
  }

  confirmClear() {
    if (!this.state.clearConfirm || this.state.clearing) return
    this.setState({ clearRequested: true, clearing: true })
    link.send('tray:action', 'clearActivity')
  }

  render() {
    const allEntries = (this.store('main.activity') || []).filter(
      ({ account }) => account === this.props.account.toLowerCase()
    )
    const filtered = filterActivity(allEntries, this.state.category, this.props.filter)
    const entries = this.props.expanded ? filtered : filtered.slice(0, ACTIVITY_PREVIEW_LIMIT)

    return (
      <section
        ref={this.moduleRef}
        className={`activityModule${this.props.expanded ? ' activityModuleExpanded' : ''}`}
        aria-label={this.props.expanded ? 'Account activity' : undefined}
      >
        {!this.props.expanded ? (
          <div className='moduleHeader'>
            <span>
              <Icon name='pulse' size={15} />
            </span>
            <span>Activity</span>
          </div>
        ) : (
          <div className='activityFilters' role='group' aria-label='Filter account activity'>
            {FILTERS.map(({ id, label }) => (
              <button
                type='button'
                aria-pressed={this.state.category === id}
                className='activityFilter wrenControl wrenControlGhost wrenControlLarge'
                key={id}
                onClick={() => this.setState({ category: id })}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {entries.length ? (
          <ol className='activityList'>
            {entries.map((entry) => {
              const originName = this.store('main.origins', entry.origin, 'name')
              const networkName = entry.chainId
                ? this.store('main.networks.ethereum', entry.chainId, 'name') || `Network ${entry.chainId}`
                : ''
              return (
                <ActivityRow
                  entry={entry}
                  key={entry.id}
                  networkName={networkName}
                  originName={originName}
                  selected={this.props.expandedData?.activityId === entry.id}
                />
              )
            })}
          </ol>
        ) : (
          <div className='activityEmpty' role='status'>
            <strong>{allEntries.length ? 'No matching activity' : 'No activity yet'}</strong>
            <span>
              {allEntries.length
                ? 'Choose another activity filter.'
                : 'Completed wallet requests will appear here without their private contents.'}
            </span>
          </div>
        )}

        {!this.props.expanded && allEntries.length ? (
          <div className='activityFooter'>
            <button
              type='button'
              className='activityViewAll wrenControl wrenControlGhost wrenControlCompact'
              disabled={this.state.navigating}
              onClick={() => this.openExpanded()}
            >
              View all
            </button>
          </div>
        ) : null}

        {this.props.expanded && this.state.clearStatus ? (
          <div className='activityClearStatus' role='status' tabIndex={-1} ref={this.clearStatusRef}>
            Activity history cleared.
          </div>
        ) : null}

        {this.props.expanded && this.state.missingSelected ? (
          <div className='activityClearStatus' role='status'>
            This activity is no longer in history.
          </div>
        ) : null}

        {this.props.expanded && allEntries.length ? (
          <div className='activityClear'>
            {this.state.clearConfirm ? (
              <DialogSurface
                className='activityClearDialog'
                role='alertdialog'
                ariaLabel='Clear activity history?'
                describedBy='activity-clear-description'
                busy={this.state.clearing}
                initialFocusRef={this.cancelClearRef}
                returnFocusRef={this.clearButtonRef}
                onCancel={() => this.cancelClear()}
              >
                <div className='activityClearCopy'>
                  <strong>Clear activity history?</strong>
                  <span id='activity-clear-description'>
                    This removes activity history for every account on this device. Pending activity may
                    appear again if Wren receives an update. This cannot be undone.
                  </span>
                </div>
                <div className='activityClearActions'>
                  <button
                    type='button'
                    className='wrenControl wrenControlSecondary wrenControlLarge'
                    disabled={this.state.clearing}
                    onClick={() => this.cancelClear()}
                    ref={this.cancelClearRef}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    className='wrenControl wrenControlDanger wrenControlLarge'
                    disabled={this.state.clearing}
                    onClick={() => this.confirmClear()}
                  >
                    {this.state.clearing ? 'Clearing…' : 'Clear history'}
                  </button>
                </div>
              </DialogSurface>
            ) : (
              <button
                type='button'
                className='activityClearButton wrenControl wrenControlDanger wrenControlLarge'
                onClick={() => this.beginClear()}
                ref={this.clearButtonRef}
              >
                Clear activity
              </button>
            )}
          </div>
        ) : null}
      </section>
    )
  }
}

export default Restore.connect(Activity)
