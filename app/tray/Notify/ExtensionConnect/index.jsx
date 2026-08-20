import { useEffect, useRef, useState } from 'react'

import link from '../../../../resources/link'
import svg from '../../../../resources/svg'

const ExtensionConnectNotification = ({ fingerprint, pairingCode, requestId, onClose }) => {
  const [copyFingerprint, setCopyFingerprint] = useState(false)
  const [responding, setResponding] = useState(false)
  const [responseError, setResponseError] = useState(false)
  const copyTimerRef = useRef()
  const errorCancelRef = useRef()
  const responsePendingRef = useRef(false)
  const lastResponseRef = useRef(true)

  useEffect(() => () => clearTimeout(copyTimerRef.current), [])
  useEffect(() => {
    if (responseError) errorCancelRef.current?.focus()
  }, [responseError])

  const copyPairingFingerprint = () => {
    link.send('tray:clipboardData', fingerprint)
    setCopyFingerprint(true)
    clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyFingerprint(false), 2000)
  }

  const respond = (accepted) => {
    if (responsePendingRef.current) return
    responsePendingRef.current = true
    lastResponseRef.current = accepted
    setResponding(true)
    link.rpc('respondToExtensionRequest', requestId, accepted, (error) => {
      responsePendingRef.current = false
      if (error) {
        setResponding(false)
        setResponseError(true)
      } else {
        onClose()
      }
    })
  }

  if (responseError) {
    return (
      <div className='notifyBoxWrap' onMouseDown={(event) => event.stopPropagation()}>
        <div className='notifyBoxSlide'>
          <div className='notifyBox extensionConnectBox'>
            <h2 id='wren-notify-title' className='notifyTitle'>
              Could not connect to the extension
            </h2>
            <div className='notifyBody'>Wren could not complete pairing with the extension.</div>
            <div className='notifyInput'>
              <button
                ref={errorCancelRef}
                type='button'
                className='notifyInputOption notifyInputDeny wrenControl wrenControlSecondary'
                data-dialog-initial-focus
                disabled={responding}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type='button'
                className='notifyInputOption notifyInputProceed wrenControl wrenControlPrimary'
                disabled={responding}
                onClick={() => respond(lastResponseRef.current)}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='notifyBoxWrap' onMouseDown={(event) => event.stopPropagation()}>
      <div className='notifyBoxSlide'>
        <div className='notifyBox extensionConnectBox'>
          <div className='extensionConnectIcon' aria-hidden='true'>
            {svg.handshake(40)}
          </div>
          <h2 id='wren-notify-title' className='notifyTitle'>
            New Wren Companion pairing request
          </h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Approve only if this code matches the code shown in the Wren Companion popup.
            </div>
            <div className='extensionPairingCode'>{pairingCode}</div>
            <button
              type='button'
              className='extensionOriginButton wrenControl wrenControlSecondary'
              aria-label='Copy pairing fingerprint'
              onClick={copyPairingFingerprint}
            >
              {copyFingerprint ? 'Pairing fingerprint copied' : fingerprint}
            </button>
            <div className='clusterStatus' role='status'>
              {copyFingerprint ? 'Pairing fingerprint copied' : ''}
            </div>
            <div className='notifyBodyQuestion'>Allow this extension to connect?</div>
          </div>
          <div className='notifyInput'>
            <button
              type='button'
              className='notifyInputOption notifyInputDeny wrenControl wrenControlSecondary'
              aria-label='Decline extension connection'
              data-dialog-initial-focus
              disabled={responding}
              onClick={() => respond(false)}
            >
              Decline
            </button>
            <button
              type='button'
              className='notifyInputOption notifyInputProceed wrenControl wrenControlPrimary'
              aria-label='Accept extension connection'
              disabled={responding}
              onClick={() => respond(true)}
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ExtensionConnectNotification
