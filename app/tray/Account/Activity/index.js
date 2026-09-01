import React from 'react'
import Restore from 'react-restore'
import { formatUnits } from 'ethers'

import Icon from '../../../../resources/Components/Icon'
import DialogSurface from '../../../../resources/Components/DialogSurface'
import link from '../../../../resources/link'
import {
  WREN_INTERNAL_ORIGIN,
  getManagedOriginNameForId,
  getOriginDisplayName,
  isManagedOriginName
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
  switchChain: { category: 'connections', icon: 'network', label: 'Network change' },
  addToken: { category: 'connections', icon: 'tokens', label: 'Token addition' }
})

const OUTCOME_LABELS = Object.freeze({
  completed: 'Completed',
  canceled: 'Canceled',
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
  canceled: 'The network changed before signing',
  submitted: 'Not yet confirmed',
  confirming: 'Included; waiting for final confirmation',
  replaced: 'A submitted wallet activity was replaced',
  reorged: 'A prior confirmation changed; Wren is checking again',
  stopped: 'Wren stopped checking. The network may still process it.',
  'clearance-unverified': 'Transaction confirmed. Wren could not verify that the delegation is cleared.',
  'verified-clearance': 'Wren verified this account no longer delegates execution.'
})

const submittedPresentation = (entry) => {
  if (entry.outcome !== 'submitted') return null
  if (entry.broadcastPhase === 'broadcasting') {
    return {
      label: 'Submission unconfirmed',
      detail: 'Broadcast may not have started; Wren is checking the signed transaction hash.'
    }
  }
  if (entry.broadcastPhase === 'unconfirmed') {
    return {
      label: 'Submission unconfirmed',
      detail:
        'Broadcast was attempted, but the network response was not confirmed. Wren is checking the network.'
    }
  }
  return null
}

const outcomePresentation = (entry) =>
  submittedPresentation(entry) || {
    label: OUTCOME_LABELS[entry.outcome],
    detail: OUTCOME_DETAILS[entry.outcome]
  }

export const activityTypeMeta = (type) => TYPE_META[type] || TYPE_META.transaction

export const activityOriginLabel = (origin, knownName) => {
  if (knownName) return getOriginDisplayName(knownName)
  const managedOriginName = getManagedOriginNameForId(origin)
  if (managedOriginName) return getOriginDisplayName(managedOriginName)
  if (isManagedOriginName(origin) || origin === WREN_INTERNAL_ORIGIN) return getOriginDisplayName(origin)

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
    return [meta.label, outcomePresentation(entry).label, activityOriginLabel(entry.origin)]
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

const formatExactTime = (timestamp) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(timestamp))

const formatQuantity = (value) => {
  try {
    return BigInt(value).toLocaleString()
  } catch {
    return 'Unavailable'
  }
}

const shortValue = (value, start = 10, end = 8) =>
  typeof value === 'string' && value.length > start + end + 1
    ? `${value.slice(0, start)}…${value.slice(-end)}`
    : value

const transactionHashFor = (operation) => operation?.transaction?.hash || operation?.eip7702Revoke?.hash

const ACTION_KIND_LABELS = Object.freeze({
  'native-value-transfer': 'Native value transfer',
  'contract-call': 'Contract call',
  'contract-deployment': 'Contract deployment',
  transaction: 'Transaction'
})

const ACTION_ARGUMENT_LABELS = Object.freeze({
  amount: 'Amount',
  approved: 'Approved',
  deadline: 'Deadline',
  from: 'Sender',
  operator: 'Operator',
  owner: 'Owner',
  spender: 'Spender',
  to: 'Recipient',
  tokenId: 'Token ID',
  value: 'Amount'
})

const compactAssetAmount = (value, decimals, symbol) => {
  try {
    const exact = formatUnits(value, decimals)
    const [whole, fraction = ''] = exact.split('.')
    const visibleFraction = fraction.slice(0, 8).replace(/0+$/u, '')
    const truncated = fraction.slice(8).replace(/0+$/u, '').length > 0
    const display = `${whole}${visibleFraction ? `.${visibleFraction}` : ''}${truncated ? '…' : ''}`
    return { display: `${display} ${symbol}`, exact: `${exact} ${symbol}` }
  } catch {
    const display = `${formatQuantity(value)} base units`
    return { display, exact: display }
  }
}

const sentenceLabel = (name) =>
  ACTION_ARGUMENT_LABELS[name] ||
  name.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, (character) => character.toUpperCase())

const actionFields = (action, nativeCurrency, token) => {
  const nativeDecimals = Number.isInteger(nativeCurrency?.decimals) ? nativeCurrency.decimals : 18
  const nativeSymbol = nativeCurrency?.symbol || '?'
  const nativeValue = compactAssetAmount(action.value, nativeDecimals, nativeSymbol)
  const fields = [
    { label: 'Type', value: ACTION_KIND_LABELS[action.kind] },
    ...(action.to
      ? [
          {
            label: action.kind === 'contract-call' ? 'Contract' : 'Recipient',
            value: shortValue(action.to),
            title: action.to
          }
        ]
      : []),
    ...(action.kind === 'contract-deployment'
      ? [{ label: 'Init code', value: `${action.inputBytes.toLocaleString()} bytes` }]
      : []),
    ...(action.value !== '0'
      ? [
          {
            label: action.kind === 'native-value-transfer' ? 'Amount' : 'Native value',
            value: nativeValue.display,
            title: nativeValue.exact
          }
        ]
      : []),
    ...(action.signature
      ? [{ label: 'Method', value: action.signature, title: action.signature }]
      : action.selector
        ? [{ label: 'Method', value: `${action.selector} · unknown`, title: action.selector }]
        : []),
    ...(action.kind === 'contract-call' && !action.selector
      ? [{ label: 'Call data', value: `${action.inputBytes.toLocaleString()} bytes` }]
      : []),
    ...action.arguments.map((argument) => {
      if (argument.type === 'address') {
        return {
          label: sentenceLabel(argument.name),
          value: shortValue(argument.value),
          title: argument.value
        }
      }
      if (/^uint/u.test(argument.type) && ['amount', 'value'].includes(argument.name)) {
        const formatted = token
          ? compactAssetAmount(argument.value, token.decimals, token.symbol)
          : {
              display: `${formatQuantity(argument.value)} base units`,
              exact: `${formatQuantity(argument.value)} base units`
            }
        return { label: sentenceLabel(argument.name), value: formatted.display, title: formatted.exact }
      }
      return {
        label: sentenceLabel(argument.name),
        value:
          argument.type === 'bool'
            ? argument.value === 'true'
              ? 'Yes'
              : 'No'
            : formatQuantity(argument.value)
      }
    })
  ]
  return fields
}

const ActivityActionDetails = ({ evidence, grouped, loading, nativeCurrency, tokenFor }) => {
  if (loading) {
    return (
      <div className='activityDetailUnavailable activityDetailActionStatus' role='status'>
        Loading action details from the connected network…
      </div>
    )
  }
  if (!evidence?.success) {
    return (
      <div className='activityDetailUnavailable activityDetailActionStatus' role='status'>
        {evidence?.error === 'evidence-unavailable'
          ? 'On-chain evidence unavailable.'
          : 'Action details unavailable from the connected network.'}
      </div>
    )
  }

  const multiple = grouped || evidence.actions.length > 1
  return (
    <section className='activityDetailSection activityDetailActionsEvidence'>
      <h2>{multiple ? 'Actions' : 'Action'}</h2>
      {evidence.actions.map((action, index) => {
        const token = action.to ? tokenFor(action.to) : undefined
        return (
          <div className='activityDetailAction' key={action.transactionHash}>
            {multiple ? <h3>{`Transaction ${index + 1}`}</h3> : null}
            <dl className='activityDetailGrid'>
              {actionFields(action, nativeCurrency, token).map(({ label, value, title }, fieldIndex) => (
                <DetailValue label={label} title={title} key={`${label}:${fieldIndex}`}>
                  {value}
                </DetailValue>
              ))}
            </dl>
            {action.argumentsTruncated ? (
              <div className='activityDetailActionNote'>Some opaque call arguments are omitted.</div>
            ) : null}
          </div>
        )
      })}
      {evidence.partial ? (
        <div className='activityDetailActionPartial' role='status'>
          Some transaction actions are unavailable from the connected network.
        </div>
      ) : null}
    </section>
  )
}

const ActivityRow = ({ entry, networkName, onOpen, originName, selected }) => {
  const meta = activityTypeMeta(entry.type)
  const origin = activityOriginLabel(entry.origin, originName)
  const outcome = outcomePresentation(entry)
  return (
    <li className='activityItem'>
      <button
        type='button'
        aria-label={`View ${meta.label} details from ${origin}`}
        className={`activityRow${selected ? ' activityRowSelected' : ''}`}
        data-activity-id={entry.id}
        onClick={() => onOpen(entry.id)}
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
        <span className='activityResult' title={outcome.detail}>
          <span className={`activityOutcome activityOutcome-${entry.outcome}`}>{outcome.label}</span>
          {outcome.detail ? <span className='activityOutcomeDetail'>{outcome.detail}</span> : null}
          <time dateTime={new Date(entry.completedAt).toISOString()}>{formatTime(entry.completedAt)}</time>
        </span>
        <span className='activityRowChevron' aria-hidden='true'>
          <Icon name='chevron-right' size={16} />
        </span>
      </button>
    </li>
  )
}

const DetailValue = ({ children, label, title }) => (
  <div className='activityDetailValue'>
    <dt>{label}</dt>
    <dd title={title}>{children}</dd>
  </div>
)

const DetailRow = ({ children }) => <div className='activityDetailSummaryRow'>{children}</div>

const ActivityDetail = ({
  account,
  actionEvidence,
  actionLoading,
  batch,
  entry,
  explorerAvailable,
  networkName,
  onCopyHash,
  onOpenExplorer,
  operation,
  originName,
  nativeCurrency,
  tokenFor
}) => {
  const meta = activityTypeMeta(entry.type)
  const origin = activityOriginLabel(entry.origin, originName)
  const outcome = outcomePresentation(entry)
  const resolvedActions = actionEvidence?.success ? actionEvidence.actions : []
  const transactionHash =
    transactionHashFor(operation) ||
    (entry.type !== 'walletCalls' ? resolvedActions[0]?.transactionHash : undefined)
  const receipt = operation?.receipt
  const transactionEvidence = operation?.transaction
  const batchTransactions = Array.isArray(batch?.transactions) ? batch.transactions : []
  const submittedBatchTransactions = batchTransactions.filter(({ state }) => state === 'submitted')
  const confirmedBatchTransactions = submittedBatchTransactions.filter(
    ({ receipt: batchReceipt }) => batchReceipt?.status === '0x1'
  )
  const revertedBatchTransactions = submittedBatchTransactions.filter(
    ({ receipt: batchReceipt }) => batchReceipt?.status === '0x0'
  )
  const onchainDetail = ['transaction', 'walletCalls', 'eip7702Revoke'].includes(entry.type)

  return (
    <section className='activityDetail' aria-label={`${meta.label} details`}>
      <header className='activityDetailHeader'>
        <span className='activityDetailMark' aria-hidden='true'>
          <Icon name={meta.icon} size={18} />
        </span>
        <span className='activityDetailIdentity'>
          <span className='activityDetailTitle'>{meta.label}</span>
          <span className='activityDetailContext'>
            {origin}
            {networkName ? ` · ${networkName}` : ''}
          </span>
        </span>
        <span className={`activityDetailOutcome activityOutcome-${entry.outcome}`}>{outcome.label}</span>
      </header>

      {outcome.detail ? <div className='activityDetailOutcomeCopy'>{outcome.detail}</div> : null}

      <section className='activityDetailSection'>
        <h2>Details</h2>
        <dl className='activityDetailSummary'>
          <DetailRow>
            <DetailValue label='App'>{origin}</DetailValue>
            {networkName ? <DetailValue label='Network'>{networkName}</DetailValue> : null}
          </DetailRow>
          <DetailRow>
            <DetailValue label='Account' title={account}>
              {shortValue(account)}
            </DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailValue label='Started'>{formatExactTime(entry.createdAt)}</DetailValue>
            <DetailValue label={entry.createdAt === entry.completedAt ? 'Recorded' : 'Updated'}>
              {formatExactTime(entry.completedAt)}
            </DetailValue>
          </DetailRow>
        </dl>
      </section>

      {onchainDetail ? (
        <ActivityActionDetails
          evidence={actionEvidence}
          grouped={Boolean(batch) || entry.type === 'walletCalls'}
          loading={actionLoading}
          nativeCurrency={nativeCurrency}
          tokenFor={tokenFor}
        />
      ) : null}

      {transactionHash ? (
        <section className='activityDetailSection activityDetailOnchain'>
          <h2>On-chain</h2>
          <dl className='activityDetailGrid'>
            <DetailValue label='Transaction hash' title={transactionHash}>
              {shortValue(transactionHash, 12, 10)}
            </DetailValue>
            {transactionEvidence ? (
              <DetailValue label='Nonce'>{formatQuantity(transactionEvidence.nonce)}</DetailValue>
            ) : null}
            {receipt ? <DetailValue label='Block'>{formatQuantity(receipt.blockNumber)}</DetailValue> : null}
            {receipt ? (
              <DetailValue label='Result'>{receipt.status === '0x1' ? 'Succeeded' : 'Reverted'}</DetailValue>
            ) : null}
            {receipt?.contractAddress ? (
              <DetailValue label='Contract' title={receipt.contractAddress}>
                {shortValue(receipt.contractAddress)}
              </DetailValue>
            ) : null}
            {operation?.replacement ? <DetailValue label='Replacement'>Replaced</DetailValue> : null}
            {transactionEvidence?.replacementOf ? (
              <DetailValue label='Replacement'>Replaces earlier activity</DetailValue>
            ) : null}
          </dl>
          <div className='activityDetailActions'>
            <button
              type='button'
              className='wrenControl wrenControlSecondary wrenControlLarge'
              onClick={() => onCopyHash(transactionHash)}
            >
              <Icon name='copy' size={15} />
              <span>Copy hash</span>
            </button>
            {explorerAvailable ? (
              <button
                type='button'
                className='wrenControl wrenControlSecondary wrenControlLarge'
                onClick={() => onOpenExplorer(transactionHash)}
              >
                <Icon name='external' size={15} />
                <span>View on explorer</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {batch ? (
        <section className='activityDetailSection activityDetailOnchain'>
          <h2>Batch</h2>
          <dl className='activityDetailGrid'>
            <DetailValue label='Calls'>{batch.callCount}</DetailValue>
            <DetailValue label='Submitted'>{submittedBatchTransactions.length}</DetailValue>
            <DetailValue label='Confirmed'>{confirmedBatchTransactions.length}</DetailValue>
            {revertedBatchTransactions.length ? (
              <DetailValue label='Reverted'>{revertedBatchTransactions.length}</DetailValue>
            ) : null}
          </dl>
          {batchTransactions.length ? (
            <ol className='activityDetailTransactions'>
              {batchTransactions.map((transaction, index) => {
                const batchReceipt = transaction.receipt
                return (
                  <li key={`${index}:${transaction.hash}`}>
                    <span className='activityDetailTransactionIdentity'>
                      <strong>Transaction {index + 1}</strong>
                      <span title={transaction.hash}>{shortValue(transaction.hash, 12, 10)}</span>
                    </span>
                    <span className='activityDetailTransactionResult'>
                      {batchReceipt
                        ? batchReceipt.status === '0x1'
                          ? 'Confirmed'
                          : 'Reverted'
                        : transaction.state === 'submitted'
                          ? 'Submitted'
                          : 'Signed'}
                      {batchReceipt ? ` · block ${formatQuantity(batchReceipt.blockNumber)}` : ''}
                    </span>
                    <span className='activityDetailTransactionActions'>
                      <button
                        type='button'
                        aria-label={`Copy transaction ${index + 1} hash`}
                        className='wrenControl wrenControlGhost wrenControlIcon'
                        onClick={() => onCopyHash(transaction.hash)}
                      >
                        <Icon name='copy' size={14} />
                      </button>
                      {explorerAvailable && transaction.state === 'submitted' ? (
                        <button
                          type='button'
                          aria-label={`View transaction ${index + 1} on explorer`}
                          className='wrenControl wrenControlGhost wrenControlIcon'
                          onClick={() => onOpenExplorer(transaction.hash)}
                        >
                          <Icon name='external' size={14} />
                        </button>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : null}
        </section>
      ) : null}
    </section>
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
      clearing: false,
      clearStatus: '',
      missingSelected: false,
      actionDetailsId: '',
      actionDetailsLoading: false,
      actionEvidence: undefined
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
    this.mounted = true
    this.resizeObserver?.observe(this.moduleRef.current)
    this.focusSelectedEntry()
    this.announceMissingSelectedEntry()
    this.loadActionDetails()
  }

  componentDidUpdate() {
    this.focusSelectedEntry()
    this.announceMissingSelectedEntry()
    this.loadActionDetails()
  }

  componentWillUnmount() {
    this.mounted = false
    this.actionDetailsRequest = (this.actionDetailsRequest || 0) + 1
    this.resizeObserver?.disconnect()
  }

  loadActionDetails() {
    const activityId = this.props.expandedData?.detailActivityId
    if (!this.props.expanded || !activityId || this.loadedActionDetailsId === activityId) return
    const entry = (this.store('main.activity') || []).find(({ id }) => id === activityId)
    if (!entry || !['transaction', 'walletCalls', 'eip7702Revoke'].includes(entry.type)) {
      this.loadedActionDetailsId = activityId
      return
    }

    this.loadedActionDetailsId = activityId
    const request = (this.actionDetailsRequest || 0) + 1
    this.actionDetailsRequest = request
    this.setState({
      actionDetailsId: activityId,
      actionDetailsLoading: true,
      actionEvidence: undefined
    })
    void link
      .invoke('activity:details', activityId)
      .then((result) => {
        if (!this.mounted || this.actionDetailsRequest !== request) return
        this.setState({ actionDetailsLoading: false, actionEvidence: result })
      })
      .catch(() => {
        if (!this.mounted || this.actionDetailsRequest !== request) return
        this.setState({
          actionDetailsLoading: false,
          actionEvidence: { success: false, error: 'lookup-failed' }
        })
      })
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

  openDetail(activityId) {
    if (this.state.navigating) return
    this.setState({ navigating: true })
    if (this.props.expanded) {
      link.send(
        'nav:update',
        'panel',
        {
          data: {
            ...this.props.expandedData,
            activityId
          }
        },
        false
      )
    }
    link.send('nav:forward', 'panel', {
      view: 'expandedModule',
      data: {
        id: this.props.moduleId,
        account: this.props.account,
        title: 'Activity detail',
        detailActivityId: activityId
      }
    })
  }

  copyHash(hash) {
    link.send('tray:copyTxHash', hash)
  }

  openExplorer(chainId, hash) {
    link.send('tray:openExplorer', { type: 'ethereum', id: chainId }, hash)
  }

  beginClear() {
    if (this.state.clearConfirm || this.state.clearing) return
    this.setState({ clearConfirm: true, clearStatus: '' }, () => this.cancelClearRef.current?.focus())
  }

  cancelClear() {
    if (this.state.clearing) return
    this.setState({ clearConfirm: false }, () => this.clearButtonRef.current?.focus())
  }

  async confirmClear() {
    if (!this.state.clearConfirm || this.state.clearing) return
    this.setState({ clearing: true })
    let status
    try {
      const result = await link.invoke('activity:clear')
      if (result?.success === true && result.durable === true) {
        status = 'Activity history and address memory cleared from this device.'
      } else if (result?.success === false && result.sessionOnly === true) {
        status =
          'Activity history and address memory are cleared for this session, but Wren could not confirm the change was saved. Restart may restore prior data.'
      }
    } catch {
      status = undefined
    }
    if (!status) {
      status = 'Wren could not confirm that Activity history and address memory were cleared. Try again.'
    }
    if (!this.mounted) return
    this.setState({ clearConfirm: false, clearing: false, clearStatus: status }, () =>
      this.clearStatusRef.current?.focus()
    )
  }

  render() {
    const allEntries = (this.store('main.activity') || []).filter(
      ({ account }) => account === this.props.account.toLowerCase()
    )
    const detailActivityId = this.props.expandedData?.detailActivityId
    if (this.props.expanded && detailActivityId) {
      const detailEntry = allEntries.find(({ id }) => id === detailActivityId)
      if (!detailEntry) {
        return (
          <section className='activityModule activityModuleExpanded'>
            <div className='activityDetailUnavailable' role='status'>
              This activity is no longer in history.
            </div>
          </section>
        )
      }

      const operation = this.store('main.operationLifecycles', detailEntry.id)
      const batches = this.store('main.walletCallBatches') || {}
      const batchOperationId = operation?.walletCalls?.batchOperationId
      const batch = batchOperationId
        ? Object.values(batches).find(({ operationId }) => operationId === batchOperationId)
        : undefined
      const network = detailEntry.chainId
        ? this.store('main.networks.ethereum', detailEntry.chainId)
        : undefined
      const networkName = detailEntry.chainId ? network?.name || `Network ${detailEntry.chainId}` : ''
      const originName = this.store('main.origins', detailEntry.origin, 'name')
      const explorerAvailable = typeof network?.explorer === 'string' && network.explorer.trim().length > 0
      const nativeCurrency =
        this.store('main.networksMeta.ethereum', detailEntry.chainId, 'nativeCurrency') || {}
      const balances = this.store('main.balances', this.props.account) || []
      const tokenFor = (address) =>
        balances.find(
          (balance) =>
            balance.chainId === detailEntry.chainId &&
            typeof balance.address === 'string' &&
            balance.address.toLowerCase() === address.toLowerCase()
        )
      const actionDetailsCurrent = this.state.actionDetailsId === detailEntry.id

      return (
        <section className='activityModule activityModuleExpanded'>
          <ActivityDetail
            account={this.props.account}
            actionEvidence={actionDetailsCurrent ? this.state.actionEvidence : undefined}
            actionLoading={actionDetailsCurrent && this.state.actionDetailsLoading}
            batch={batch}
            entry={detailEntry}
            explorerAvailable={explorerAvailable}
            networkName={networkName}
            onCopyHash={(hash) => this.copyHash(hash)}
            onOpenExplorer={(hash) => this.openExplorer(detailEntry.chainId, hash)}
            operation={operation}
            originName={originName}
            nativeCurrency={nativeCurrency}
            tokenFor={tokenFor}
          />
        </section>
      )
    }

    const filtered = filterActivity(allEntries, this.state.category, this.props.filter)
    const entries = this.props.expanded ? filtered : filtered.slice(0, ACTIVITY_PREVIEW_LIMIT)

    return (
      <section
        ref={this.moduleRef}
        className={`activityModule${this.props.expanded ? ' activityModuleExpanded' : ''}${
          entries.length ? '' : ' activityModuleEmpty'
        }`}
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
                  onOpen={(activityId) => this.openDetail(activityId)}
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
          <button
            type='button'
            className='accountContinuationRow activityContinuation'
            disabled={this.state.navigating}
            onClick={() => this.openExpanded()}
          >
            <span>View all activity</span>
            <Icon name='chevron-right' size={16} />
          </button>
        ) : null}

        {this.props.expanded && this.state.clearStatus ? (
          <div className='activityClearStatus' role='status' tabIndex={-1} ref={this.clearStatusRef}>
            {this.state.clearStatus}
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
                    appear again if Wren receives an update. This also clears Wren’s local outbound-address
                    memory, so prior-use and lookalike warnings may not appear again until you submit new
                    transactions. This cannot be undone.
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
