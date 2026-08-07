import React, { useEffect } from 'react'

import { Slide, SlideBody, SlideItem } from '../../styled'

const OmnichainSlide = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Stay in context')
    setProceed({ action: 'next', text: 'Next' })
  }, [])

  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>Each request goes to the network where it belongs.</div>
          <div>Dapps can use several networks at once, without</div>
          <div>a global network switch for you to babysit.</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default OmnichainSlide
