import React, { useEffect } from 'react'

import onboardingReady from 'url:../../../../../asset/ui/onboarding-ready.png'
import { Slide, SlideArtwork, SlideBody, SlideItem } from '../../styled'

const Outro = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle(`You're ready to go!`)
    setProceed({ action: 'complete', text: 'Done' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideArtwork alt='' aria-hidden='true' src={onboardingReady} />
        <SlideItem>
          <div>Wren is here to help you</div>
          <div>push the boundaries of web3.</div>
        </SlideItem>
        <SlideItem>
          <div>We can't wait to embark on your</div>
          <div>next adventure with you!</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Outro
