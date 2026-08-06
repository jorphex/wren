import React, { useEffect } from 'react'
import link from '../../../../../resources/link'
import svg from '../../../../../resources/svg'

import { BrowserChoice, BrowserChoices, Slide, SlideBody, SlideItem, Tag } from '../../styled'

const Extension = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Browser Extension')
    setProceed({ action: 'next', text: 'Next' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>If you're using a dapp that doesn't natively</div>
          <div>connect to Wren, you can inject a connection with</div>
          <div>
            the <Tag>Wren Companion</Tag> browser extension.
          </div>
        </SlideItem>
        <SlideItem>
          <div>Download the qualified companion release for</div>
          <div>your preferred browser:</div>
        </SlideItem>
        <BrowserChoices>
          <BrowserChoice
            aria-label='Download Wren Companion for Chrome'
            type='button'
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.chrome(48)}
          </BrowserChoice>
          <BrowserChoice
            aria-label='Download Wren Companion for Firefox'
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
