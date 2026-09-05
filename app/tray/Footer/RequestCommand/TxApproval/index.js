import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'

const TxApproval = ({ req, approval }) => {
  const title = approval?.data?.title || 'estimated to fail'
  const label = approval?.data?.confirmLabel
  const confirmLabel =
    label === 'Proceed Anyway'
      ? 'Accept proxy changes'
      : !label || label === 'Proceed'
        ? 'Accept simulation risk'
        : label

  return (
    <div className='approveTransactionWarning'>
      <div className='approveTransactionWarningBody'>
        <div className='approveTransactionWarningTitle'>
          <div className='approveTransactionWarningIcon'>
            <Icon name='alert' size={24} />
          </div>
          {title}
        </div>
        <div className='approveTransactionWarningMessage'>
          {approval && approval.data && approval.data.message}
        </div>
        <div className='approveTransactionWarningActions'>
          <button
            type='button'
            className='_txActionButton'
            onClick={() => {
              link.rpc('declineRequest', req, () => {})
            }}
          >
            Decline
          </button>
          <button
            type='button'
            className='_txActionButton _txActionButtonGood'
            onClick={() => {
              link.rpc('confirmRequestApproval', req, approval.type, {}, () => {})
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TxApproval
