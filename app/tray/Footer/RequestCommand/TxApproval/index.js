import { useState } from 'react'
import Icon from '../../../../../resources/Components/Icon'
import link from '../../../../../resources/link'

const TxApproval = ({ req, approval, inline = false, readOnly = false }) => {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const title = approval?.data?.title || 'estimated to fail'
  const label = approval?.data?.confirmLabel
  const confirmLabel =
    label === 'Proceed Anyway'
      ? 'Accept proxy changes'
      : !label || label === 'Proceed'
        ? 'Accept simulation risk'
        : label

  return (
    <div className={`approveTransactionWarning${inline ? ' signingReviewAcknowledgement' : ''}`}>
      <div className='approveTransactionWarningBody'>
        <div className='approveTransactionWarningTitle'>
          <div className='approveTransactionWarningIcon'>
            <Icon name='alert' size={inline ? 20 : 24} />
          </div>
          {title}
        </div>
        <div className='approveTransactionWarningMessage'>
          {approval && approval.data && approval.data.message}
        </div>
        <div className='approveTransactionWarningActions'>
          {!inline ? (
            <button
              type='button'
              className='_txActionButton'
              onClick={() => {
                link.rpc('declineRequest', req, () => {})
              }}
            >
              Decline
            </button>
          ) : null}
          <button
            type='button'
            className={inline ? 'wrenControl wrenControlSecondary' : '_txActionButton _txActionButtonGood'}
            disabled={inline && (readOnly || pending || approval?.approved)}
            aria-pressed={inline ? Boolean(approval?.approved) : undefined}
            onClick={() => {
              if (inline && (readOnly || pending || approval?.approved)) return
              if (inline) {
                setPending(true)
                setError('')
              }
              link.rpc(
                'confirmRequestApproval',
                req,
                approval.type,
                approval.data?.consentFingerprint
                  ? { consentFingerprint: approval.data.consentFingerprint }
                  : {},
                (failure) => {
                  if (inline) {
                    setPending(false)
                    if (failure) setError('Approval changed or unavailable. Review it again.')
                  }
                }
              )
            }}
          >
            {inline && approval?.approved ? 'Accepted' : pending ? 'Accepting…' : confirmLabel}
          </button>
        </div>
        {error ? (
          <span className='signingReviewAcknowledgementError' role='alert'>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export default TxApproval
