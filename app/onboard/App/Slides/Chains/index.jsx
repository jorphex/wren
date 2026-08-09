import React, { useEffect } from 'react'

import onboardingNetworks from 'url:../../../../../asset/ui/onboarding-networks-v6.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

import link from '../../../../../resources/link'

const Chains = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Choose your networks')
    setProceed({ action: 'next', text: 'Next' })
    link.send('tray:action', 'navDash', { view: 'chains', data: {} })
  }, [])

  return (
    <Slide $background={onboardingNetworks}>
      <SlideBody>
        <SlideItem>Enable the networks you use and leave the rest quiet.</SlideItem>
        <SlideItem>Wren includes popular EVM networks. Prefer your own RPC? Add it here.</SlideItem>
        <SlideItem>You can add another network at any time. Dapps can ask Wren to add one, too.</SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Chains
