import React, { useEffect, useRef, useState } from 'react'
import { SlideContainer, Slide, SlideTitle, SlideScroller } from '../styled'

import link from '../../../../resources/link'

import Proceed from './Proceed'

import Intro from './Intro'
import Access from './Access'
import Chains from './Chains'
import Omnichain from './Omnichain'
import SwitchChains from './SwitchChains'
import Accounts from './Accounts'
import Extension from './Extension'
import Outro from './Outro'

const CurrentSlide = ({ slide, platform, setTitle, setProceed, nextSlide }) => {
  if (slide === 0) return null
  else if (slide === 1) return <Intro onProceed={nextSlide} setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 2) return <Access platform={platform} setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 3) return <Chains setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 4) return <Omnichain setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 5) return <Accounts setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 6) return <Extension setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 7) return <SwitchChains setTitle={setTitle} setProceed={setProceed} />
  else if (slide === 8) return <Outro setTitle={setTitle} setProceed={setProceed} />
  else return <Slide>{'Cannot find slide'}</Slide>
}

const onComplete = () => {
  link.send('tray:action', 'navReplace', 'dash')
  link.send('frame:close')
}

const prevSlide = (currentSlide, setSlide) => {
  const prevSlide = --currentSlide
  setSlide(prevSlide < 1 ? 1 : prevSlide)
}

const nextSlide = (currentSlide, setSlide) => {
  const nextSlide = ++currentSlide
  setSlide(nextSlide > 8 ? 8 : nextSlide)
}

const Slides = ({ platform }) => {
  const [title, setTitle] = useState()
  const [proceed, setProceed] = useState({})
  const [slide, setSlide] = useState(1)
  const titleRef = useRef()
  const immersive = slide === 1

  useEffect(() => {
    if (!immersive && title) titleRef.current?.focus()
  }, [immersive, slide, title])

  return (
    <SlideContainer $immersive={immersive}>
      {!immersive && (
        <SlideTitle id='onboarding-slide-title' key={title} ref={titleRef} tabIndex={-1}>
          {title}
        </SlideTitle>
      )}
      <SlideScroller
        role={immersive ? undefined : 'region'}
        aria-labelledby={immersive ? undefined : 'onboarding-slide-title'}
      >
        <CurrentSlide
          slide={slide}
          platform={platform}
          setTitle={setTitle}
          setProceed={setProceed}
          nextSlide={() => nextSlide(slide, setSlide)}
        />
      </SlideScroller>
      {!immersive && (
        <Proceed
          slide={slide}
          proceed={proceed}
          nextSlide={() => nextSlide(slide, setSlide)}
          prevSlide={() => prevSlide(slide, setSlide)}
          onComplete={onComplete}
        />
      )}
    </SlideContainer>
  )
}

export default Slides
