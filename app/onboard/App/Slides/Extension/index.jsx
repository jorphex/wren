import React, { useEffect } from 'react'
import link from '../../../../../resources/link'
import svg from '../../../../../resources/svg'

import { Slide, SlideBody, SlideItem, Tag } from '../../styled'

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
        <div
          style={{
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <div
            style={{ padding: '10px', cursor: 'pointer' }}
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.chrome(48)}
          </div>
          <div
            style={{ padding: '10px', cursor: 'pointer' }}
            onClick={() =>
              link.send('tray:openExternal', 'https://github.com/jorphex/wren-companion/releases')
            }
          >
            {svg.firefox(48)}
          </div>
        </div>
      </SlideBody>
    </Slide>
  )
}

export default Extension
