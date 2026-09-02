import Icon from '../../../../../resources/Components/Icon'

const steps = ['Sending', 'Submitted', 'Confirming', 'Confirmed']
const unconfirmedSteps = ['Broadcast once', 'Checking', 'Confirming', 'Confirmed']

export const isUnconfirmedSubmission = (req) =>
  req?.status === 'verifying' && req?.submission?.status === 'unconfirmed'

export const transactionLifecyclePresentation = (req, networkName = 'the network') => {
  if (isUnconfirmedSubmission(req)) {
    return {
      detail:
        'Wren made one broadcast attempt, but the RPC has not confirmed acceptance yet. Wren is checking the network and will not automatically resubmit.',
      icon: 'pending',
      position: 1,
      steps: unconfirmedSteps,
      title: 'Submission unconfirmed',
      tone: 'pending'
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
        title: 'Sending',
        tone: 'pending'
      }
    case 'verifying':
    case 'verified':
    case 'sent':
      return {
        detail: 'Sent to the network.',
        icon: 'send',
        position: 1,
        title: 'Submitted',
        tone: 'pending'
      }
    case 'confirming':
      return {
        detail: 'The transaction was sent. Wren is waiting for network confirmation.',
        icon: 'pending',
        position: 2,
        title: 'Confirming',
        tone: 'pending'
      }
    case 'confirmed':
      return {
        detail: `The transaction is confirmed on ${networkName}.`,
        icon: 'verified',
        position: 3,
        title: 'Confirmed',
        tone: 'success'
      }
    case 'error':
      return {
        detail: 'The network did not confirm this transaction.',
        icon: 'failed',
        position: req?.tx?.hash ? 1 : 0,
        title: 'Transaction failed',
        tone: 'failure'
      }
    default:
      return {
        detail: 'Wren is sending the transaction to the network.',
        icon: 'send',
        position: 0,
        title: 'Sending',
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
          <span>{presentation.detail}</span>
        </span>
      </div>
      <ol className='txLifecycleSteps' aria-label='Transaction progress'>
        {lifecycleSteps.map((step, index) => {
          const state =
            index < presentation.position ? 'complete' : index === presentation.position ? 'current' : 'next'
          return (
            <li
              key={step}
              className={`txLifecycleStep txLifecycleStep-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className='txLifecycleStepMarker' aria-hidden='true' />
              <span>{step}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default TxBar
