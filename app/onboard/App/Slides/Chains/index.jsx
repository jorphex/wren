import React, { useEffect } from 'react'

import { Slide, SlideBody, SlideItem } from '../../styled'

import link from '../../../../../resources/link'

const Chains = ({ setTitle, setProceed }) => {
  useEffect(() => {
    setTitle('Pick your networks')
    setProceed({ action: 'next', text: 'Next' })
    link.send('tray:action', 'navDash', { view: 'chains', data: {} })
  }, [])

  return (
    <Slide>
      <SlideBody>
        <SlideItem>
          <div>Turn on the networks you use and leave the rest quiet.</div>
        </SlideItem>
        <SlideItem>
          <div>Wren comes ready for popular EVM networks.</div>
          <div>Prefer your own RPC? Add it here.</div>
        </SlideItem>
        <SlideItem>
          <div>You can add another network at any time.</div>
          <div>Dapps can ask Wren to add one, too.</div>
        </SlideItem>
      </SlideBody>
    </Slide>
  )
}

export default Chains
