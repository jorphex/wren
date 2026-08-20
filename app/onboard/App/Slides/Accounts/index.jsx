import React, { useEffect } from 'react'

import onboardingAccounts from 'url:../../../../../asset/ui/onboarding-accounts-v13.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

import link from '../../../../../resources/link'

const Chains = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Add your accounts')
    setProceed({ action: 'next', text: 'Next' })
    link.send('tray:action', 'navDash', { view: 'accounts', data: {} })
  }, [])

  return (
    <Slide $background={onboardingAccounts}>
      <SlideBody>
        <SlideItem>Connect a hardware wallet, create a local account, or add a watch-only address.</SlideItem>
        <SlideItem>Select Add account, then choose how to add it.</SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Chains
