import { useEffect, useRef } from 'react'

import Icon from '../Icon'
import AddressIdentity from '../AddressIdentity'
import useCopiedMessage from '../../Hooks/useCopiedMessage'

export const ReviewContext = ({ origin, network }) => (
  <div className='signingReviewContext'>
    <span className='signingReviewOrigin'>
      <Icon name='apps' size={16} />
      {origin || 'Unknown app'}
    </span>
    <span className='signingReviewNetwork'>{network || 'Unknown network'}</span>
  </div>
)

export const ReviewAddress = ({ address, label, name, source, emphasizeEnds = false }) => {
  const [copied, copy] = useCopiedMessage(address)
  if (!address) return null
  return (
    <div className='signingReviewAddressRow'>
      {label ? <span className='signingReviewLabel'>{label}</span> : null}
      <button
        type='button'
        className='signingReviewAddress wrenControlCompact'
        aria-label={`Copy ${name || label?.toLowerCase() || 'address'}`}
        onClick={copy}
      >
        <span className='clusterAddress'>
          <AddressIdentity
            address={address}
            complete
            label={source?.label}
            source={source?.source}
            emphasizeEnds={emphasizeEnds}
            revealOnHover={false}
          />
        </span>
        <Icon name='copy' size={16} />
      </button>
      <span className='signingReviewCopyStatus' role='status' aria-live='polite'>
        {copied ? 'Address copied' : ''}
      </span>
    </div>
  )
}

export const ReviewDetails = ({ children, label = 'Advanced details', initiallyOpen = false }) => {
  const ref = useRef()
  useEffect(() => {
    if (initiallyOpen && ref.current) {
      ref.current.open = true
      const frame = requestAnimationFrame(() => {
        if (!ref.current) return
        const field = ref.current.querySelector(
          'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
        )
        field?.focus({ preventScroll: true })
        ;(field || ref.current).scrollIntoView?.({ block: field ? 'center' : 'nearest' })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [initiallyOpen])
  return (
    <details className='signingReviewDetails' ref={ref}>
      <summary>
        {label}
        <Icon name='chevron-right' size={16} />
      </summary>
      <div className='signingReviewDetailsBody'>{children}</div>
    </details>
  )
}
