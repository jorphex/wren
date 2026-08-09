import React, { useState } from 'react'
import styled from 'styled-components'

import { SlideProceed } from '../../styled'

const ProceedButton = styled.button`
  min-width: 156px;
  height: 46px;
`

export const ProceedSkip = styled.button`
  display: inline-block;
  min-width: 96px;
  height: 48px;
  font-size: 14px;
`

const BackButton = styled.button`
  min-width: 96px;
  height: 48px;
`

const Back = ({ slide, onClick }) =>
  slide > 1 ? (
    <BackButton
      type='button'
      className='wrenControl wrenControlSecondary wrenOnboardSecondary'
      onClick={onClick}
    >
      Back
    </BackButton>
  ) : null

const clickThrottle = (fn, [block, setBlock]) => {
  return () => {
    if (!block) {
      fn()
      setBlock(true)
      setTimeout(() => setBlock(false), 600)
    }
  }
}

export const Proceed = ({ slide, proceed = {}, nextSlide, prevSlide, onComplete }) => {
  const blockState = useState(false)
  if (proceed.action === 'next') {
    return (
      <SlideProceed key={slide}>
        <Back slide={slide} onClick={clickThrottle(prevSlide, blockState)} />
        <ProceedButton
          type='button'
          className='wrenControl wrenControlPrimary wrenControlLarge wrenOnboardPrimary'
          onClick={clickThrottle(nextSlide, blockState)}
        >
          {proceed.text}
        </ProceedButton>
      </SlideProceed>
    )
  } else if (proceed.action === 'skip') {
    return (
      <SlideProceed key={slide}>
        <Back slide={slide} onClick={clickThrottle(prevSlide, blockState)} />
        <ProceedSkip
          type='button'
          className='wrenControl wrenControlSecondary wrenOnboardSecondary'
          onClick={clickThrottle(nextSlide, blockState)}
        >
          {proceed.text}
        </ProceedSkip>
      </SlideProceed>
    )
  } else if (proceed.action === 'complete') {
    return (
      <SlideProceed key={slide}>
        <Back slide={slide} onClick={clickThrottle(prevSlide, blockState)} />
        <ProceedButton
          type='button'
          className='wrenControl wrenControlPrimary wrenControlLarge wrenOnboardPrimary'
          onClick={clickThrottle(onComplete, blockState)}
        >
          {proceed.text}
        </ProceedButton>
      </SlideProceed>
    )
  } else {
    return null
  }
}

export default Proceed
