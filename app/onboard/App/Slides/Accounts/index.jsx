import React, { useEffect } from 'react'

import { Slide, SlideBody, SlideItem } from '../../styled'

import link from '../../../../../resources/link'

const Chains = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Bring your accounts')
    setProceed({ action: 'next', text: 'Next' })
    link.send('tray:action', 'navDash', { view: 'accounts', data: {} })
  }, [])

  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>Hardware signers, local accounts, and watch-only</div>
          <div>addresses all have a place in Wren.</div>
        </SlideItem>
        <SlideItem>
          <div>Choose Add account, then connect in the way</div>
          <div>that suits you.</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Chains
