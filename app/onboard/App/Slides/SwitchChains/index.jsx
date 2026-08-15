import React, { useEffect } from 'react'

import onboardingNetworkChoice from 'url:../../../../../asset/ui/onboarding-network-choice-v3.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

const SwitchChainsSlide = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Check the dapp network')
    setProceed({ action: 'next', text: 'Next' })
  }, [])

  return (
    <Slide $background={onboardingNetworkChoice}>
      <SlideBody>
        <SlideItem>
          When a dapp does not provide a network, Wren Companion lets you choose one. Check the network in
          Wren before approving.
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default SwitchChainsSlide
