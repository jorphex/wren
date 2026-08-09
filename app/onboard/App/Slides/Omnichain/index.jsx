import React, { useEffect } from 'react'

import onboardingContext from 'url:../../../../../asset/ui/onboarding-context-v2.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

const OmnichainSlide = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Keep each request in context')
    setProceed({ action: 'next', text: 'Next' })
  }, [])

  return (
    <Slide $background={onboardingContext}>
      <SlideBody>
        <SlideItem>
          Each request goes to the network where it belongs. Dapps can use several networks at once, without
          making you manage a global network switch.
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default OmnichainSlide
