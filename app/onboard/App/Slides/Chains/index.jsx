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
        <SlideItem>Use the main panel to enable networks. You can change this later.</SlideItem>
        <SlideItem>Wren includes common EVM networks. Add a custom RPC when you need one.</SlideItem>
        <SlideItem>A dapp may request a network. Review the request before adding it.</SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Chains
