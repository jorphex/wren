import React, { useState } from 'react'
import styled from 'styled-components'

import { SlideProceed } from '../../styled'

const ProceedButton = styled.button`
  width: 180px;
  height: 48px;
  padding: 0;
  border-radius: 24px;
  border: 0;
  background: var(--ghostA);
  border-bottom: 2px solid var(--ghostZ);
  box-shadow: 0px 2px 6px var(--ghostY);
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
  animation: cardShow 400ms linear both;
  animation-delay: 400ms;
  color: inherit;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  &:hover {
    background: var(--ghostB);
  }
`

export const ProceedSkip = styled.button`
  display: inline-block;
  height: 32px;
  font-size: 10px;
  border-radius: 16px;
  border: 2px solid var(--ghostX);
  padding: 8px 16px;
  background: transparent;
  box-sizing: border-box;
  animation: cardShow 400ms linear both;
  animation-delay: 400ms;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-transform: uppercase;
  color: var(--outerspace08);
  &:hover {
    color: var(--outerspace);
  }
`

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
        <ProceedButton type='button' onClick={clickThrottle(nextSlide, blockState)}>
          {proceed.text}
        </ProceedButton>
      </SlideProceed>
    )
  } else if (proceed.action === 'skip') {
    return (
      <SlideProceed key={slide}>
        <ProceedSkip type='button' onClick={clickThrottle(nextSlide, blockState)}>
          {proceed.text}
        </ProceedSkip>
      </SlideProceed>
    )
  } else if (proceed.action === 'complete') {
    return (
      <SlideProceed key={slide}>
        <ProceedButton type='button' onClick={clickThrottle(onComplete, blockState)}>
          {proceed.text}
        </ProceedButton>
      </SlideProceed>
    )
  } else {
    return null
  }
}

export default Proceed
