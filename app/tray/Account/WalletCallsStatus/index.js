import { useEffect, useRef, useState } from 'react'

import Icon from '../../../../resources/Components/Icon'
import link from '../../../../resources/link'

const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/

const presentations = {
  100: {
    label: 'Pending',
    detail: 'Wren is waiting for submitted transactions.',
    tone: 'pending',
    icon: 'pending'
  },
  200: {
    label: 'Confirmed',
    detail: 'Every transaction completed successfully.',
    tone: 'success',
    icon: 'verified'
  },
  400: {
    label: 'Failed',
    detail: 'The batch stopped before any transaction was submitted.',
    tone: 'failure',
    icon: 'failed'
  },
  500: {
    label: 'Reverted',
    detail: 'Every submitted transaction reverted.',
    tone: 'failure',
    icon: 'failed'
  },
  600: {
    label: 'Partially executed',
    detail: 'Some transactions succeeded while others reverted or were not submitted.',
    tone: 'warning',
    icon: 'alert'
  }
}

const unavailablePresentation = {
  label: 'Status unavailable',
  detail: 'Wren cannot verify the current status of this wallet call.',
  tone: 'warning',
  icon: 'alert'
}

const quantity = (value) => {
  if (typeof value !== 'string' || !QUANTITY.test(value)) return
  try {
    return BigInt(value)
  } catch {
    return
  }
}

const formatInteger = (value) => quantity(value)?.toLocaleString('en-US') || 'Unavailable'

const formatNative = (value, decimals, symbol) => {
  if (typeof value !== 'bigint') return 'Unavailable'
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, 8).replace(/0+$/, '')
  if (value > 0n && whole === 0n && !fraction && decimals > 0) {
    const precision = Math.min(decimals, 8)
    return `<0.${'0'.repeat(precision - 1)}1 ${symbol}`
  }
  return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`
}

const formatGwei = (value) => {
  const parsed = quantity(value)
  if (parsed === undefined) return
  const whole = parsed / 1_000_000_000n
  const fraction = (parsed % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} Gwei`
}

const shortValue = (value = '', lead = 10, tail = 8) =>
  value.length > lead + tail + 1 ? `${value.slice(0, lead)}…${value.slice(-tail)}` : value

const receiptLabel = (receipt) => (receipt.status === '0x1' ? 'Confirmed' : 'Reverted')

const feeModel = (receipt) => {
  if (receipt.type === '0x2') return 'EIP-1559 effective rate'
  if (receipt.type === '0x0' || receipt.type === '0x1') return 'Legacy effective rate'
  return 'Effective rate'
}

export function WalletCallsStatus({
  accountId,
  accountName,
  chainName,
  nativeCurrency = {},
  origin,
  originName,
  status
}) {
  const presentation = presentations[status.status] || unavailablePresentation
  const statusUnavailable = !presentations[status.status]
  const receipts = Array.isArray(status.receipts) ? status.receipts : []
  const confirmed = receipts.filter((receipt) => receipt.status === '0x1').length
  const hasPersistedCounts =
    Number.isSafeInteger(status.callCount) &&
    status.callCount >= 1 &&
    status.callCount <= 16 &&
    Number.isSafeInteger(status.submittedCount) &&
    status.submittedCount >= 0 &&
    status.submittedCount <= status.callCount &&
    Number.isSafeInteger(status.confirmedCount) &&
    status.confirmedCount >= 0 &&
    status.confirmedCount <= status.submittedCount
  const [copied, setCopied] = useState(-1)
  const [refreshing, setRefreshing] = useState(false)
  const copyTimer = useRef()
  const refreshPending = useRef(false)
  const decimals =
    Number.isInteger(nativeCurrency.decimals) &&
    nativeCurrency.decimals >= 0 &&
    nativeCurrency.decimals <= 255
      ? nativeCurrency.decimals
      : 18
  const symbol = nativeCurrency.symbol || '?'

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copyHash = (index, hash) => {
    link.send('tray:clipboardData', hash)
    clearTimeout(copyTimer.current)
    setCopied(index)
    copyTimer.current = setTimeout(() => setCopied(-1), 1000)
  }

  const statusDetail = hasPersistedCounts
    ? `${status.submittedCount} of ${status.callCount} submitted; ${status.confirmedCount} confirmed; ${status.callCount - status.submittedCount} not submitted. Unsent calls do not resume automatically.`
    : status.status === 600 && receipts.length
      ? `${confirmed} of ${receipts.length} submitted transactions confirmed.`
      : presentation.detail

  const refreshStatus = async () => {
    if (refreshPending.current || !origin) return
    refreshPending.current = true
    setRefreshing(true)
    try {
      await link.invoke('tray:refreshWalletCallsStatus', {
        account: accountId,
        id: status.id,
        origin
      })
    } finally {
      refreshPending.current = false
      setRefreshing(false)
    }
  }

  return (
    <div className='walletCallsStatus'>
      <div className='walletCallsStatusScroll'>
        <section className={`walletCallsStatusSummary walletCallsStatusSummary-${presentation.tone}`}>
          <div className='walletCallsStatusSummaryCopy'>
            <div className='walletCallsStatusEyebrow'>Wallet call batch</div>
            <h2>{presentation.label}</h2>
            <p>{statusDetail}</p>
          </div>
          <span className='walletCallsStatusMark' aria-hidden='true'>
            <Icon name={presentation.icon} size={20} />
          </span>
        </section>

        {statusUnavailable && (
          <div className='walletCallsStatusUnavailableActions'>
            <button type='button' disabled={refreshing || !origin} onClick={refreshStatus}>
              Refresh
            </button>
            <button type='button' onClick={() => link.send('nav:back', 'panel')}>
              Close
            </button>
          </div>
        )}

        <section className='walletCallsStatusSection'>
          <h3>Batch context</h3>
          <div className='walletCallsStatusContext'>
            <div>
              <span>Origin</span>
              <strong>{originName}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>
                {chainName} · {formatInteger(status.chainId)}
              </strong>
            </div>
            <div>
              <span>Account</span>
              <strong title={accountId}>
                {accountName ? `${accountName} · ` : ''}
                {shortValue(accountId, 8, 6)}
              </strong>
            </div>
            <div>
              <span>Execution</span>
              <strong className='walletCallsStatusNonAtomic'>Non-atomic</strong>
            </div>
          </div>
          <div className='walletCallsStatusAtomic'>
            <Icon name='alert' size={16} />
            <span>Non-atomic: an earlier transaction can remain confirmed if a later one fails.</span>
          </div>
        </section>

        <section className='walletCallsStatusSection walletCallsStatusEvidence'>
          <div className='walletCallsStatusSectionHeading'>
            <h3>Transaction evidence</h3>
            <span>
              {receipts.length
                ? `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`
                : 'No receipts yet'}
            </span>
          </div>
          {receipts.length ? (
            <div className='walletCallsStatusReceipts'>
              {receipts.map((receipt, index) => {
                const gasUsed = quantity(receipt.gasUsed)
                const gasPrice = quantity(receipt.effectiveGasPrice)
                const paid = gasUsed !== undefined && gasPrice !== undefined ? gasUsed * gasPrice : undefined
                return (
                  <div className='walletCallsStatusReceipt' key={`${index}:${receipt.transactionHash}`}>
                    <span className='walletCallsStatusReceiptNumber'>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className='walletCallsStatusReceiptBody'>
                      <button type='button' onClick={() => copyHash(index, receipt.transactionHash)}>
                        <strong>Transaction {index + 1}</strong>
                        <span>{copied === index ? 'Hash copied' : shortValue(receipt.transactionHash)}</span>
                      </button>
                      <dl>
                        <div>
                          <dt>Block</dt>
                          <dd>{formatInteger(receipt.blockNumber)}</dd>
                        </div>
                        <div>
                          <dt>Gas used</dt>
                          <dd>{formatInteger(receipt.gasUsed)}</dd>
                        </div>
                        <div>
                          <dt>Network fee</dt>
                          <dd>{paid === undefined ? 'Unavailable' : formatNative(paid, decimals, symbol)}</dd>
                          {gasPrice !== undefined && (
                            <small>
                              {formatGwei(receipt.effectiveGasPrice)} · {feeModel(receipt)}
                            </small>
                          )}
                        </div>
                      </dl>
                    </div>
                    <span
                      className={
                        receipt.status === '0x1'
                          ? 'walletCallsStatusReceiptGood'
                          : 'walletCallsStatusReceiptBad'
                      }
                    >
                      {receiptLabel(receipt)}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className='walletCallsStatusEmpty'>
              Receipts will appear here after transactions are submitted.
            </div>
          )}
        </section>

        <div className='walletCallsStatusMetadata'>
          <span title={status.id}>Batch {shortValue(status.id, 12, 8)}</span>
          <span>Version {status.version}</span>
          <span>Status {status.status}</span>
        </div>
      </div>
    </div>
  )
}

export default WalletCallsStatus
