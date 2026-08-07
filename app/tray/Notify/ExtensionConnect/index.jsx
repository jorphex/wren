import styled from 'styled-components'
import { useEffect, useRef, useState } from 'react'

import link from '../../../../resources/link'
import { capitalize } from '../../../../resources/utils'
import svg from '../../../../resources/svg'
import {
  ClusterBox,
  Cluster,
  ClusterRow,
  ClusterStatus,
  ClusterValue
} from '../../../../resources/Components/Cluster'

const NotifyTop = styled.div`
  padding: 24px 0px 16px 0px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`

const NotifyMain = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-size: 14.6px;
  line-height: 22px;
  font-weight: 400;
`

const NotifyPrompt = styled.div`
  padding: 24px;
  font-weight: 400;
  text-transform: uppercase;
`

const ExtensionId = styled.div`
  margin: 24px 16px;
  height: 13px;
  font-weight: 400;
  text-transform: uppercase;
  display: flex;
  flex-direction: column;
  justify-content: center;
  letter-spacing: 0.5px;
  color: var(--moon);
`

const VCR = styled.div`
  font-family: 'FiraCode';
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0px;
`

const PairingCode = styled.div`
  margin-top: 12px;
  color: var(--good);
  font-family: 'FiraCode';
  font-size: 28px;
  font-weight: 500;
  letter-spacing: 6px;
`

const ConfirmButton = styled.div`
  padding: 24px;
  font-weight: 400;
  text-transform: uppercase;
  font-size: 16px;
`

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
    <div className='notify cardShow'>
      <div className='notifyBoxWrap' onMouseDown={(e) => e.stopPropagation()}>
        <div className='notifyBoxSlide'>
          <ClusterBox>
            <NotifyTop>
              <div style={{ color: 'var(--moon)' }}>{browserIcon(40)}</div>
            </NotifyTop>
            <Cluster>
              <ClusterRow>
                <ClusterValue>
                  <NotifyMain>
                    <div style={{ paddingBottom: '24px' }}>
                      {`A new ${browserName} extension is attempting to connect as "Wren Companion"`}{' '}
                    </div>
                    <div>{`Verify this code matches the code in the Wren Companion popup.`}</div>
                    <PairingCode>{pairingCode}</PairingCode>
                  </NotifyMain>
                </ClusterValue>
              </ClusterRow>
              <ClusterRow>
                <ClusterValue ariaLabel='Copy extension origin' onClick={copyExtensionId}>
                  <ExtensionId>{copyId ? 'extension origin copied' : <VCR>{extensionId}</VCR>}</ExtensionId>
                </ClusterValue>
                <ClusterStatus>{copyId ? 'Extension origin copied' : ''}</ClusterStatus>
              </ClusterRow>
              <ClusterRow>
                <ClusterValue>
                  <NotifyPrompt>Allow this extension to connect?</NotifyPrompt>
                </ClusterValue>
              </ClusterRow>
              <ClusterRow>
                <ClusterValue
                  ariaLabel='Decline extension connection'
                  disabled={responding}
                  onClick={() => respond(false)}
                >
                  <ConfirmButton style={{ color: 'var(--bad)' }}>Decline</ConfirmButton>
                </ClusterValue>
                <ClusterValue
                  ariaLabel='Accept extension connection'
                  disabled={responding}
                  onClick={() => respond(true)}
                >
                  <ConfirmButton style={{ color: 'var(--good)' }}>Accept</ConfirmButton>
                </ClusterValue>
              </ClusterRow>
            </Cluster>
          </ClusterBox>
        </div>
      </div>
    </div>
  )
}

export default ExtensionConnectNotification
