import React, { useEffect } from 'react'
import onboardingCompanion from 'url:../../../../../asset/ui/onboarding-companion-v4.png'
import link from '../../../../../resources/link'
import svg from '../../../../../resources/svg'

import { BrowserChoice, BrowserChoices, Slide, SlideBody, SlideItem, Tag } from '../../styled'

const Extension = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Browser companion')
    setProceed({ action: 'next', text: 'Next' })
  }, [])
  return (
    <Slide $background={onboardingCompanion}>
      <SlideBody>
        <SlideItem>
          Some dapps only look for a browser wallet. <Tag>Wren Companion</Tag> connects them to Wren on your
          desktop.
        </SlideItem>
        <SlideItem>Requests arrive in Wren, where you can review the details before you decide.</SlideItem>
        <BrowserChoices>
          <BrowserChoice
            aria-label='Download Wren Companion for Chrome'
            className='wrenControl wrenControlGhost wrenControlIcon'
            type='button'
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.chrome(48)}
          </BrowserChoice>
          <BrowserChoice
            aria-label='Download Wren Companion for Firefox'
            className='wrenControl wrenControlGhost wrenControlIcon'
            type='button'
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.firefox(48)}
          </BrowserChoice>
        </BrowserChoices>
      </SlideBody>
    </Slide>
  )
}

export default Extension
