import React, { useEffect } from 'react'

import onboardingReady from 'url:../../../../../asset/ui/onboarding-ready-v2.png'
import { Slide, SlideBody, SlideItem } from '../../styled'

const Outro = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Ready to begin')
    setProceed({ action: 'complete', text: 'Open Wren' })
  }, [])
  return (
    <Slide $background={onboardingReady}>
      <SlideBody>
        <SlideItem>Wren is ready. Add an account when you want to connect, watch, or sign.</SlideItem>
        <SlideItem>Review each request in Wren before anything is signed.</SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Outro
