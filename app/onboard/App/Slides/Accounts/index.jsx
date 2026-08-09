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
        <SlideItem>Hardware signers, local accounts, and watch-only addresses all belong here.</SlideItem>
        <SlideItem>Choose Add account, then choose how you want to connect.</SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Chains
