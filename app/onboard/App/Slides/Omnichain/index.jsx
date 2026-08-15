import React, { useEffect } from 'react'

import onboardingContext from 'url:../../../../../asset/ui/onboarding-context-v2.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

const OmnichainSlide = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Use the right network')
    setProceed({ action: 'next', text: 'Next' })
  }, [])

  return (
    <Slide $background={onboardingContext}>
      <SlideBody>
        <SlideItem>
          Every request stays tied to its network. A dapp can use several networks without making you manage
          a wallet-wide network switch.
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default OmnichainSlide
