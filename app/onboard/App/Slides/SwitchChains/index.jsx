import React, { useEffect } from 'react'

import chainSwitch from 'url:./chainswitch.mp4'
import { Slide, SlideBody, SlideItem, SlideVideo } from '../../styled'

const SwitchChainsSlide = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Choose the right network')
    setProceed({ action: 'next', text: 'Next' })
  }, [])

  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <SlideVideo>
            <video loop autoPlay>
              <source src={chainSwitch} type='video/mp4' />
            </video>
          </SlideVideo>
          <div style={{ fontSize: '13px', lineHeight: '20px' }}>
            Older dapps do not always ask to change networks.
          </div>
          <div style={{ fontSize: '13px', lineHeight: '20px', paddingBottom: '15px' }}>
            Wren Companion lets you choose one for them.
          </div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default SwitchChainsSlide
