import React, { useEffect } from 'react'
import svg from '../../../../../resources/svg'

import { Slide, SlideBody, SlideItem } from '../../styled'

const Extension = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Hardware Signers')
    setProceed({ action: 'next', text: 'Next' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>Wren supports many hardware signers including</div>
          <div>Ledger, GridPlus, Trezor and more on the way!</div>
        </SlideItem>
        <SlideItem>
          <div>For high value accounts be sure to use a hardware signer</div>
          <div>and verify all transaction details on your device.</div>
        </SlideItem>
        <SlideItem>
          <div>Need a hardware signer?</div>
        </SlideItem>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <div style={{ padding: '10px' }}>{svg.ledger(48)}</div>
          <div style={{ padding: '10px' }}>{svg.trezor(48)}</div>
        </div>
      </SlideBody>
    </Slide>
  )
}

export default Extension
