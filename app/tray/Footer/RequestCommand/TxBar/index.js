import Icon from '../../../../../resources/Components/Icon'

const steps = [
  { icon: 'send', label: 'Submitted' },
  { icon: 'pending', label: 'Confirming' },
  { icon: 'verified', label: 'Confirmed' }
]

export const isUnconfirmedSubmission = (req) =>
  req?.status === 'verifying' && req?.submission?.status === 'unconfirmed'

export const transactionLifecyclePresentation = (req, networkName = 'the network') => {
  if (isUnconfirmedSubmission(req)) {
    return {
      detail: 'Checking network acceptance. Wren will not resend automatically.',
      icon: 'alert',
      position: 0,
      title: 'Broadcast unconfirmed',
      tone: 'warning'
    }
  }

  switch (req?.status) {
    case 'pending':
      return {
        detail: 'Wren is waiting for your signer to sign this transaction.',
        icon: 'sign',
        position: -1,
        title: 'View signer',
        tone: 'pending'
      }
    case 'sending':
      return {
        detail: 'Wren is sending the transaction to the network.',
        icon: 'send',
        position: 0,
        title: 'Submitted',
        tone: 'pending'
      }
    case 'verifying':
    case 'verified':
    case 'sent':
      return {
        detail: 'Sent to the network.',
        icon: 'send',
        position: 0,
        title: 'Submitted',
        tone: 'pending'
      }
    case 'confirming':
      return {
        detail: 'Waiting for network confirmation.',
        icon: 'pending',
        position: 1,
        title: 'Confirming',
        tone: 'pending'
      }
    case 'confirmed':
      return {
        detail: `The transaction is confirmed on ${networkName}.`,
        icon: 'verified',
        position: 2,
        title: 'Confirmed',
        tone: 'success'
      }
    case 'error':
      return {
        detail: 'The network did not confirm this transaction.',
        icon: 'failed',
        position: req?.tx?.hash ? 0 : -1,
        title: 'Transaction failed',
        tone: 'failure'
      }
    default:
      return {
        detail: 'Wren is sending the transaction to the network.',
        icon: 'send',
        position: 0,
        title: 'Submitted',
        tone: 'pending'
      }
  }
}

const TxBar = ({ networkName, req }) => {
  const presentation = transactionLifecyclePresentation(req, networkName)
  const lifecycleSteps = presentation.steps || steps

  return (
    <section
      className={`txLifecycle txLifecycle-${presentation.tone}`}
      role={presentation.tone === 'failure' ? 'alert' : 'status'}
      aria-live={presentation.tone === 'failure' ? 'assertive' : 'polite'}
      aria-atomic='true'
    >
      <div className='txLifecycleSummary'>
        <span className='txLifecycleMark' aria-hidden='true'>
          <Icon name={presentation.icon} size={20} />
        </span>
        <span className='txLifecycleCopy'>
          <strong>{presentation.title}</strong>
          <span className={presentation.tone === 'warning' ? 'txLifecycleDetailVisible' : ''}>
            {presentation.detail}
          </span>
        </span>
      </div>
      {!isUnconfirmedSubmission(req) && (
        <ol className='txLifecycleSteps' aria-label='Transaction progress'>
          {lifecycleSteps.map((step, index) => {
            const state =
              index < presentation.position
                ? 'complete'
                : index === presentation.position
                  ? 'current'
                  : 'next'
            return (
              <li
                key={step.label}
                className={`txLifecycleStep txLifecycleStep-${state}`}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={step.label}
              >
                <span className='txLifecycleStepMarker' aria-hidden='true'>
                  <Icon name={step.icon} size={14} />
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export default TxBar
