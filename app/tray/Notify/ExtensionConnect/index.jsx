import { useEffect, useRef, useState } from 'react'

import link from '../../../../resources/link'
import { capitalize } from '../../../../resources/utils'
import svg from '../../../../resources/svg'

const ExtensionConnectNotification = ({ extensionId, browser, pairingCode, requestId, onClose }) => {
  const browserName = capitalize(browser)
  const browserIcon = svg[browser] || svg.chrome
  const [copyId, setCopyId] = useState(false)
  const [responding, setResponding] = useState(false)
  const copyTimerRef = useRef()
  const responsePendingRef = useRef(false)

  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  const copyExtensionId = () => {
    link.send('tray:clipboardData', extensionId)
    setCopyId(true)
    clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyId(false), 2000)
  }

  const respond = (accepted) => {
    if (responsePendingRef.current) return
    responsePendingRef.current = true
    setResponding(true)
    link.rpc('respondToExtensionRequest', requestId, accepted, onClose)
  }

  return (
    <div className='notifyBoxWrap' onMouseDown={(event) => event.stopPropagation()}>
      <div className='notifyBoxSlide'>
        <div className='notifyBox extensionConnectBox'>
          <div className='extensionConnectIcon' aria-hidden='true'>
            {browserIcon(40)}
          </div>
          <h2 id='wren-notify-title' className='notifyTitle'>
            {`A new ${browserName} extension is attempting to connect as "Wren Companion"`}
          </h2>
          <div className='notifyBody'>
            <div className='notifyBodyLine'>
              Verify this code matches the code in the Wren Companion popup.
            </div>
            <div className='extensionPairingCode'>{pairingCode}</div>
            <button
              type='button'
              className='extensionOriginButton wrenControl wrenControlSecondary'
              aria-label='Copy extension origin'
              onClick={copyExtensionId}
            >
              {copyId ? 'Extension origin copied' : extensionId}
            </button>
            <div className='clusterStatus' role='status'>
              {copyId ? 'Extension origin copied' : ''}
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
