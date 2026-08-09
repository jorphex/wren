import { useState } from 'react'

const ResponseButton = ({ disabled, primary, text, onClick }) => (
  <button
    type='button'
    className={`confirmButton wrenControl ${primary ? 'wrenControlPrimary' : 'wrenControlSecondary'}`}
    disabled={disabled}
    onClick={onClick}
  >
    {text}
  </button>
)

export default function ConfirmDialog({
  prompt,
  description,
  acceptText = 'OK',
  declineText = 'Decline',
  onAccept,
  onDecline
}) {
  const [submitted, setSubmitted] = useState(false)

  const clickHandler = (onClick) => {
    if (!submitted) {
      setSubmitted(true)
      onClick()
    }
  }

  return (
    <div id='confirmationDialog' className='confirmDialog'>
      <div role='heading' className={description ? 'confirmText confirmTextWithDescription' : 'confirmText'}>
        {prompt}
      </div>
      {description && <div className='confirmDescription'>{description}</div>}

      <div className='confirmButtonOptions'>
        <ResponseButton disabled={submitted} text={declineText} onClick={() => clickHandler(onDecline)} />
        <ResponseButton
          disabled={submitted}
          primary
          text={acceptText}
          onClick={() => clickHandler(onAccept)}
        />
      </div>
    </div>
  )
}
