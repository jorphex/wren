import React from 'react'
import { SlideContainer } from '../styled'
import link from '../../../../resources/link'
import Intro from './Intro'

export const openSetup = (data) => {
  link.send('tray:action', 'navReplace', 'dash', [
    { view: 'accounts', data: { showAddAccounts: true, ...data } }
  ])
  link.send('frame:close')
}

const Slides = () => (
  <SlideContainer $immersive>
    <Intro onProceed={openSetup} />
  </SlideContainer>
)

export default Slides
