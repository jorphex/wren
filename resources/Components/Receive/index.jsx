import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QrCode from '../QrCode'
import Icon from '../Icon'
import useCopiedMessage from '../../Hooks/useCopiedMessage'
import { getAddress } from '../../utils'

const Receive = ({ address }) => {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const trigger = useRef()
  const panel = useRef()
  const id = useId()
  const fullAddress = getAddress(address)
  const [copied, copy] = useCopiedMessage(fullAddress)
  const inside = (node) => trigger.current?.contains(node) || panel.current?.contains(node)
  useEffect(() => {
    if (!open) return
    const pointer = (event) => {
      if (!inside(event.target)) {
        setOpen(false)
        if (event.type === 'pointerdown') {
          event.preventDefault()
          trigger.current?.focus()
        }
      }
    }
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        trigger.current?.focus()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('focusin', pointer)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('focusin', pointer)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = trigger.current.getBoundingClientRect()
      const bounds = panel.current.getBoundingClientRect()
      setPosition({
        left: Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12)),
        top: Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 12))
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  return (
    <>
      <button
        type='button'
        ref={trigger}
        className='wrenControl wrenControlSecondary'
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup='dialog'
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && !event.shiftKey && open) {
            event.preventDefault()
            panel.current?.querySelector('button')?.focus()
          }
        }}
      >
        <Icon name='qr' size={16} /> Receive
      </button>
      {open
        ? createPortal(
            <>
              <div className='receiveBackdrop' aria-hidden='true' />
              <div
                id={id}
                ref={panel}
                role='dialog'
                aria-label='Receive assets'
                className='receivePanel'
                style={position}
              >
                <h2>Receive assets</h2>
                <QrCode className='qrCode' value={fullAddress} label='Receive account QR code' />
                <code>{fullAddress}</code>
                <button
                  type='button'
                  className='wrenControl wrenControlSecondary'
                  onClick={copy}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab') {
                      event.preventDefault()
                      trigger.current?.focus()
                      if (!event.shiftKey) trigger.current?.nextElementSibling?.focus()
                      setOpen(false)
                    }
                  }}
                >
                  {copied ? 'Address copied' : 'Copy address'}
                </button>
                <span className='clusterStatus' role='status'>
                  {copied ? 'Address copied' : ''}
                </span>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
export default Receive
