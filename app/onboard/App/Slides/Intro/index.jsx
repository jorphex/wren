import React, { useEffect } from 'react'

import onboardingWelcome from 'url:../../../../../asset/ui/onboarding-welcome.png'
import { Slide, SlideArtwork, SlideBody, SlideItem } from '../../styled'

const Intro = ({ setTitle, setProceed, version }) => {
  useEffect(() => {
    setTitle(`Welcome to Wren v${version}!`)
    setProceed({ action: 'next', text: "Let's go!" })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideArtwork alt='' aria-hidden='true' src={onboardingWelcome} />
        <SlideItem>
          <div>Wren is a desktop wallet that creates a secure</div>
          <div>system-wide interface to your chains and accounts.</div>
        </SlideItem>
        <SlideItem>
          <div>Now any browser, command-line, or native</div>
          <div>application has the ability to access to web3.</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Intro
