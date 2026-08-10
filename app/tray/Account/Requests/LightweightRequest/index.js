import { useState } from 'react'

import Icon from '../../../../../resources/Components/Icon'
import useCopiedMessage from '../../../../../resources/Hooks/useCopiedMessage'

export const getLightweightRequestClass = ({ status }) => {
  let requestClass = 'signerRequest'
  if (status === 'success') requestClass += ' signerRequestSuccess'
  if (status === 'declined') requestClass += ' signerRequestDeclined'
  if (status === 'pending') requestClass += ' signerRequestPending'
  if (status === 'error') requestClass += ' signerRequestError'
  return requestClass
}

const LightweightRequestNotice = ({ notice, status }) => (
  <div className='requestNotice'>
    {status === 'pending' ? (
      <div className='requestNoticeInner'>
        <div className='loader' />
      </div>
    ) : status === 'success' ? (
      <div className='requestNoticeInner'>
        <Icon name='check' size={80} />
      </div>
    ) : status === 'error' || status === 'declined' ? (
      <div className='requestNoticeInner'>
        <Icon name='blocked' size={80} />
        {notice ? <div className='requestNoticeInnerText'>{notice}</div> : null}
      </div>
    ) : null}
  </div>
)

export const LightweightRequest = ({ children, eyebrow, help, icon, req, title }) => (
  <div key={req.id || req.handlerId} className={getLightweightRequestClass(req)}>
    <div className='approveRequest lightweightRequest'>
      {req.notice ? (
        <LightweightRequestNotice notice={req.notice} status={req.status} />
      ) : (
        <div className='approveTransactionPayload'>
          <section className='lightweightRequestSummary'>
            <span className='lightweightRequestSummaryIcon'>
              <Icon name={icon} size={28} />
            </span>
            <div>
              <div className='lightweightRequestEyebrow'>{eyebrow}</div>
              <h2>{title}</h2>
              <p>{help}</p>
            </div>
          </section>
          {children}
        </div>
      )}
    </div>
  </div>
)

export const RequestSection = ({ children, title }) => (
  <section className='lightweightRequestSection'>
    <h3>{title}</h3>
    {children}
  </section>
)

const CopyableRequestValue = ({ copyLabel, displayValue, value }) => {
  const [copied, copyValue] = useCopiedMessage(value)
  const [revealed, setRevealed] = useState(false)

  return (
    <button
      type='button'
      className='lightweightRequestFactValue lightweightRequestFactValueTechnical lightweightRequestCopy'
      aria-label={copyLabel}
      title={value}
      onBlur={() => setRevealed(false)}
      onClick={() => copyValue()}
      onFocus={() => setRevealed(true)}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
    >
      {copied ? 'Copied' : revealed ? value : displayValue || value}
    </button>
  )
}

export const RequestFact = ({ copyLabel, displayValue, label, technical = false, value }) => (
  <div className='lightweightRequestFact'>
    <span className='lightweightRequestFactLabel'>{label}</span>
    {copyLabel ? (
      <CopyableRequestValue copyLabel={copyLabel} displayValue={displayValue} value={value} />
    ) : (
      <span
        className={
          technical
            ? 'lightweightRequestFactValue lightweightRequestFactValueTechnical'
            : 'lightweightRequestFactValue'
        }
      >
        {displayValue || value}
      </span>
    )}
  </div>
)

export const RequestFactGrid = ({ children }) => <div className='lightweightRequestFactGrid'>{children}</div>

export const RequestPermission = ({ detail, icon, title }) => (
  <div className='lightweightRequestPermission'>
    <Icon name={icon} size={18} />
    <div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  </div>
)

export const RequestNote = ({ children, icon = 'permissions', warning = false }) => (
  <div
    className={warning ? 'lightweightRequestNote lightweightRequestNoteWarning' : 'lightweightRequestNote'}
  >
    <Icon name={icon} size={17} />
    <span>{children}</span>
  </div>
)
