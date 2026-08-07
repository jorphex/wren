import React, { useEffect } from 'react'

import onboardingWelcome from 'url:../../../../../asset/ui/onboarding-welcome.png'
import { Slide, SlideArtwork, SlideBody, SlideItem } from '../../styled'

const Intro = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Meet Wren')
    setProceed({ action: 'next', text: 'Get started' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideArtwork alt='' aria-hidden='true' src={onboardingWelcome} />
        <SlideItem>
          <div>Your accounts, networks, and signing tools.</div>
          <div>Together in one calm desktop wallet.</div>
        </SlideItem>
        <SlideItem>
          <div>Connect to dapps, see what they are asking,</div>
          <div>and sign with confidence.</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Intro
