const presentations = {
  100: { label: 'Pending', detail: 'Wren is waiting for the batch to finish.', className: 'pending' },
  200: { label: 'Confirmed', detail: 'Every call completed successfully.', className: 'success' },
  400: {
    label: 'Failed',
    detail: 'The batch failed before any transaction was submitted.',
    className: 'failure'
  },
  500: { label: 'Reverted', detail: 'Every submitted call reverted.', className: 'failure' },
  600: {
    label: 'Partially executed',
    detail: 'The batch has mixed results or stopped before every call was submitted.',
    className: 'warning'
  }
}

const receiptLabel = (receipt) => (receipt.status === '0x1' ? 'Confirmed' : 'Reverted')

export function WalletCallsStatus({ accountId, chainName, originName, status }) {
  const presentation = presentations[status.status] || presentations[100]
  const receipts = Array.isArray(status.receipts) ? status.receipts : []

  return (
    <div className='walletCallsStatus'>
      <div className='walletCallsStatusScroll'>
        <div className='walletCallsStatusHeader'>
          <div className='walletCallsStatusOrigin'>{originName}</div>
          <div className='walletCallsStatusIntent'>wallet call batch</div>
          <div className='walletCallsStatusChain'>
            {chainName} ({status.chainId})
          </div>
          <div className='walletCallsStatusAccount'>{accountId}</div>
        </div>

        <div className={`walletCallsStatusSummary walletCallsStatusSummary-${presentation.className}`}>
          <div className='walletCallsStatusLabel'>{presentation.label}</div>
          <div className='walletCallsStatusDetail'>{presentation.detail}</div>
          <div className='walletCallsStatusAtomic'>Non-atomic execution</div>
        </div>

        <dl className='walletCallsStatusMetadata'>
          <div>
            <dt>Batch ID</dt>
            <dd>{status.id}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{status.version}</dd>
          </div>
        </dl>

        <div className='walletCallsStatusReceipts'>
          <div className='walletCallsStatusSectionTitle'>Transaction evidence</div>
          {receipts.length ? (
            receipts.map((receipt, index) => (
              <div className='walletCallsStatusReceipt' key={`${index}:${receipt.transactionHash}`}>
                <div className='walletCallsStatusReceiptHeader'>
                  <span>Transaction {index + 1}</span>
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
                <dl>
                  <div>
                    <dt>Hash</dt>
                    <dd>{receipt.transactionHash}</dd>
                  </div>
                  <div>
                    <dt>Block</dt>
                    <dd>{receipt.blockNumber}</dd>
                  </div>
                  <div>
                    <dt>Gas used</dt>
                    <dd>{receipt.gasUsed}</dd>
                  </div>
                </dl>
              </div>
            ))
          ) : (
            <div className='walletCallsStatusEmpty'>No transaction receipts are available yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default WalletCallsStatus
