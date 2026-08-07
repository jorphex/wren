import React, { useEffect } from 'react'

import onboardingReady from 'url:../../../../../asset/ui/onboarding-ready.png'
import { Slide, SlideArtwork, SlideBody, SlideItem } from '../../styled'

const Outro = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Ready when you are')
    setProceed({ action: 'complete', text: 'Open Wren' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideArtwork alt='' aria-hidden='true' src={onboardingReady} />
        <SlideItem>
          <div>Your wallet is set up. Add an account when</div>
          <div>you are ready to connect and sign.</div>
        </SlideItem>
        <SlideItem>
          <div>Wren keeps the simple path clear and the</div>
          <div>important details close at hand.</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Outro
