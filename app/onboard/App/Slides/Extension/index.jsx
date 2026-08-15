import React, { useEffect } from 'react'
import onboardingCompanion from 'url:../../../../../asset/ui/onboarding-companion-v4.png'
import link from '../../../../../resources/link'
import svg from '../../../../../resources/svg'

import { BrowserChoice, BrowserChoices, Slide, SlideBody, SlideItem, Tag } from '../../styled'

const Extension = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Connect browser dapps')
    setProceed({ action: 'next', text: 'Next' })
  }, [])
  return (
    <Slide $background={onboardingCompanion}>
      <SlideBody>
        <SlideItem>
          Some dapps need a browser wallet. <Tag>Wren Companion</Tag> routes those requests to Wren on your
          desktop.
        </SlideItem>
        <SlideItem $flush>Review and approve or reject each request in Wren.</SlideItem>
        <BrowserChoices>
          <BrowserChoice
            aria-label='Open Wren Companion release downloads for Chrome'
            className='wrenControl wrenControlSecondary'
            type='button'
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.chrome(20)}
            <span>Chrome</span>
          </BrowserChoice>
          <BrowserChoice
            aria-label='Open Wren Companion release downloads for Firefox'
            className='wrenControl wrenControlSecondary'
            type='button'
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.firefox(20)}
            <span>Firefox</span>
          </BrowserChoice>
        </BrowserChoices>
      </SlideBody>
    </Slide>
  )
}

export default Extension
