import React, { useEffect } from 'react'
import svg from '../../../../../resources/svg'

import { Slide, SlideBody, SlideItem } from '../../styled'

const Extension = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Hardware signers')
    setProceed({ action: 'next', text: 'Next' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>Wren supports Ledger, GridPlus, and Trezor</div>
          <div>hardware signers.</div>
        </SlideItem>
        <SlideItem>
          <div>For high-value accounts, use a hardware signer</div>
          <div>and verify every transaction detail on the device.</div>
        </SlideItem>
        <SlideItem>
          <div>Choose the device that suits your account.</div>
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
