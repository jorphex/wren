import React, { useEffect } from 'react'
import link from '../../../../../resources/link'
import svg from '../../../../../resources/svg'

import { BrowserChoice, BrowserChoices, Slide, SlideBody, SlideItem, Tag } from '../../styled'

const Extension = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Meet the companion')
    setProceed({ action: 'next', text: 'Next' })
  }, [])
  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>Some dapps only look for a browser wallet.</div>
          <div>
            <Tag>Wren Companion</Tag> introduces them to the desktop app.
          </div>
        </SlideItem>
        <SlideItem>
          <div>Requests arrive in Wren, where you can read</div>
          <div>the details and decide what happens next.</div>
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
