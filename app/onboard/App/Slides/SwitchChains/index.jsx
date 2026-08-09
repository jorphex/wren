import React, { useEffect } from 'react'

import onboardingNetworkChoice from 'url:../../../../../asset/ui/onboarding-network-choice-v3.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

const SwitchChainsSlide = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Choose a network')
    setProceed({ action: 'next', text: 'Next' })
  }, [])

  return (
    <Slide $background={onboardingNetworkChoice}>
      <SlideBody>
        <SlideItem>
          Some dapps do not ask to change networks. Wren Companion lets you choose one when they do not.
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default SwitchChainsSlide
