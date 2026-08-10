import React from 'react'
import Restore from 'react-restore'
import yearnLogo from 'url:./assets/yearn-logo-white.svg'

import AssetMark from '../../../resources/Components/AssetMark'
import link from '../../../resources/link'
import {
  cancelYearnWorkflow,
  getYearnCatalog,
  getYearnPositions,
  getYearnWorkflows,
  resumeYearnWorkflow,
  revokeYearnWorkflow,
  startYearnWorkflow
} from './api'
import { isWatchOnlyAccountType } from '../../../resources/domain/signer'
import { isNetworkConnected } from '../../../resources/utils/chains'

const CHAINS = [
  { id: 'all', name: 'All' },
  { id: 1, name: 'Ethereum' },
  { id: 8453, name: 'Base' },
  { id: 747474, name: 'Katana' }
]

const ACTIVITY_PREVIEW_MAX = 3
const ACTIVITY_MORE_FALLBACK_HEIGHT = 45

const earnRoute = (data = {}) => ({
  selected: typeof data.vaultId === 'string' ? data.vaultId : '',
  selectedVariant: typeof data.variant === 'string' ? data.variant : '',
  activityExpanded: data.screen === 'activity' && typeof data.vaultId === 'string'
})

const earnCrumb = (selected, selectedVariant, screen = 'vault') => ({
  view: 'earn',
  data: { vaultId: selected, variant: selectedVariant, screen }
})

export const formatPercent = (value) =>
  typeof value === 'number'
    ? `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : 'Unavailable'

export const formatPercentLabel = (value, label) => {
  const formatted = formatPercent(value)
  return formatted === label ? formatted : `${formatted} ${label}`
}

export const formatUsd = (value) => {
  if (typeof value !== 'number') return 'Unavailable'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1_000 ? 1 : 0
  }).format(value)
}

export const formatAmount = (value) => {
  if (value === null || value === undefined) return 'Unavailable'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value
  return numeric.toLocaleString(undefined, { maximumFractionDigits: numeric < 1 ? 6 : 4 })
}

export const formatReceiptAmount = (raw, decimals) => {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) return raw
  if (decimals === 0) return raw
  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  if (!fraction) return whole
  const visible = fraction.slice(0, 6)
  return `${fraction.length > visible.length ? '~' : ''}${whole}.${visible}`
}

export const activityPreviewLimit = ({ cardHeights, total, budget, headingHeight, moreHeight }) => {
  const maximum = Math.min(ACTIVITY_PREVIEW_MAX, total, cardHeights.length)
  for (let count = maximum; count >= 0; count -= 1) {
    const cardsHeight = cardHeights.slice(0, count).reduce((sum, height) => sum + height, 0)
    const overflowHeight = count < total ? moreHeight : 0
    if (headingHeight + cardsHeight + overflowHeight <= budget) return count
  }
  return 0
}

const formatTimestamp = (value) =>
  Number.isSafeInteger(value) && value > 0
    ? new Date(value * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : 'Unavailable'

export const positionsMatchAccount = (positions, selected) =>
  Boolean(
    selected &&
    positions?.account?.address &&
    selected.toLowerCase() === positions.account.address.toLowerCase()
  )

export const workflowsForAccount = (workflows, vaultId, address) =>
  typeof address !== 'string'
    ? []
    : workflows.filter(
        (workflow) =>
          workflow.vaultId === vaultId &&
          typeof workflow.account === 'string' &&
          workflow.account.toLowerCase() === address.toLowerCase()
      )

const chainName = (chainId) => CHAINS.find(({ id }) => id === chainId)?.name || `Chain ${chainId}`

const earnChainColors = Object.freeze({ 1: 'accent1', 8453: 'accent8', 747474: 'accent3' })

const VaultArtwork = ({ vault, size = 'card' }) => (
  <AssetMark
    asset={{
      ...vault.asset,
      address: vault.address,
      artworkKey: vault.id,
      chainId: vault.chainId,
      primaryColor: earnChainColors[vault.chainId],
      symbol: vault.symbol
    }}
    className='earnVaultArtwork'
    showChain={false}
    size={size}
  />
)

const positionVariantLabel = (vault, variant, cooldown = false) => {
  if (cooldown) return 'In cooldown'
  if (vault.kind === 'yvUSD') return variant.id === 'locked' ? 'Locked' : 'Flexible'
  if (vault.kind === 'yBOLD') return variant.id === 'staked' ? 'Staked' : 'Unstaked'
  return ''
}

const ChainStatus = ({ chain }) => {
  if (!chain) {
    return <div className='earnNotice'>Position data is unavailable.</div>
  }
  if (['ready', 'partial'].includes(chain.status)) {
    return chain?.status === 'partial' ? (
      <div className='earnNotice earnNoticeWarn'>
        Some balances could not be read. Available data is shown.
      </div>
    ) : null
  }
  return (
    <div className='earnNotice'>
      <span>{chain.reason || 'Position data is unavailable.'}</span>
      {['disabled', 'disconnected'].includes(chain.status) ? (
        <button
          type='button'
          className='wrenControl wrenControlGhost wrenControlCompact'
          onClick={() => link.send('tray:action', 'navDash', { view: 'chains', data: {} })}
        >
          Manage networks
        </button>
      ) : null}
    </div>
  )
}

const Metric = ({ label, value }) => (
  <div className='earnMetric'>
    <div className='earnMetricLabel'>{label}</div>
    <div className='earnMetricValue'>{value}</div>
  </div>
)

const VaultCard = ({ vault, position, onSelect }) => {
  const unavailable = vault.status !== 'available'
  const formattedApy = formatPercent(vault.apy.value)
  const showApyLabel = formattedApy.toLowerCase() !== vault.apy.label.toLowerCase()
  return (
    <button
      type='button'
      className={`earnVault ${unavailable ? 'earnVaultUnavailable' : ''}`}
      onClick={(event) => onSelect(vault.id, event.currentTarget)}
      aria-label={`View ${vault.name} on ${vault.chainName}`}
    >
      <div className='earnVaultTop'>
        <div className='earnVaultIdentity'>
          <VaultArtwork vault={vault} />
          <div>
            <div className='earnVaultName'>{vault.name}</div>
            <div className='earnVaultAsset'>
              {vault.asset.symbol} · {vault.chainName}
            </div>
          </div>
        </div>
        <div className='earnApy'>
          <strong>{formattedApy}</strong>
          {showApyLabel ? <span>{vault.apy.label}</span> : null}
        </div>
      </div>
      <div className='earnVaultMetrics'>
        <span>{formatUsd(vault.tvlUsd)} TVL</span>
        <span>{vault.riskLabel} risk</span>
        {position?.assetBalance !== null && position?.assetBalance !== undefined ? (
          <span>
            {formatAmount(position.assetBalance)} {vault.asset.symbol} available
          </span>
        ) : null}
        {position?.hasPosition ? <span className='earnPositionPill'>Position</span> : null}
      </div>
      {unavailable ? <div className='earnVaultReason'>{vault.statusReason}</div> : null}
    </button>
  )
}

const PositionCard = ({ vault, position, onSelect }) => {
  const owned = position.variants.filter(
    ({ sharesRaw, cooldown }) => sharesRaw !== '0' || (cooldown?.sharesRaw || '0') !== '0'
  )
  return (
    <button
      type='button'
      className='earnPosition'
      onClick={(event) => onSelect(vault.id, event.currentTarget)}
      aria-label={`Manage ${vault.name} position`}
    >
      <div className='earnVaultIdentity'>
        <VaultArtwork vault={vault} size='position' />
        <div>
          <div className='earnPositionName'>{vault.name}</div>
          <div className='earnPositionChain'>{vault.chainName}</div>
        </div>
      </div>
      <div className='earnPositionAmounts'>
        {owned.map((variant) => (
          <div key={variant.address}>
            {variant.sharesRaw !== '0' ? (
              <div className='earnPositionAmount'>
                {positionVariantLabel(vault, variant) ? (
                  <span>{positionVariantLabel(vault, variant)}</span>
                ) : null}
                <strong>
                  {variant.assets !== null ? formatAmount(variant.assets) : formatAmount(variant.shares)}{' '}
                  {variant.assets !== null ? variant.assetSymbol : variant.symbol}
                </strong>
              </div>
            ) : null}
            {(variant.cooldown?.sharesRaw || '0') !== '0' ? (
              <div className='earnPositionAmount'>
                <span>{positionVariantLabel(vault, variant, true)}</span>
                <strong>
                  {formatAmount(variant.cooldown.shares)} {variant.symbol}
                </strong>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </button>
  )
}

const actionTitle = (action) =>
  ({
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    stake: 'Stake yBOLD',
    'start-cooldown': 'Start cooldown',
    'cancel-cooldown': 'Cancel cooldown',
    revoke: 'Revoke approval'
  })[action] || 'Yearn action'

const actionForm = (action, variant) => ({
  action,
  variant,
  amount: '',
  max: false,
  busy: false,
  error: ''
})

const availableForAction = (vault, position, form) => {
  if (form.action === 'cancel-cooldown') return null
  if (form.action === 'deposit') {
    return position?.assetBalance === null || position?.assetBalance === undefined
      ? null
      : { label: 'Available to deposit', amount: position.assetBalance, symbol: vault.asset.symbol }
  }

  const owned = position?.variants.find(({ id }) => id === form.variant)
  if (!owned) return null
  if (form.action === 'stake') {
    return { label: 'Available to stake', amount: owned.shares, symbol: owned.symbol }
  }
  if (form.action === 'withdraw' && form.variant === 'locked' && owned.sharesRaw === '0') {
    const cooldownShares = owned.cooldown?.shares
    return cooldownShares === null || cooldownShares === undefined
      ? null
      : { label: 'Shares in withdrawal window', amount: cooldownShares, symbol: owned.symbol }
  }
  if (form.action === 'withdraw' && form.variant === 'staked') {
    return { label: 'Available to withdraw', amount: owned.shares, symbol: owned.symbol }
  }

  const amount = owned.assets ?? owned.shares
  const symbol = owned.assets !== null ? owned.assetSymbol : owned.symbol
  const labels = {
    withdraw: 'Available to withdraw',
    'start-cooldown': 'Locked position'
  }
  return amount === null || amount === undefined
    ? null
    : { label: labels[form.action] || 'Available', amount, symbol }
}

const hasAvailableAmount = (available) => Boolean(available && /[1-9]/.test(String(available.amount)))

const durationDays = (seconds, fallback) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback
  const days = seconds / 86_400
  return Number.isInteger(days) ? `${days}-day` : `${days.toFixed(1)}-day`
}

const routeNeedsApproval = (action, variant) =>
  action === 'deposit' ||
  action === 'stake' ||
  (action === 'withdraw' && ['locked', 'staked'].includes(variant))

const actionDescription = (vault, form) => {
  if (form.action === 'deposit') {
    return `Deposit only ${vault.asset.symbol}; Wren will not swap or bridge assets.`
  }
  if (form.action === 'stake') return 'Stake existing yBOLD and receive ysyBOLD.'
  if (form.action === 'start-cooldown') {
    return 'Choose how much locked yvUSD to prepare for withdrawal.'
  }
  if (form.action === 'cancel-cooldown') {
    return 'Return cooling-down shares to the liquid locked position.'
  }
  if (form.variant === 'locked') {
    return `Exit locked yvUSD into ${vault.asset.symbol} during the active withdrawal window.`
  }
  if (form.variant === 'staked') return `Withdraw staked yBOLD directly to ${vault.asset.symbol}.`
  return `Withdraw directly to ${vault.asset.symbol}.`
}

const CooldownNotice = ({ cooldown }) => {
  const cooldownLength = durationDays(cooldown.cooldownDuration, '14-day')
  const windowLength = durationDays(cooldown.withdrawalWindow, '5-day')
  const messages = {
    none: `Locked withdrawals use a ${cooldownLength} cooldown followed by a ${windowLength} withdrawal window. No cooldown is active.`,
    'cooling-down': `Cooldown in progress. Your withdrawal window opens ${formatTimestamp(
      cooldown.cooldownEnd
    )} and closes ${formatTimestamp(cooldown.windowEnd)}.`,
    'withdrawal-window': `Your withdrawal window is open now and closes ${formatTimestamp(
      cooldown.windowEnd
    )}.`,
    expired: `The previous withdrawal window closed ${formatTimestamp(
      cooldown.windowEnd
    )}. Start a new cooldown to withdraw.`
  }
  return (
    <div className='earnProductNote earnCooldownNotice'>
      <strong>Locked withdrawal timing</strong>
      <span>{messages[cooldown.status]}</span>
    </div>
  )
}

const WorkflowCard = ({ workflow, onResume, onCancel, onRevoke, busy, canTransact }) => {
  const lastConfirmedApproval = [...workflow.steps]
    .reverse()
    .find(({ kind, status }) => ['approve', 'revoke'].includes(kind) && status === 'confirmed')
  const outstandingApproval = lastConfirmedApproval?.kind === 'approve'
  const current = workflow.steps[workflow.currentStep]
  const canResume =
    ['ready', 'error'].includes(workflow.status) && current && !(current.status === 'error' && current.txHash)
  const cleanupInProgress =
    workflow.status === 'canceled' && workflow.error === 'Approval cleanup in progress'
  const canRevoke =
    outstandingApproval && !cleanupInProgress && ['ready', 'error', 'canceled'].includes(workflow.status)
  const canRecoverCleanup =
    workflow.action === 'revoke' && workflow.status === 'canceled' && workflow.cleanupRecovery
  const canClose =
    workflow.action !== 'revoke' && !outstandingApproval && ['ready', 'error'].includes(workflow.status)
  return (
    <div className='earnWorkflow'>
      <div className='earnWorkflowHead'>
        <strong>{actionTitle(workflow.action)}</strong>
        <span role='status' aria-live='polite'>
          {workflow.status.replaceAll('-', ' ')}
        </span>
      </div>
      <div className='earnWorkflowAmount'>
        {workflow.displayAmount} {workflow.symbol}
      </div>
      <ol>
        {workflow.steps.map((step, index) => {
          const status =
            workflow.status === 'canceled' && ['pending', 'ready'].includes(step.status)
              ? 'canceled'
              : step.status
          return (
            <li className={status} key={step.id}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <em>{status.replaceAll('-', ' ')}</em>
                {step.txHash ? (
                  <button
                    type='button'
                    className='earnReceiptLink wrenControl wrenControlGhost wrenControlCompact'
                    onClick={() =>
                      link.send('tray:openExplorer', { type: 'ethereum', id: workflow.chainId }, step.txHash)
                    }
                  >
                    View transaction
                  </button>
                ) : null}
                {step.receiptTransfers?.length ? (
                  <div className='earnReceiptTransfers' role='status' aria-live='polite'>
                    {step.receiptTransfers.map((transfer) => (
                      <span key={`${transfer.token}:${transfer.direction}`} title={transfer.token}>
                        {transfer.direction === 'in' ? 'Received' : 'Sent'}{' '}
                        {formatReceiptAmount(transfer.amountRaw, transfer.decimals)} {transfer.symbol}
                      </span>
                    ))}
                    {step.receiptTransfersTruncated ? <em>Additional transfer evidence omitted</em> : null}
                  </div>
                ) : step.receiptTransfersTruncated ? (
                  <div className='earnReceiptTransfers' role='status' aria-live='polite'>
                    Transfer evidence exceeded the display bound
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      {workflow.error ? (
        <div className='earnWorkflowError' role='alert'>
          {workflow.error}
        </div>
      ) : null}
      <div className='earnWorkflowActions'>
        {canResume ? (
          <button
            type='button'
            className='wrenControl wrenControlPrimary wrenControlCompact'
            disabled={busy || !canTransact}
            onClick={() => onResume(workflow.id)}
          >
            {workflow.status === 'error' ? 'Retry' : 'Resume'}
          </button>
        ) : null}
        {canRevoke ? (
          <button
            type='button'
            className='wrenControl wrenControlDanger wrenControlCompact'
            disabled={busy || !canTransact}
            onClick={() => onRevoke(workflow.id)}
          >
            Revoke approval
          </button>
        ) : null}
        {canRecoverCleanup ? (
          <button
            type='button'
            className='wrenControl wrenControlDanger wrenControlCompact'
            disabled={busy || !canTransact}
            onClick={() => onRevoke(workflow.id)}
          >
            {workflow.cleanupRecovery === 'unknown-outcome' ? 'Recheck approval' : 'Revoke again'}
          </button>
        ) : null}
        {canClose ? (
          <button
            type='button'
            className='wrenControl wrenControlSecondary wrenControlCompact'
            disabled={busy}
            onClick={() => onCancel(workflow.id)}
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  )
}

const workflowPreviewOrder = (workflows) => [
  ...workflows.filter(({ status }) => !['complete', 'canceled'].includes(status)),
  ...workflows.filter(({ status }) => ['complete', 'canceled'].includes(status))
]

const elementOuterHeight = (element) => {
  if (!element) return 0
  const style = window.getComputedStyle(element)
  return element.offsetHeight + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0)
}

class ActivityPreview extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      visibleCount: Math.min(ACTIVITY_PREVIEW_MAX, props.workflows.length),
      measured: false
    }
  }

  componentDidMount() {
    this.viewport = this.section?.closest('.dashMainScroll')
    if (this.viewport && typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.prepareMeasure())
      this.resizeObserver.observe(this.viewport)
    }
    this.measure()
  }

  componentDidUpdate(previousProps) {
    if (previousProps.layoutKey !== this.props.layoutKey) this.prepareMeasure()
  }

  componentWillUnmount() {
    clearTimeout(this.measureTimer)
    this.resizeObserver?.disconnect()
  }

  prepareMeasure() {
    clearTimeout(this.measureTimer)
    const visibleCount = Math.min(ACTIVITY_PREVIEW_MAX, this.props.workflows.length)
    this.setState({ visibleCount, measured: false }, () => {
      this.measureTimer = setTimeout(() => this.measure(), 0)
    })
  }

  measure() {
    const footer = this.section?.parentElement?.querySelector('.earnDetailsFooter')
    if (!this.section || !footer || !this.viewport || this.viewport.clientHeight <= 0) {
      if (!this.state.measured) this.setState({ measured: true })
      return
    }
    const root = this.section.parentElement
    const rootStyle = window.getComputedStyle(root)
    const bottomPadding = parseFloat(rootStyle.paddingBottom || 0)
    const budget = this.viewport.clientHeight - this.section.offsetTop - footer.offsetHeight - bottomPadding
    const cardHeights = this.cards.map(elementOuterHeight)
    const visibleCount = activityPreviewLimit({
      cardHeights,
      total: this.props.workflows.length,
      budget,
      headingHeight: elementOuterHeight(this.heading),
      moreHeight: elementOuterHeight(this.more) || ACTIVITY_MORE_FALLBACK_HEIGHT
    })
    if (visibleCount !== this.state.visibleCount || !this.state.measured) {
      this.setState({ visibleCount, measured: true })
    }
  }

  render() {
    const { workflows, workflowBusy, canTransact, onResume, onCancel, onRevoke, onMore } = this.props
    const ordered = workflowPreviewOrder(workflows)
    const visible = ordered.slice(0, this.state.visibleCount)
    const hidden = workflows.length - visible.length
    this.cards = []
    return (
      <section
        className='earnWorkflows earnWorkflowsPreview'
        aria-labelledby='earn-recent-activity'
        ref={(element) => {
          this.section = element
        }}
        style={{ visibility: this.state.measured ? 'visible' : 'hidden' }}
      >
        <h2
          id='earn-recent-activity'
          ref={(element) => {
            this.heading = element
          }}
        >
          Recent activity
        </h2>
        {visible.map((workflow, index) => (
          <div
            key={workflow.id}
            ref={(element) => {
              if (element) this.cards[index] = element
            }}
          >
            <WorkflowCard
              workflow={workflow}
              busy={workflowBusy}
              canTransact={canTransact}
              onResume={onResume}
              onCancel={onCancel}
              onRevoke={onRevoke}
            />
          </div>
        ))}
        {hidden > 0 ? (
          <button
            type='button'
            className='earnMoreButton wrenControl wrenControlGhost wrenControlCompact'
            ref={(element) => {
              this.more = element
            }}
            onClick={(event) => onMore(event.currentTarget)}
          >
            +{hidden} More
          </button>
        ) : null}
      </section>
    )
  }
}

const ActivityView = ({
  vault,
  workflows,
  workflowBusy,
  canTransact,
  onResume,
  onCancel,
  onRevoke,
  viewRef
}) => (
  <div className='earnActivityView cardShow' ref={viewRef} tabIndex='-1'>
    <header className='earnActivityHeader'>
      <div className='earnEyebrow'>{vault.chainName}</div>
      <h1>Earn activity</h1>
      <p>{vault.name}</p>
    </header>
    <div className='earnWorkflows earnWorkflowsExpanded'>
      {workflows.map((workflow) => (
        <WorkflowCard
          key={workflow.id}
          workflow={workflow}
          busy={workflowBusy}
          canTransact={canTransact}
          onResume={onResume}
          onCancel={onCancel}
          onRevoke={onRevoke}
        />
      ))}
    </div>
  </div>
)

const ActionForm = ({ vault, position, form, disabled, onChange, onSubmit, formRef }) => {
  const variant = vault.variants.find(({ id }) => id === form.variant)
  const isCancel = form.action === 'cancel-cooldown'
  const needsApproval = routeNeedsApproval(form.action, form.variant)
  const available = availableForAction(vault, position, form)
  const maxAvailable = hasAvailableAmount(available)
  const symbol =
    form.action === 'deposit' ||
    (form.action === 'withdraw' && ['direct', 'unlocked', 'locked'].includes(form.variant)) ||
    form.action === 'start-cooldown'
      ? vault.asset.symbol
      : variant?.symbol || vault.symbol
  return (
    <div
      className='earnActionForm'
      aria-label={`${actionTitle(form.action)} ${vault.name}`}
      ref={formRef}
      tabIndex='-1'
    >
      <div className='earnActionHead'>
        <div>
          <span>{vault.chainName}</span>
          <h2>{actionTitle(form.action)}</h2>
        </div>
      </div>
      <p>{actionDescription(vault, form)}</p>
      {!isCancel ? (
        <div className='earnAmountField'>
          <label htmlFor='earn-action-amount'>Amount in {symbol}</label>
          <div className={form.error ? 'wrenInputGroup wrenInputGroupError' : 'wrenInputGroup'}>
            <input
              className='wrenInput'
              id='earn-action-amount'
              type='text'
              inputMode='decimal'
              autoComplete='off'
              aria-describedby={form.error ? 'earn-action-error' : undefined}
              aria-invalid={Boolean(form.error)}
              value={form.amount}
              disabled={form.max || form.busy || disabled}
              onChange={(event) => onChange({ amount: event.target.value, max: false, error: '' })}
              placeholder='0.0'
            />
            <button
              type='button'
              className={`wrenControl wrenControlSecondary wrenControlCompact ${
                form.max ? 'active wrenControlSelected' : ''
              }`}
              aria-pressed={form.max}
              disabled={form.busy || disabled || (!form.max && !maxAvailable)}
              onClick={() =>
                onChange({
                  amount: form.max ? '' : String(available?.amount || ''),
                  max: !form.max,
                  error: ''
                })
              }
            >
              Max
            </button>
          </div>
        </div>
      ) : null}
      {available ? (
        <div className='earnAvailable'>
          <span>
            {available.label}: {formatAmount(available.amount)} {available.symbol}
          </span>
        </div>
      ) : null}
      {form.error ? (
        <div id='earn-action-error' className='earnNotice earnNoticeWarn' role='alert'>
          {form.error}
        </div>
      ) : null}
      <div className='earnActionSafety'>
        {needsApproval
          ? 'This route may need a token approval. Wren requests only the exact amount.'
          : 'This action does not request a token approval.'}{' '}
        Every transaction opens Wren&apos;s simulation and signer review.
        {form.action === 'withdraw' ? ' Withdrawal loss tolerance is fixed at 0%.' : ''}
      </div>
      <button
        type='button'
        className='earnPrimaryAction wrenControl wrenControlPrimary wrenControlLarge'
        disabled={disabled || form.busy || (!isCancel && !form.max && !form.amount)}
        onClick={onSubmit}
      >
        {form.busy ? 'Preparing...' : `Review ${actionTitle(form.action)}`}
      </button>
    </div>
  )
}

const VaultDetails = ({
  vault,
  position,
  catalogStatus,
  account,
  chain,
  workflows,
  form,
  workflowBusy,
  selectedVariant: selectedVariantProp,
  onOpenAction,
  onFormChange,
  onSubmit,
  onOpenActivity,
  onResume,
  onCancel,
  onRevoke,
  detailsRef,
  formRef
}) => {
  const signingAccount = account && !account.readOnly && ['ready', 'partial'].includes(chain?.status)
  const canDeposit = signingAccount && vault.status === 'available' && catalogStatus === 'fresh'
  const canExit = signingAccount && position?.hasPosition
  const selectedVariant =
    form?.variant ||
    selectedVariantProp ||
    (vault.kind === 'yvUSD' ? 'unlocked' : vault.kind === 'yBOLD' ? 'staked' : 'direct')
  const locked = position?.variants.find(({ id }) => id === 'locked')
  const direct = position?.variants.find(({ id }) => id === 'direct')
  const cooldown = locked?.cooldown
  const canStartCooldown =
    canExit &&
    Boolean(cooldown) &&
    locked?.sharesRaw !== '0' &&
    ['none', 'expired'].includes(cooldown?.status)
  const canWithdrawLocked = canExit && cooldown?.status === 'withdrawal-window'
  const selectedOwned = position?.variants.find(({ id }) => id === selectedVariant)
  const displayVariant = vault.variants.find(({ id }) => id === selectedVariant) || vault.variants[0]
  const canWithdrawSelected =
    selectedVariant === 'locked'
      ? canWithdrawLocked
      : Boolean(canExit && selectedOwned && selectedOwned.sharesRaw !== '0')
  const canCancelCooldown =
    canExit && ['cooling-down', 'withdrawal-window', 'expired'].includes(cooldown?.status)
  const actionEnabled = {
    deposit: canDeposit,
    withdraw: canWithdrawSelected,
    stake: canDeposit,
    'start-cooldown': canStartCooldown,
    'cancel-cooldown': canCancelCooldown
  }
  return (
    <div className='earnDetails cardShow' ref={detailsRef} tabIndex='-1'>
      <div className='earnDetailsHero'>
        <div className='earnDetailsIdentity'>
          <VaultArtwork vault={vault} size='hero' />
          <div>
            <div className='earnEyebrow'>
              {vault.chainName} · {vault.asset.symbol}
            </div>
            <h1>{vault.name}</h1>
          </div>
        </div>
        <p>{vault.description}</p>
      </div>
      <div className='earnDetailsMetrics'>
        <Metric label='Est. APY' value={formatPercent(displayVariant?.apy.value)} />
        <Metric label='TVL' value={formatUsd(displayVariant?.tvlUsd)} />
        <Metric
          label={selectedVariant === 'locked' ? 'Underlying vault risk' : 'Risk'}
          value={vault.riskLabel}
        />
      </div>
      {vault.kind === 'yvUSD' ? (
        <div className='earnVariants'>
          <h2>Choose how to earn</h2>
          <div className='earnVariantGrid'>
            {vault.variants.map((variant) => (
              <button
                type='button'
                className={`earnVariant wrenControl wrenControlSecondary ${
                  selectedVariant === variant.id ? 'earnVariantSelected wrenControlSelected' : ''
                }`}
                aria-pressed={selectedVariant === variant.id}
                key={variant.id}
                onClick={() => onFormChange({ variant: variant.id, error: '' })}
              >
                <strong>{variant.id === 'locked' ? 'Locked' : 'Flexible'}</strong>
                <span>{formatPercentLabel(variant.apy.value, variant.apy.label)}</span>
                <p>
                  {variant.id === 'locked'
                    ? `A ${durationDays(cooldown?.cooldownDuration, '14-day')} cooldown and ${durationDays(
                        cooldown?.withdrawalWindow,
                        '5-day'
                      )} withdrawal window; the current displayed APY is higher.`
                    : 'Deposit and withdraw without a cooldown.'}
                </p>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {vault.kind === 'yBOLD' ? (
        <div className='earnProductNote'>
          Deposits finish staked as ysyBOLD. Existing unstaked yBOLD can be staked separately.
        </div>
      ) : null}
      {position?.hasPosition ? (
        <div className='earnOwned'>
          <h2>Your position</h2>
          {position.variants
            .filter(({ sharesRaw, cooldown }) => sharesRaw !== '0' || (cooldown?.sharesRaw || '0') !== '0')
            .map((variant) => (
              <React.Fragment key={variant.address}>
                {variant.sharesRaw !== '0' ? (
                  <div className='earnOwnedLine'>
                    {positionVariantLabel(vault, variant) ? (
                      <span>{positionVariantLabel(vault, variant)}</span>
                    ) : null}
                    <strong>
                      {formatAmount(variant.assets ?? variant.shares)}{' '}
                      {variant.assets !== null ? variant.assetSymbol : variant.symbol}
                    </strong>
                  </div>
                ) : null}
                {(variant.cooldown?.sharesRaw || '0') !== '0' ? (
                  <div className='earnOwnedLine'>
                    <span>In cooldown</span>
                    <strong>
                      {formatAmount(variant.cooldown.shares)} {variant.symbol}
                    </strong>
                    <em>{variant.cooldown.status.replace('-', ' ')}</em>
                  </div>
                ) : null}
              </React.Fragment>
            ))}
        </div>
      ) : null}
      {cooldown ? <CooldownNotice cooldown={cooldown} /> : null}
      {!signingAccount ? (
        <div className='earnNotice earnDetailsNotice'>
          {account?.readOnly
            ? 'Watch-only accounts can inspect positions but cannot transact.'
            : chain?.reason || 'Select a signing account to transact.'}
        </div>
      ) : null}
      {catalogStatus !== 'fresh' || vault.status !== 'available' ? (
        <div className='earnNotice earnDetailsNotice'>
          Deposits are disabled because current eligibility data is unavailable. Existing positions remain
          withdrawable.
        </div>
      ) : null}
      <div className='earnActions' role='group' aria-label='Vault action'>
        <button
          type='button'
          aria-pressed={form?.action === 'deposit'}
          className={`wrenControl wrenControlGhost wrenControlLarge ${
            form?.action === 'deposit' ? 'active wrenControlSelected' : ''
          }`}
          disabled={!canDeposit}
          onClick={() => onOpenAction('deposit', selectedVariant)}
        >
          Deposit
        </button>
        <button
          type='button'
          aria-pressed={form?.action === 'withdraw'}
          className={`wrenControl wrenControlGhost wrenControlLarge ${
            form?.action === 'withdraw' ? 'active wrenControlSelected' : ''
          }`}
          disabled={!canWithdrawSelected}
          onClick={() => onOpenAction('withdraw', selectedVariant)}
        >
          Withdraw
        </button>
      </div>
      {vault.kind === 'yvUSD' && locked ? (
        <div className='earnSecondaryActions'>
          <button
            type='button'
            className='wrenControl wrenControlSecondary wrenControlCompact'
            disabled={!canStartCooldown}
            onClick={() => onOpenAction('start-cooldown', 'locked')}
          >
            Start locked cooldown
          </button>
          <button
            type='button'
            className='wrenControl wrenControlDanger wrenControlCompact'
            disabled={!canCancelCooldown}
            onClick={() => onOpenAction('cancel-cooldown', 'locked')}
          >
            Cancel cooldown
          </button>
        </div>
      ) : null}
      {vault.kind === 'yBOLD' && direct?.sharesRaw !== '0' ? (
        <div className='earnSecondaryActions'>
          <button
            type='button'
            className='wrenControl wrenControlSecondary wrenControlCompact'
            disabled={!canDeposit}
            onClick={() => onOpenAction('stake', 'direct')}
          >
            Stake existing yBOLD
          </button>
        </div>
      ) : null}
      {form ? (
        <ActionForm
          vault={vault}
          position={position}
          form={form}
          disabled={!actionEnabled[form.action]}
          onChange={onFormChange}
          onSubmit={onSubmit}
          formRef={formRef}
        />
      ) : null}
      {workflows.length ? (
        <ActivityPreview
          workflows={workflows}
          workflowBusy={workflowBusy}
          canTransact={Boolean(signingAccount)}
          layoutKey={`${form?.action}:${form?.variant}:${Boolean(form?.error)}:${workflows
            .map(({ id, updatedAt, status }) => `${id}:${updatedAt}:${status}`)
            .join('|')}`}
          onMore={onOpenActivity}
          onResume={onResume}
          onCancel={onCancel}
          onRevoke={onRevoke}
        />
      ) : null}
      <div className='earnDetailsFooter'>
        <button
          type='button'
          className='earnYearnLink wrenControl wrenControlGhost wrenControlCompact'
          onClick={() => link.send('tray:openExternal', vault.yearnUrl)}
        >
          View on Yearn (external)
        </button>
        <button
          type='button'
          className='earnYearnLink wrenControl wrenControlGhost wrenControlCompact'
          onClick={() =>
            link.send('tray:openExplorer', { type: 'ethereum', id: vault.chainId }, null, vault.address)
          }
        >
          View vault contract (external)
        </button>
        <div className='earnDisclosure'>Yearn vaults involve smart-contract and strategy risk.</div>
      </div>
    </div>
  )
}

export class Earn extends React.Component {
  constructor(props) {
    super(props)
    const route = earnRoute(props.data)
    this.state = {
      loading: true,
      refreshing: false,
      error: '',
      catalog: null,
      positions: null,
      workflows: [],
      filter: 'all',
      ...route,
      form: route.selected ? actionForm('deposit', route.selectedVariant) : null,
      workflowBusy: false
    }
  }

  componentDidMount() {
    this.mounted = true
    this.storeKey = this.currentStoreKey()
    this.accountKey = this.store('selected.current') || ''
    this.load(false)
    this.workflowTimer = setInterval(() => this.loadWorkflows(), 15_000)
  }

  componentDidUpdate(previousProps) {
    const previousRoute = earnRoute(previousProps.data)
    const route = earnRoute(this.props.data)
    if (JSON.stringify(previousRoute) !== JSON.stringify(route)) {
      const sameVault = route.selected && route.selected === this.state.selected
      this.setState(
        {
          ...route,
          form: route.selected
            ? sameVault
              ? this.state.form || actionForm('deposit', route.selectedVariant)
              : actionForm('deposit', route.selectedVariant)
            : null
        },
        () => {
          if (route.activityExpanded) {
            this.earnActivity?.focus()
          } else if (route.selected) {
            if (previousRoute.activityExpanded) document.querySelector('.earnMoreButton')?.focus()
            else this.earnDetails?.focus()
          } else if (previousRoute.selected) {
            const trigger = [...document.querySelectorAll('button')].find(
              (button) => button.getAttribute('aria-label') === this.vaultTriggerLabel
            )
            trigger?.focus()
          }
        }
      )
    }
    const nextAccountKey = this.store('selected.current') || ''
    if (nextAccountKey !== this.accountKey) {
      this.accountKey = nextAccountKey
      if (this.state.form) {
        this.setState({
          form: actionForm('deposit', this.state.selectedVariant),
          error: ''
        })
      }
    }
    const nextKey = this.currentStoreKey()
    if (nextKey !== this.storeKey) {
      this.storeKey = nextKey
      this.loadPositions()
    }
  }

  componentWillUnmount() {
    this.mounted = false
    clearInterval(this.workflowTimer)
  }

  selectTab(event, index) {
    const keys = { ArrowLeft: -1, ArrowRight: 1 }
    let next = index
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = CHAINS.length - 1
    else if (keys[event.key]) next = (index + keys[event.key] + CHAINS.length) % CHAINS.length
    else return
    event.preventDefault()
    this.setState({ filter: CHAINS[next].id }, () => this[`earnTab${next}`]?.focus())
  }

  currentStoreKey() {
    const selected = this.store('selected.current') || ''
    const networks = [1, 8453, 747474].map((id) => {
      const network = this.store('main.networks.ethereum', id) || {}
      const endpoints = network.connection?.endpoints || []
      return [
        id,
        network.on,
        endpoints.map(({ on, connected, current, custom }) => [on, connected, current, custom])
      ]
    })
    return JSON.stringify([selected, networks])
  }

  async load(force) {
    this.setState({ loading: !this.state.catalog, refreshing: Boolean(this.state.catalog), error: '' })
    try {
      const [catalog, positions, workflowResult] = await Promise.all([
        getYearnCatalog(force),
        getYearnPositions(),
        getYearnWorkflows()
      ])
      if (this.mounted) {
        this.setState({
          catalog,
          positions,
          workflows: workflowResult.workflows,
          loading: false,
          refreshing: false
        })
      }
    } catch {
      if (this.mounted) {
        this.setState({ error: 'Earn data could not be loaded.', loading: false, refreshing: false })
      }
    }
  }

  async loadPositions() {
    try {
      const positions = await getYearnPositions()
      if (this.mounted) this.setState({ positions })
    } catch {
      if (this.mounted) this.setState({ error: 'Account positions could not be refreshed.' })
    }
  }

  async loadWorkflows() {
    try {
      const result = await getYearnWorkflows()
      if (this.mounted) {
        const previous = new Map(this.state.workflows.map(({ id, status }) => [id, status]))
        const completed = result.workflows.some(
          ({ id, status }) => status === 'complete' && previous.get(id) !== 'complete'
        )
        this.setState({ workflows: result.workflows })
        if (completed) this.loadPositions()
      }
    } catch {
      if (this.mounted) this.setState({ error: 'Earn activity could not be refreshed.' })
    }
  }

  selectVault(selected, trigger) {
    const vault = this.state.catalog?.vaults.find(({ id }) => id === selected)
    const selectedVariant =
      vault?.kind === 'yvUSD' ? 'unlocked' : vault?.kind === 'yBOLD' ? 'staked' : 'direct'
    this.vaultTriggerLabel = trigger?.getAttribute('aria-label')
    link.send('nav:forward', 'dash', earnCrumb(selected, selectedVariant))
    this.setState(
      {
        selected,
        selectedVariant,
        activityExpanded: false,
        form: actionForm('deposit', selectedVariant),
        error: ''
      },
      () => this.earnDetails?.focus()
    )
  }

  openAction(action, variant) {
    const vault = this.state.catalog?.vaults.find(({ id }) => id === this.state.selected)
    const safeVariant = vault?.kind === 'yBOLD' && action === 'deposit' ? 'staked' : variant
    link.send('nav:update', 'dash', earnCrumb(this.state.selected, safeVariant), false)
    this.setState(
      {
        selectedVariant: safeVariant,
        form: actionForm(action, safeVariant)
      },
      () => this.earnActionForm?.focus()
    )
  }

  openActivity() {
    link.send('nav:forward', 'dash', earnCrumb(this.state.selected, this.state.selectedVariant, 'activity'))
    this.setState({ activityExpanded: true }, () => this.earnActivity?.focus())
  }

  changeForm(changes) {
    if (!this.state.form) {
      if (changes.variant) {
        link.send('nav:update', 'dash', earnCrumb(this.state.selected, changes.variant), false)
        this.setState({ selectedVariant: changes.variant })
      }
      return
    }
    if (changes.variant) {
      link.send('nav:update', 'dash', earnCrumb(this.state.selected, changes.variant), false)
    }
    this.setState(({ form }) => ({
      ...(changes.variant && { selectedVariant: changes.variant }),
      form: changes.variant ? actionForm(form.action, changes.variant) : { ...form, ...changes }
    }))
  }

  async submitForm() {
    const form = this.state.form
    if (!form) return
    this.changeForm({ busy: true, error: '' })
    try {
      const workflow = await startYearnWorkflow({
        vaultId: this.state.selected,
        action: form.action,
        variant: form.variant,
        amount: form.amount || '0',
        max: form.max
      })
      if (this.mounted) {
        this.setState(({ workflows }) => ({
          workflows: [workflow, ...workflows.filter(({ id }) => id !== workflow.id)],
          form: actionForm(form.action, form.variant)
        }))
      }
    } catch (error) {
      if (this.mounted)
        this.changeForm({ busy: false, error: error.message || 'Could not prepare transaction.' })
    }
  }

  async runWorkflow(operation, id) {
    if (this.state.workflowBusy) return
    this.setState({ workflowBusy: true, error: '' })
    try {
      const workflow = await operation(id)
      if (this.mounted) {
        this.setState(({ workflows }) => ({
          workflows: [workflow, ...workflows.filter(({ id: candidate }) => candidate !== workflow.id)],
          workflowBusy: false
        }))
      }
    } catch (error) {
      if (this.mounted)
        this.setState({ workflowBusy: false, error: error.message || 'Workflow update failed.' })
    }
  }

  currentPositions() {
    const selected = this.store('selected.current')
    return positionsMatchAccount(this.state.positions, selected) ? this.state.positions : null
  }

  positionFor(vaultId) {
    return this.currentPositions()
      ?.chains.flatMap(({ positions }) => positions)
      .find((position) => position.vaultId === vaultId)
  }

  positionsFor(vaults) {
    return vaults
      .map((vault) => ({ vault, position: this.positionFor(vault.id) }))
      .filter(({ position }) => position?.hasPosition)
  }

  renderPositions(positions) {
    if (!positions.length) return null

    return (
      <section className='earnPositionsOverview' aria-labelledby='earn-positions-heading'>
        <h2 id='earn-positions-heading'>Your positions</h2>
        <div className='earnPositionList'>
          {positions.map(({ vault, position }) => (
            <PositionCard
              key={vault.id}
              vault={vault}
              position={position}
              onSelect={(selected, trigger) => this.selectVault(selected, trigger)}
            />
          ))}
        </div>
      </section>
    )
  }

  renderChain(chainId, vaults) {
    const positionChain = this.currentPositions()?.chains.find((chain) => chain.chainId === chainId)
    return (
      <section className='earnChain' key={chainId} aria-labelledby={`earn-chain-${chainId}`}>
        <div className='earnChainHeading'>
          <h2 id={`earn-chain-${chainId}`}>{chainName(chainId)}</h2>
          <span>
            {vaults.length} curated {vaults.length === 1 ? 'vault' : 'vaults'}
          </span>
        </div>
        <ChainStatus chain={positionChain} />
        <div className='earnVaultList'>
          {vaults.map((vault) => (
            <VaultCard
              key={vault.id}
              vault={vault}
              position={this.positionFor(vault.id)}
              onSelect={(selected, trigger) => this.selectVault(selected, trigger)}
            />
          ))}
        </div>
      </section>
    )
  }

  render() {
    const { catalog, workflows, filter, selected } = this.state
    const currentPositions = this.currentPositions()
    if (this.state.loading)
      return (
        <div className='earnState cardShow' role='status'>
          Loading curated Yearn vaults...
        </div>
      )
    if (!catalog) {
      return (
        <div className='earnState cardShow'>
          {this.state.error || 'Earn is unavailable.'}
          <button type='button' className='wrenControl wrenControlPrimary' onClick={() => this.load(true)}>
            Try again
          </button>
        </div>
      )
    }
    const selectedVault = catalog.vaults.find(({ id }) => id === selected)
    if (selectedVault) {
      const selectedAccountId = this.store('selected.current')
      const selectedAccountRecord = selectedAccountId
        ? this.store('main.accounts', selectedAccountId)
        : undefined
      const selectedAccountAddress =
        selectedAccountRecord?.address ||
        selectedAccountRecord?.id ||
        currentPositions?.account?.address ||
        ''
      const selectedAccount = selectedAccountRecord
        ? {
            ...selectedAccountRecord,
            address: selectedAccountAddress,
            readOnly: isWatchOnlyAccountType(selectedAccountRecord.lastSignerType)
          }
        : currentPositions?.account
      const selectedWorkflows = workflowsForAccount(workflows, selectedVault.id, selectedAccountAddress)
      const selectedChain = currentPositions?.chains.find(({ chainId }) => chainId === selectedVault.chainId)
      const selectedNetwork = this.store('main.networks.ethereum', selectedVault.chainId)
      const signingAccount =
        selectedAccount &&
        !selectedAccount.readOnly &&
        (selectedNetwork
          ? isNetworkConnected(selectedNetwork)
          : ['ready', 'partial'].includes(selectedChain?.status))
      if (this.state.activityExpanded) {
        return (
          <ActivityView
            vault={selectedVault}
            workflows={selectedWorkflows}
            workflowBusy={this.state.workflowBusy}
            canTransact={Boolean(signingAccount)}
            viewRef={(element) => {
              this.earnActivity = element
            }}
            onResume={(id) => this.runWorkflow(resumeYearnWorkflow, id)}
            onCancel={(id) => this.runWorkflow(cancelYearnWorkflow, id)}
            onRevoke={(id) => this.runWorkflow(revokeYearnWorkflow, id)}
          />
        )
      }
      return (
        <VaultDetails
          vault={selectedVault}
          position={this.positionFor(selectedVault.id)}
          catalogStatus={catalog.status}
          account={selectedAccount}
          chain={selectedChain}
          workflows={selectedWorkflows}
          form={this.state.form}
          workflowBusy={this.state.workflowBusy}
          selectedVariant={this.state.selectedVariant}
          detailsRef={(element) => {
            this.earnDetails = element
          }}
          formRef={(element) => {
            this.earnActionForm = element
          }}
          onOpenAction={(action, variant) => this.openAction(action, variant)}
          onFormChange={(changes) => this.changeForm(changes)}
          onSubmit={() => this.submitForm()}
          onOpenActivity={() => this.openActivity()}
          onResume={(id) => this.runWorkflow(resumeYearnWorkflow, id)}
          onCancel={(id) => this.runWorkflow(cancelYearnWorkflow, id)}
          onRevoke={(id) => this.runWorkflow(revokeYearnWorkflow, id)}
        />
      )
    }
    const visibleChains = CHAINS.slice(1).filter(({ id }) => filter === 'all' || id === filter)
    const visibleChainIds = new Set(visibleChains.map(({ id }) => id))
    const visibleVaults = catalog.vaults.filter(({ chainId }) => visibleChainIds.has(chainId))
    const visiblePositions = this.positionsFor(visibleVaults)
    return (
      <div className='earn cardShow'>
        <header className='earnHero'>
          <div className='earnEyebrow earnProvider'>
            <span>Vaults by</span>
            <img src={yearnLogo} alt='Yearn' />
          </div>
          <h1>Earn</h1>
          <p>A focused selection of established vaults, separated by chain.</p>
          <button
            type='button'
            className='earnRefresh wrenControl wrenControlSecondary wrenControlCompact'
            disabled={this.state.refreshing}
            onClick={() => this.load(true)}
          >
            {this.state.refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>
        {catalog.status !== 'fresh' ? (
          <div className='earnNotice earnNoticeWarn'>
            Showing {catalog.status === 'stale' ? 'cached' : 'unavailable'} Yearn data. New deposits are
            disabled; existing positions remain manageable.
          </div>
        ) : null}
        {currentPositions?.account ? (
          <div className='earnAccount'>
            <span>Account</span>
            <strong>
              {currentPositions.account.name ||
                `${currentPositions.account.address.slice(0, 6)}...${currentPositions.account.address.slice(-4)}`}
            </strong>
            {currentPositions.account.readOnly ? <em>Watch-only</em> : null}
          </div>
        ) : null}
        <div className='earnTabs' role='tablist' aria-label='Filter Earn by chain'>
          {CHAINS.map((chain, index) => (
            <button
              type='button'
              role='tab'
              id={`earn-tab-${chain.id}`}
              aria-controls='earn-chain-panels'
              aria-selected={filter === chain.id}
              tabIndex={filter === chain.id ? 0 : -1}
              className={`wrenControl wrenControlGhost wrenControlCompact ${
                filter === chain.id ? 'earnTabActive' : ''
              }`}
              key={chain.id}
              ref={(element) => {
                this[`earnTab${index}`] = element
              }}
              onClick={() => this.setState({ filter: chain.id })}
              onKeyDown={(event) => this.selectTab(event, index)}
            >
              {chain.name}
            </button>
          ))}
        </div>
        {this.state.error ? (
          <div className='earnNotice earnNoticeWarn' role='alert'>
            {this.state.error}
          </div>
        ) : null}
        {this.renderPositions(visiblePositions)}
        <div id='earn-chain-panels' role='tabpanel' aria-labelledby={`earn-tab-${filter}`}>
          {visibleChains.map(({ id }) =>
            this.renderChain(
              id,
              catalog.vaults.filter(({ chainId }) => chainId === id)
            )
          )}
        </div>
      </div>
    )
  }
}

export default Restore.connect(Earn)
