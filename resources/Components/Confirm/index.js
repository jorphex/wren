import { useState } from 'react'

const ResponseButton = ({ disabled, text, onClick }) => (
  <button type='button' className='confirmButton' disabled={disabled} onClick={onClick}>
    {text}
  </button>
)

export default function ConfirmDialog({
  prompt,
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
      <div role='heading' className='confirmText'>
        {prompt}
      </div>

      <div className='confirmButtonOptions'>
        <ResponseButton disabled={submitted} text={declineText} onClick={() => clickHandler(onDecline)} />
        <ResponseButton disabled={submitted} text={acceptText} onClick={() => clickHandler(onAccept)} />
      </div>
    </div>
  )
}
